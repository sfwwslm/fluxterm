//! SFTP 操作实现。
//!
//! 本模块同时承载单文件上传下载与目录递归下载。
//! 目录下载采用“预扫描目录树 -> 顺序创建本地目录 -> 顺序下载文件”的执行模型，
//! 并统一通过 job 级 `SftpProgress` 向前端汇报项目数、字节数和最终状态。
use log::{debug, warn};
use russh::client;
use russh_sftp::client::{RawSftpSession, SftpSession};
use russh_sftp::extensions;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::task::JoinSet;

use crate::error::EngineError;
use crate::types::{
    EngineEvent, EventCallback, SftpEntry, SftpEntryKind, SftpProgress, SftpProgressOp,
    SftpTransferKind, SftpTransferStatus,
};

/// SFTP 传输过程中附带进度的错误信息。
struct TransferProgressError {
    error: EngineError,
    transferred: u64,
}

/// SFTP 传输日志上下文。
struct TransferLogContext<'a> {
    session_id: &'a str,
    source_path: &'a str,
    target_path: &'a str,
    started_at_ms: u128,
    elapsed_ms: u128,
    transferred_bytes: u64,
    total_bytes: Option<u64>,
}

/// SFTP 传输进度回调上下文。
#[derive(Clone, Copy)]
struct TransferProgressContext<'a> {
    session_id: &'a str,
    transfer_id: &'a str,
    op: SftpProgressOp,
    kind: SftpTransferKind,
    path: &'a str,
    display_name: &'a str,
    item_label: &'a str,
    target_name: Option<&'a str>,
    current_item_name: Option<&'a str>,
    total: Option<u64>,
    completed_items: u64,
    total_items: Option<u64>,
    failed_items: u64,
    status: SftpTransferStatus,
    on_event: &'a EventCallback,
}

/// 目录下载预扫描结果。
struct RemoteDirPlan {
    root_name: String,
    directories: Vec<String>,
    files: Vec<RemoteFilePlan>,
    total_items: u64,
    total_bytes: Option<u64>,
}

/// 单个远端文件下载计划。
struct RemoteFilePlan {
    remote_path: String,
    relative_path: String,
}

/// 生成 SFTP 传输任务标识。
///
/// 该标识会跨 session 主循环与具体传输任务共享，用于进度归集和取消定位。
pub(crate) fn next_transfer_id() -> String {
    format!("sftp-{}", now_epoch_millis())
}

/// 构造统一的“用户主动取消”错误。
fn transfer_cancelled_error() -> EngineError {
    EngineError::new("sftp_transfer_cancelled", "传输已取消")
}

/// 读取传输取消标记。
fn is_transfer_cancelled(cancel_flag: &AtomicBool) -> bool {
    cancel_flag.load(Ordering::Relaxed)
}

/// 根据项目总数生成任务展示标签。
fn items_label(total_items: Option<u64>) -> String {
    match total_items {
        Some(count) => format!("{count} items"),
        None => "items".to_string(),
    }
}

/// 发出任务取消的最终状态事件。
fn emit_cancelled_progress(
    on_event: &EventCallback,
    context: TransferProgressContext<'_>,
    transferred: u64,
) {
    emit_transfer_progress(
        on_event,
        TransferProgressContext {
            status: SftpTransferStatus::Cancelled,
            ..context
        },
        transferred,
    );
}

/// 读取远端目录条目列表。
pub async fn sftp_list(
    session: &client::Handle<super::session::ClientHandler>,
    path: &str,
) -> Result<Vec<SftpEntry>, EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    debug!("sftp_list_start path={} started_at_ms={}", path, started_at);
    let sftp = open_sftp(session).await?;
    let entries = sftp.read_dir(path.to_string()).await.map_err(|err| {
        let err = EngineError::with_detail("sftp_list_failed", "无法读取目录", err.to_string());
        log_sftp_path_failure(
            "sftp_list_failed",
            path,
            started_at,
            started.elapsed().as_millis(),
            &err,
        );
        err
    })?;
    let mut results = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        let hidden = name.starts_with('.');
        let base = path.trim_end_matches('/');
        let full_path = if base.is_empty() {
            format!("/{}", name)
        } else {
            format!("{}/{}", base, name)
        };
        let metadata = entry.metadata();
        let kind = match entry.file_type() {
            russh_sftp::protocol::FileType::Dir => SftpEntryKind::Dir,
            russh_sftp::protocol::FileType::Symlink => SftpEntryKind::Link,
            _ => SftpEntryKind::File,
        };
        let owner = metadata
            .user
            .clone()
            .or_else(|| metadata.uid.map(|value| value.to_string()));
        let group = metadata
            .group
            .clone()
            .or_else(|| metadata.gid.map(|value| value.to_string()));
        results.push(SftpEntry {
            path: full_path,
            name,
            kind,
            // 远端第一版仅按类 Unix 约定以 `.` 前缀识别隐藏文件，
            // 不承诺支持 Windows 远端的隐藏属性语义。
            hidden: Some(hidden),
            size: metadata.size,
            mtime: metadata.mtime.map(|t| t as u64),
            permissions: metadata.permissions.map(format_permissions),
            owner,
            group,
        });
    }
    results.sort_by(|a, b| a.name.cmp(&b.name));
    debug!(
        "sftp_list_success path={} started_at_ms={} elapsed_ms={} entry_count={}",
        path,
        started_at,
        started.elapsed().as_millis(),
        results.len()
    );
    Ok(results)
}

/// 上传本地文件至远端。
pub async fn sftp_upload(
    session: &client::Handle<super::session::ClientHandler>,
    session_id: &str,
    local_path: &str,
    remote_path: &str,
    transfer_id: &str,
    cancel_flag: &AtomicBool,
    on_event: &EventCallback,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    let display_name = file_name_from_path(local_path);
    let item_label = items_label(Some(1));
    let (sftp, write_limit) = open_raw_sftp(session).await?;
    let mut local = tokio::fs::File::open(local_path).await.map_err(|err| {
        EngineError::with_detail("sftp_upload_failed", "无法读取本地文件", err.to_string())
    })?;
    let metadata = local.metadata().await.ok();
    let total = metadata.map(|m| m.len());
    let target_name = file_name_from_path(remote_path);
    let progress_context = TransferProgressContext {
        session_id,
        transfer_id,
        op: SftpProgressOp::Upload,
        kind: SftpTransferKind::File,
        path: remote_path,
        display_name: &display_name,
        item_label: &item_label,
        target_name: Some(&target_name),
        current_item_name: Some(&display_name),
        total,
        completed_items: 0,
        total_items: Some(1),
        failed_items: 0,
        status: SftpTransferStatus::Running,
        on_event,
    };
    emit_transfer_progress(on_event, progress_context, 0);
    debug!(
        "sftp_upload_start session_id={} local_path={} remote_path={} started_at_ms={} total_bytes={}",
        session_id,
        local_path,
        remote_path,
        started_at,
        total.unwrap_or(0)
    );
    let handle = sftp
        .open(
            remote_path.to_string(),
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            FileAttributes::empty(),
        )
        .await
        .map_err(|err| {
            EngineError::with_detail("sftp_upload_failed", "无法创建远端文件", err.to_string())
        })?;
    let handle_id = handle.handle.clone();
    let mut chunk_size = 256 * 1024usize;
    if let Some(limit) = write_limit {
        chunk_size = chunk_size.min(limit as usize);
    }
    if chunk_size == 0 {
        chunk_size = 256 * 1024;
    }
    let mut buf = vec![0u8; chunk_size];
    let mut offset = 0u64;
    let mut transferred = 0u64;
    let mut in_flight: JoinSet<Result<usize, EngineError>> = JoinSet::new();
    let max_in_flight = 8usize;

    loop {
        if is_transfer_cancelled(cancel_flag) {
            in_flight.abort_all();
            let _ = sftp.close(handle_id.clone()).await;
            let _ = sftp.close_session();
            emit_cancelled_progress(on_event, progress_context, transferred);
            return Ok(());
        }
        let n = local.read(&mut buf).await.map_err(|err| {
            EngineError::with_detail("sftp_transfer_failed", "无法读取文件数据", err.to_string())
        })?;
        if n == 0 {
            break;
        }
        while in_flight.len() >= max_in_flight {
            if let Some(result) = in_flight.join_next().await {
                match result {
                    Ok(Ok(len)) => {
                        transferred += len as u64;
                        emit_transfer_progress(on_event, progress_context, transferred);
                    }
                    Ok(Err(err)) => {
                        log_sftp_failure(
                            "sftp_upload_failed",
                            &TransferLogContext {
                                session_id,
                                source_path: local_path,
                                target_path: remote_path,
                                started_at_ms: started_at,
                                elapsed_ms: started.elapsed().as_millis(),
                                transferred_bytes: transferred,
                                total_bytes: total,
                            },
                            &err,
                        );
                        in_flight.abort_all();
                        let _ = sftp.close(handle_id.clone()).await;
                        let _ = sftp.close_session();
                        return Err(err);
                    }
                    Err(err) => {
                        let err = EngineError::with_detail(
                            "sftp_transfer_failed",
                            "无法写入文件数据",
                            err.to_string(),
                        );
                        log_sftp_failure(
                            "sftp_upload_failed",
                            &TransferLogContext {
                                session_id,
                                source_path: local_path,
                                target_path: remote_path,
                                started_at_ms: started_at,
                                elapsed_ms: started.elapsed().as_millis(),
                                transferred_bytes: transferred,
                                total_bytes: total,
                            },
                            &err,
                        );
                        in_flight.abort_all();
                        let _ = sftp.close(handle_id.clone()).await;
                        let _ = sftp.close_session();
                        return Err(err);
                    }
                }
            }
        }
        let data = buf[..n].to_vec();
        let session = sftp.clone();
        let handle = handle_id.clone();
        let write_offset = offset;
        in_flight.spawn(async move {
            session
                .write(handle, write_offset, data)
                .await
                .map(|_| n)
                .map_err(|err| {
                    EngineError::with_detail(
                        "sftp_transfer_failed",
                        "无法写入文件数据",
                        err.to_string(),
                    )
                })
        });
        offset += n as u64;
    }

    while let Some(result) = in_flight.join_next().await {
        if is_transfer_cancelled(cancel_flag) {
            in_flight.abort_all();
            let _ = sftp.close(handle_id.clone()).await;
            let _ = sftp.close_session();
            emit_cancelled_progress(on_event, progress_context, transferred);
            return Ok(());
        }
        match result {
            Ok(Ok(len)) => {
                transferred += len as u64;
                emit_transfer_progress(on_event, progress_context, transferred);
            }
            Ok(Err(err)) => {
                log_sftp_failure(
                    "sftp_upload_failed",
                    &TransferLogContext {
                        session_id,
                        source_path: local_path,
                        target_path: remote_path,
                        started_at_ms: started_at,
                        elapsed_ms: started.elapsed().as_millis(),
                        transferred_bytes: transferred,
                        total_bytes: total,
                    },
                    &err,
                );
                in_flight.abort_all();
                let _ = sftp.close(handle_id.clone()).await;
                let _ = sftp.close_session();
                return Err(err);
            }
            Err(err) => {
                let err = EngineError::with_detail(
                    "sftp_transfer_failed",
                    "无法写入文件数据",
                    err.to_string(),
                );
                log_sftp_failure(
                    "sftp_upload_failed",
                    &TransferLogContext {
                        session_id,
                        source_path: local_path,
                        target_path: remote_path,
                        started_at_ms: started_at,
                        elapsed_ms: started.elapsed().as_millis(),
                        transferred_bytes: transferred,
                        total_bytes: total,
                    },
                    &err,
                );
                in_flight.abort_all();
                let _ = sftp.close(handle_id.clone()).await;
                let _ = sftp.close_session();
                return Err(err);
            }
        }
    }

    sftp.close(handle_id).await.map_err(|err| {
        EngineError::with_detail("sftp_upload_failed", "无法关闭远端文件", err.to_string())
    })?;
    let _ = sftp.close_session();
    emit_transfer_progress(
        on_event,
        TransferProgressContext {
            completed_items: 1,
            status: SftpTransferStatus::Success,
            ..progress_context
        },
        transferred,
    );
    log_sftp_success(
        "sftp_upload_success",
        &TransferLogContext {
            session_id,
            source_path: local_path,
            target_path: remote_path,
            started_at_ms: started_at,
            elapsed_ms: started.elapsed().as_millis(),
            transferred_bytes: transferred,
            total_bytes: total,
        },
    );
    Ok(())
}

/// 下载远端文件至本地。
pub async fn sftp_download(
    session: &client::Handle<super::session::ClientHandler>,
    session_id: &str,
    remote_path: &str,
    local_path: &str,
    transfer_id: &str,
    cancel_flag: &AtomicBool,
    on_event: &EventCallback,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    let display_name = file_name_from_path(remote_path);
    let item_label = items_label(Some(1));
    let sftp = open_sftp(session).await?;
    let mut remote = sftp.open(remote_path.to_string()).await.map_err(|err| {
        EngineError::with_detail("sftp_download_failed", "无法打开远端文件", err.to_string())
    })?;
    let total = remote.metadata().await.ok().and_then(|m| m.size);
    debug!(
        "sftp_download_start session_id={} remote_path={} local_path={} started_at_ms={} total_bytes={}",
        session_id,
        remote_path,
        local_path,
        started_at,
        total.unwrap_or(0)
    );
    let resolved_local_path = resolve_available_local_path(Path::new(local_path)).await?;
    let resolved_target_name = resolved_local_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(display_name.as_str())
        .to_string();
    let progress_context = TransferProgressContext {
        session_id,
        transfer_id,
        op: SftpProgressOp::Download,
        kind: SftpTransferKind::File,
        path: remote_path,
        display_name: &display_name,
        item_label: &item_label,
        target_name: Some(&resolved_target_name),
        current_item_name: Some(&display_name),
        total,
        completed_items: 0,
        total_items: Some(1),
        failed_items: 0,
        status: SftpTransferStatus::Running,
        on_event,
    };
    emit_transfer_progress(on_event, progress_context, 0);
    let mut local = tokio::fs::File::create(&resolved_local_path)
        .await
        .map_err(|err| {
            EngineError::with_detail("sftp_download_failed", "无法创建本地文件", err.to_string())
        })?;
    let result = transfer_with_progress(
        TransferProgressContext { ..progress_context },
        &mut remote,
        &mut local,
        cancel_flag,
    )
    .await;
    match result {
        Ok(transferred) => {
            emit_transfer_progress(
                on_event,
                TransferProgressContext {
                    completed_items: 1,
                    status: SftpTransferStatus::Success,
                    ..progress_context
                },
                transferred,
            );
            log_sftp_success(
                "sftp_download_success",
                &TransferLogContext {
                    session_id,
                    source_path: remote_path,
                    target_path: resolved_local_path.to_string_lossy().as_ref(),
                    started_at_ms: started_at,
                    elapsed_ms: started.elapsed().as_millis(),
                    transferred_bytes: transferred,
                    total_bytes: total,
                },
            );
            Ok(())
        }
        Err(err) => {
            if err.error.code == "sftp_transfer_cancelled" {
                let _ = tokio::fs::remove_file(&resolved_local_path).await;
                emit_cancelled_progress(on_event, progress_context, err.transferred);
                return Ok(());
            }
            emit_transfer_progress(
                on_event,
                TransferProgressContext {
                    failed_items: 1,
                    status: SftpTransferStatus::Failed,
                    ..progress_context
                },
                err.transferred,
            );
            log_sftp_failure(
                "sftp_download_failed",
                &TransferLogContext {
                    session_id,
                    source_path: remote_path,
                    target_path: resolved_local_path.to_string_lossy().as_ref(),
                    started_at_ms: started_at,
                    elapsed_ms: started.elapsed().as_millis(),
                    transferred_bytes: err.transferred,
                    total_bytes: total,
                },
                &err.error,
            );
            Err(err.error)
        }
    }
}

/// 递归下载远端目录到本地目录。
///
/// 流程分为两阶段：
/// 1. 预扫描远端目录树，统计目录/文件项与总字节数。
/// 2. 在本地创建同名根目录后，顺序创建子目录并顺序下载文件。
///
/// 第一版默认允许部分成功：
/// - 某个目录或文件失败时继续后续项
/// - 最终状态由 completed_items 与 failed_items 聚合判定
pub async fn sftp_download_dir(
    session: &client::Handle<super::session::ClientHandler>,
    session_id: &str,
    remote_path: &str,
    local_dir: &str,
    transfer_id: &str,
    cancel_flag: &AtomicBool,
    on_event: &EventCallback,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    let sftp = open_sftp(session).await?;
    let plan = collect_remote_dir_plan(&sftp, remote_path).await?;
    let item_label = items_label(Some(plan.total_items));
    let root_path =
        resolve_available_local_path(&Path::new(local_dir).join(&plan.root_name)).await?;
    let mut completed_items = 0u64;
    let mut failed_items = 0u64;
    let mut transferred = 0u64;
    let progress_context = TransferProgressContext {
        session_id,
        transfer_id,
        op: SftpProgressOp::Download,
        kind: SftpTransferKind::Directory,
        path: remote_path,
        display_name: &plan.root_name,
        item_label: &item_label,
        target_name: root_path.file_name().and_then(|value| value.to_str()),
        current_item_name: None,
        total: plan.total_bytes,
        completed_items: 0,
        total_items: Some(plan.total_items),
        failed_items: 0,
        status: SftpTransferStatus::Running,
        on_event,
    };

    debug!(
        "sftp_download_dir_start session_id={} remote_path={} local_dir={} started_at_ms={} total_items={} total_bytes={}",
        session_id,
        remote_path,
        local_dir,
        started_at,
        plan.total_items,
        plan.total_bytes.unwrap_or(0)
    );

    match tokio::fs::create_dir_all(&root_path).await {
        Ok(()) => {
            completed_items += 1;
            emit_transfer_progress(
                on_event,
                TransferProgressContext {
                    completed_items,
                    current_item_name: None,
                    ..progress_context
                },
                transferred,
            );
        }
        Err(err) => {
            let err = EngineError::with_detail(
                "sftp_download_failed",
                "无法创建本地目录",
                err.to_string(),
            );
            emit_transfer_progress(
                on_event,
                TransferProgressContext {
                    completed_items: 0,
                    failed_items: plan.total_items,
                    status: SftpTransferStatus::Failed,
                    current_item_name: None,
                    ..progress_context
                },
                0,
            );
            log_sftp_failure(
                "sftp_download_dir_failed",
                &TransferLogContext {
                    session_id,
                    source_path: remote_path,
                    target_path: local_dir,
                    started_at_ms: started_at,
                    elapsed_ms: started.elapsed().as_millis(),
                    transferred_bytes: 0,
                    total_bytes: plan.total_bytes,
                },
                &err,
            );
            return Err(err);
        }
    }

    for dir in &plan.directories {
        if is_transfer_cancelled(cancel_flag) {
            emit_cancelled_progress(
                on_event,
                TransferProgressContext {
                    completed_items,
                    failed_items,
                    ..progress_context
                },
                transferred,
            );
            return Ok(());
        }
        let target = root_path.join(relative_path_to_local_path(dir));
        match tokio::fs::create_dir_all(&target).await {
            Ok(()) => {
                completed_items += 1;
            }
            Err(_) => {
                failed_items += 1;
            }
        }
        emit_transfer_progress(
            on_event,
            TransferProgressContext {
                completed_items,
                failed_items,
                ..progress_context
            },
            transferred,
        );
    }

    for file in &plan.files {
        let current_file_name = file_name_from_path(&file.remote_path);
        if is_transfer_cancelled(cancel_flag) {
            emit_cancelled_progress(
                on_event,
                TransferProgressContext {
                    completed_items,
                    failed_items,
                    current_item_name: Some(&current_file_name),
                    ..progress_context
                },
                transferred,
            );
            return Ok(());
        }
        let target = root_path.join(relative_path_to_local_path(&file.relative_path));
        if let Some(parent) = target.parent()
            && tokio::fs::create_dir_all(parent).await.is_err()
        {
            failed_items += 1;
            emit_transfer_progress(
                on_event,
                TransferProgressContext {
                    completed_items,
                    failed_items,
                    current_item_name: Some(&current_file_name),
                    ..progress_context
                },
                transferred,
            );
            continue;
        }
        match download_remote_file_to_local(
            &sftp,
            &file.remote_path,
            &target,
            cancel_flag,
            |file_transferred| {
                let current_transferred = transferred + file_transferred;
                emit_transfer_progress(
                    on_event,
                    TransferProgressContext {
                        completed_items,
                        failed_items,
                        current_item_name: Some(&current_file_name),
                        ..progress_context
                    },
                    current_transferred,
                );
            },
        )
        .await
        {
            Ok(file_transferred) => {
                transferred += file_transferred;
                completed_items += 1;
            }
            Err(err) if err.code == "sftp_transfer_cancelled" => {
                emit_cancelled_progress(
                    on_event,
                    TransferProgressContext {
                        completed_items,
                        failed_items,
                        current_item_name: Some(&current_file_name),
                        ..progress_context
                    },
                    transferred,
                );
                return Ok(());
            }
            Err(_) => {
                failed_items += 1;
            }
        }
        emit_transfer_progress(
            on_event,
            TransferProgressContext {
                completed_items,
                failed_items,
                current_item_name: Some(&current_file_name),
                ..progress_context
            },
            transferred,
        );
    }

    let final_status = if failed_items == 0 {
        SftpTransferStatus::Success
    } else if completed_items > 0 {
        SftpTransferStatus::PartialSuccess
    } else {
        SftpTransferStatus::Failed
    };
    emit_transfer_progress(
        on_event,
        TransferProgressContext {
            completed_items,
            failed_items,
            current_item_name: None,
            status: final_status,
            ..progress_context
        },
        transferred,
    );

    match final_status {
        SftpTransferStatus::Success | SftpTransferStatus::PartialSuccess => {
            log_sftp_success(
                "sftp_download_dir_success",
                &TransferLogContext {
                    session_id,
                    source_path: remote_path,
                    target_path: local_dir,
                    started_at_ms: started_at,
                    elapsed_ms: started.elapsed().as_millis(),
                    transferred_bytes: transferred,
                    total_bytes: plan.total_bytes,
                },
            );
            Ok(())
        }
        SftpTransferStatus::Failed => {
            let err = EngineError::new("sftp_download_failed", "目录下载失败");
            log_sftp_failure(
                "sftp_download_dir_failed",
                &TransferLogContext {
                    session_id,
                    source_path: remote_path,
                    target_path: local_dir,
                    started_at_ms: started_at,
                    elapsed_ms: started.elapsed().as_millis(),
                    transferred_bytes: transferred,
                    total_bytes: plan.total_bytes,
                },
                &err,
            );
            Err(err)
        }
        SftpTransferStatus::Cancelled => Ok(()),
        SftpTransferStatus::Running => Ok(()),
    }
}

/// 重命名远端文件或目录。
pub async fn sftp_rename(
    session: &client::Handle<super::session::ClientHandler>,
    from: &str,
    to: &str,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    debug!(
        "sftp_rename_start source_path={} target_path={} started_at_ms={}",
        from, to, started_at
    );
    let sftp = open_sftp(session).await?;
    sftp.rename(from.to_string(), to.to_string())
        .await
        .map_err(|err| {
            let err = EngineError::with_detail("sftp_rename_failed", "无法重命名", err.to_string());
            log_sftp_pair_failure(
                "sftp_rename_failed",
                from,
                to,
                started_at,
                started.elapsed().as_millis(),
                &err,
            );
            err
        })?;
    debug!(
        "sftp_rename_success source_path={} target_path={} started_at_ms={} elapsed_ms={}",
        from,
        to,
        started_at,
        started.elapsed().as_millis()
    );
    Ok(())
}

/// 删除远端文件。
pub async fn sftp_remove(
    session: &client::Handle<super::session::ClientHandler>,
    path: &str,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    debug!(
        "sftp_remove_start path={} started_at_ms={}",
        path, started_at
    );
    let sftp = open_sftp(session).await?;
    sftp.remove_file(path.to_string()).await.map_err(|err| {
        let err = EngineError::with_detail("sftp_remove_failed", "无法删除", err.to_string());
        log_sftp_path_failure(
            "sftp_remove_failed",
            path,
            started_at,
            started.elapsed().as_millis(),
            &err,
        );
        err
    })?;
    debug!(
        "sftp_remove_success path={} started_at_ms={} elapsed_ms={}",
        path,
        started_at,
        started.elapsed().as_millis()
    );
    Ok(())
}

/// 创建远端目录。
pub async fn sftp_mkdir(
    session: &client::Handle<super::session::ClientHandler>,
    path: &str,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    debug!(
        "sftp_mkdir_start path={} started_at_ms={}",
        path, started_at
    );
    let sftp = open_sftp(session).await?;
    sftp.create_dir(path.to_string()).await.map_err(|err| {
        let err = EngineError::with_detail("sftp_mkdir_failed", "无法创建目录", err.to_string());
        log_sftp_path_failure(
            "sftp_mkdir_failed",
            path,
            started_at,
            started.elapsed().as_millis(),
            &err,
        );
        err
    })?;
    debug!(
        "sftp_mkdir_success path={} started_at_ms={} elapsed_ms={}",
        path,
        started_at,
        started.elapsed().as_millis()
    );
    Ok(())
}

/// 获取远端家目录路径。
pub async fn sftp_home(
    session: &client::Handle<super::session::ClientHandler>,
) -> Result<String, EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    debug!("sftp_home_start started_at_ms={}", started_at);
    let sftp = open_sftp(session).await?;
    let home = sftp.canonicalize(".").await.map_err(|err| {
        let err = EngineError::with_detail("sftp_home_failed", "无法获取家目录", err.to_string());
        warn!(
            "sftp_home_failed started_at_ms={} elapsed_ms={} error_code={} error_message={} error_detail={}",
            started_at,
            started.elapsed().as_millis(),
            err.code,
            err.message,
            err.detail.as_deref().unwrap_or("")
        );
        err
    })?;
    debug!(
        "sftp_home_success path={} started_at_ms={} elapsed_ms={}",
        home,
        started_at,
        started.elapsed().as_millis()
    );
    Ok(home)
}

/// 解析远端路径到真实路径。
pub async fn sftp_resolve_path(
    session: &client::Handle<super::session::ClientHandler>,
    path: &str,
) -> Result<String, EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    debug!(
        "sftp_resolve_path_start path={} started_at_ms={}",
        path, started_at
    );
    let sftp = open_sftp(session).await?;
    let resolved = sftp.canonicalize(path).await.map_err(|err| {
        let err = EngineError::with_detail(
            "sftp_resolve_path_failed",
            "无法解析远端路径",
            err.to_string(),
        );
        log_sftp_path_failure(
            "sftp_resolve_path_failed",
            path,
            started_at,
            started.elapsed().as_millis(),
            &err,
        );
        err
    })?;
    debug!(
        "sftp_resolve_path_success path={} resolved_path={} started_at_ms={} elapsed_ms={}",
        path,
        resolved,
        started_at,
        started.elapsed().as_millis()
    );
    Ok(resolved)
}

/// 扫描远端目录树并生成本地下载计划。
///
/// 计划中的 `directories` 与 `files` 都使用相对根目录的路径，
/// 便于后续统一映射到本地目标目录。
async fn collect_remote_dir_plan(
    sftp: &SftpSession,
    remote_path: &str,
) -> Result<RemoteDirPlan, EngineError> {
    let root_name = file_name_from_path(remote_path);
    let mut directories = Vec::new();
    let mut files = Vec::new();
    let mut total_bytes = Some(0u64);

    collect_remote_dir_recursive(
        sftp,
        remote_path.trim_end_matches('/'),
        "",
        &mut directories,
        &mut files,
        &mut total_bytes,
    )
    .await?;

    let total_items = (directories.len() + files.len()) as u64;
    Ok(RemoteDirPlan {
        root_name,
        total_items: total_items.max(1),
        directories,
        files,
        total_bytes,
    })
}

/// 深度优先遍历远端目录，累积目录项、文件项和总字节数。
///
/// 当前实现不会递归展开符号链接；只有明确的目录类型才继续向下扫描。
async fn collect_remote_dir_recursive(
    sftp: &SftpSession,
    remote_root: &str,
    relative_dir: &str,
    directories: &mut Vec<String>,
    files: &mut Vec<RemoteFilePlan>,
    total_bytes: &mut Option<u64>,
) -> Result<(), EngineError> {
    let current_remote = if relative_dir.is_empty() {
        remote_root.to_string()
    } else {
        format!("{}/{}", remote_root, relative_dir)
    };
    let entries = sftp.read_dir(current_remote.clone()).await.map_err(|err| {
        EngineError::with_detail("sftp_list_failed", "无法读取目录", err.to_string())
    })?;

    for entry in entries {
        let name = entry.file_name();
        let next_relative = if relative_dir.is_empty() {
            name.clone()
        } else {
            format!("{relative_dir}/{name}")
        };
        let next_remote = format!("{}/{}", current_remote.trim_end_matches('/'), name);
        match entry.file_type() {
            russh_sftp::protocol::FileType::Dir => {
                directories.push(next_relative.clone());
                Box::pin(collect_remote_dir_recursive(
                    sftp,
                    remote_root,
                    &next_relative,
                    directories,
                    files,
                    total_bytes,
                ))
                .await?;
            }
            _ => {
                let size = entry.metadata().size;
                if let Some(total) = total_bytes.as_mut() {
                    if let Some(size) = size {
                        *total += size;
                    } else {
                        *total_bytes = None;
                    }
                }
                files.push(RemoteFilePlan {
                    remote_path: next_remote,
                    relative_path: next_relative,
                });
            }
        }
    }

    Ok(())
}

/// 将单个远端文件复制到本地，并把阶段性字节数回调给上层 job。
///
/// 该函数只负责文件级复制，不直接生成新的 transfer_id，
/// 便于目录下载任务把多个文件聚合成同一个 job。
async fn download_remote_file_to_local(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    cancel_flag: &AtomicBool,
    mut on_progress: impl FnMut(u64),
) -> Result<u64, EngineError> {
    let mut remote = sftp.open(remote_path.to_string()).await.map_err(|err| {
        EngineError::with_detail("sftp_download_failed", "无法打开远端文件", err.to_string())
    })?;
    let mut local = tokio::fs::File::create(local_path).await.map_err(|err| {
        EngineError::with_detail("sftp_download_failed", "无法创建本地文件", err.to_string())
    })?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut transferred = 0u64;
    loop {
        if is_transfer_cancelled(cancel_flag) {
            // 当前文件尚未完成时直接删除半截目标文件，避免在本地留下无法识别的残缺文件。
            let _ = tokio::fs::remove_file(local_path).await;
            return Err(transfer_cancelled_error());
        }
        let n = remote.read(&mut buf).await.map_err(|err| {
            EngineError::with_detail("sftp_transfer_failed", "无法读取文件数据", err.to_string())
        })?;
        if n == 0 {
            break;
        }
        local.write_all(&buf[..n]).await.map_err(|err| {
            EngineError::with_detail("sftp_transfer_failed", "无法写入文件数据", err.to_string())
        })?;
        transferred += n as u64;
        on_progress(transferred);
    }
    Ok(transferred)
}

/// 发出聚合后的 SFTP 传输进度事件。
///
/// 单文件与目录下载都走同一进度结构，前端只消费 job 级视图，
/// 不需要区分底层是单文件还是批量目录任务。
fn emit_transfer_progress(
    on_event: &EventCallback,
    context: TransferProgressContext<'_>,
    transferred: u64,
) {
    (on_event)(EngineEvent::SftpProgress(SftpProgress {
        session_id: context.session_id.to_string(),
        transfer_id: context.transfer_id.to_string(),
        op: context.op,
        kind: context.kind,
        path: context.path.to_string(),
        display_name: context.display_name.to_string(),
        item_label: context.item_label.to_string(),
        target_name: context.target_name.map(|value| value.to_string()),
        current_item_name: context.current_item_name.map(|value| value.to_string()),
        transferred,
        total: context.total,
        completed_items: context.completed_items,
        total_items: context.total_items,
        status: context.status,
        failed_items: context.failed_items,
    }));
}

fn relative_path_to_local_path(relative_path: &str) -> PathBuf {
    let mut result = PathBuf::new();
    for part in relative_path.split('/').filter(|part| !part.is_empty()) {
        result.push(part);
    }
    result
}

/// 为本地下载目标生成一个不与已有文件/目录冲突的路径。
///
/// 规则与桌面文件管理器一致，优先尝试：
/// - `name`
/// - `name (1)`
/// - `name (2)`
///
/// 这样可以避免单文件下载覆盖已有文件，也避免目录下载把新内容合并进旧目录。
async fn resolve_available_local_path(path: &Path) -> Result<PathBuf, EngineError> {
    if tokio::fs::metadata(path).await.is_err() {
        return Ok(path.to_path_buf());
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());
    let file_name_fallback = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("download")
        .to_string();

    for index in 1.. {
        let candidate_name = if let Some(extension) = extension {
            format!("{stem} ({index}).{extension}")
        } else if path.extension().is_none() && path.file_name().is_some() {
            format!("{file_name_fallback} ({index})")
        } else {
            format!("{stem} ({index})")
        };
        let candidate = parent.join(candidate_name);
        if tokio::fs::metadata(&candidate).await.is_err() {
            return Ok(candidate);
        }
    }

    Err(EngineError::new(
        "sftp_download_failed",
        "无法生成可用的本地目标路径",
    ))
}

fn file_name_from_path(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

/// 以固定缓冲区大小复制并回调进度。
async fn transfer_with_progress(
    context: TransferProgressContext<'_>,
    reader: &mut (impl AsyncRead + Unpin),
    writer: &mut (impl AsyncWrite + Unpin),
    cancel_flag: &AtomicBool,
) -> Result<u64, TransferProgressError> {
    let mut buf = vec![0u8; 256 * 1024];
    let mut transferred = 0u64;
    loop {
        if is_transfer_cancelled(cancel_flag) {
            return Err(TransferProgressError {
                error: transfer_cancelled_error(),
                transferred,
            });
        }
        let n = reader
            .read(&mut buf)
            .await
            .map_err(|err| TransferProgressError {
                error: EngineError::with_detail(
                    "sftp_transfer_failed",
                    "无法读取文件数据",
                    err.to_string(),
                ),
                transferred,
            })?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .await
            .map_err(|err| TransferProgressError {
                error: EngineError::with_detail(
                    "sftp_transfer_failed",
                    "无法写入文件数据",
                    err.to_string(),
                ),
                transferred,
            })?;
        transferred += n as u64;
        emit_transfer_progress(
            context.on_event,
            TransferProgressContext {
                session_id: context.session_id,
                transfer_id: context.transfer_id,
                op: context.op,
                kind: context.kind,
                path: context.path,
                display_name: context.display_name,
                item_label: context.item_label,
                target_name: context.target_name,
                current_item_name: context.current_item_name,
                total: context.total,
                completed_items: context.completed_items,
                total_items: context.total_items,
                failed_items: context.failed_items,
                status: context.status,
                on_event: context.on_event,
            },
            transferred,
        );
    }
    Ok(transferred)
}

/// 获取当前 Unix 时间戳（毫秒）。
fn now_epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// 记录 SFTP 传输成功日志。
fn log_sftp_success(action: &str, context: &TransferLogContext<'_>) {
    let speed_bytes_per_sec = if context.elapsed_ms == 0 {
        context.transferred_bytes
    } else {
        ((context.transferred_bytes as u128 * 1000) / context.elapsed_ms) as u64
    };
    debug!(
        "{} session_id={} source_path={} target_path={} started_at_ms={} elapsed_ms={} transferred_bytes={} total_bytes={} avg_bytes_per_sec={}",
        action,
        context.session_id,
        context.source_path,
        context.target_path,
        context.started_at_ms,
        context.elapsed_ms,
        context.transferred_bytes,
        context.total_bytes.unwrap_or(0),
        speed_bytes_per_sec
    );
}

/// 记录 SFTP 传输失败日志。
fn log_sftp_failure(action: &str, context: &TransferLogContext<'_>, err: &EngineError) {
    warn!(
        "{} session_id={} source_path={} target_path={} started_at_ms={} elapsed_ms={} transferred_bytes={} total_bytes={} error_code={} error_message={} error_detail={}",
        action,
        context.session_id,
        context.source_path,
        context.target_path,
        context.started_at_ms,
        context.elapsed_ms,
        context.transferred_bytes,
        context.total_bytes.unwrap_or(0),
        err.code,
        err.message,
        err.detail.as_deref().unwrap_or("")
    );
}

/// 记录仅包含单一路径的 SFTP 操作失败日志。
fn log_sftp_path_failure(
    action: &str,
    path: &str,
    started_at_ms: u128,
    elapsed_ms: u128,
    err: &EngineError,
) {
    warn!(
        "{} path={} started_at_ms={} elapsed_ms={} error_code={} error_message={} error_detail={}",
        action,
        path,
        started_at_ms,
        elapsed_ms,
        err.code,
        err.message,
        err.detail.as_deref().unwrap_or("")
    );
}

/// 记录包含源路径和目标路径的 SFTP 操作失败日志。
fn log_sftp_pair_failure(
    action: &str,
    source_path: &str,
    target_path: &str,
    started_at_ms: u128,
    elapsed_ms: u128,
    err: &EngineError,
) {
    warn!(
        "{} source_path={} target_path={} started_at_ms={} elapsed_ms={} error_code={} error_message={} error_detail={}",
        action,
        source_path,
        target_path,
        started_at_ms,
        elapsed_ms,
        err.code,
        err.message,
        err.detail.as_deref().unwrap_or("")
    );
}

/// 打开 SFTP 子系统会话。
async fn open_sftp(
    session: &client::Handle<super::session::ClientHandler>,
) -> Result<SftpSession, EngineError> {
    let channel = session.channel_open_session().await.map_err(|err| {
        EngineError::with_detail("sftp_init_failed", "无法打开 SFTP 通道", err.to_string())
    })?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|err| {
            EngineError::with_detail("sftp_init_failed", "无法请求 SFTP 子系统", err.to_string())
        })?;
    let stream = channel.into_stream();
    SftpSession::new(stream).await.map_err(|err| {
        EngineError::with_detail("sftp_init_failed", "无法初始化 SFTP", err.to_string())
    })
}

/// 打开 SFTP 原始会话并返回可写长度限制。
async fn open_raw_sftp(
    session: &client::Handle<super::session::ClientHandler>,
) -> Result<(Arc<RawSftpSession>, Option<u64>), EngineError> {
    let channel = session.channel_open_session().await.map_err(|err| {
        EngineError::with_detail("sftp_init_failed", "无法打开 SFTP 通道", err.to_string())
    })?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|err| {
            EngineError::with_detail("sftp_init_failed", "无法请求 SFTP 子系统", err.to_string())
        })?;
    let stream = channel.into_stream();
    let mut raw = RawSftpSession::new(stream);
    let version = raw.init().await.map_err(|err| {
        EngineError::with_detail("sftp_init_failed", "无法初始化 SFTP", err.to_string())
    })?;
    let mut write_limit = None;
    if version
        .extensions
        .get(extensions::LIMITS)
        .is_some_and(|value| value == "1")
    {
        let limits = raw.limits().await.map_err(|err| {
            EngineError::with_detail("sftp_init_failed", "无法获取 SFTP 限制", err.to_string())
        })?;
        let limits = russh_sftp::client::rawsession::Limits::from(limits);
        write_limit = limits.write_len;
        raw.set_limits(Arc::new(limits));
    }
    Ok((Arc::new(raw), write_limit))
}

/// 将权限位转换为可读字符串。
fn format_permissions(perm: u32) -> String {
    let flags = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ];
    flags
        .iter()
        .map(|(flag, ch)| if perm & *flag != 0 { *ch } else { '-' })
        .collect()
}
