//! SFTP 操作实现。
use log::{info, warn};
use russh::client;
use russh_sftp::client::{RawSftpSession, SftpSession};
use russh_sftp::extensions;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::task::JoinSet;

use crate::error::EngineError;
use crate::types::{
    EngineEvent, EventCallback, SftpEntry, SftpEntryKind, SftpProgress, SftpProgressOp,
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

/// 读取远端目录条目列表。
pub async fn sftp_list(
    session: &client::Handle<super::session::ClientHandler>,
    path: &str,
) -> Result<Vec<SftpEntry>, EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    info!("sftp_list_start path={} started_at_ms={}", path, started_at);
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
            size: metadata.size,
            mtime: metadata.mtime.map(|t| t as u64),
            permissions: metadata.permissions.map(format_permissions),
            owner,
            group,
        });
    }
    results.sort_by(|a, b| a.name.cmp(&b.name));
    info!(
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
    on_event: &EventCallback,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    let (sftp, write_limit) = open_raw_sftp(session).await?;
    let mut local = tokio::fs::File::open(local_path).await.map_err(|err| {
        EngineError::with_detail("sftp_upload_failed", "无法读取本地文件", err.to_string())
    })?;
    let metadata = local.metadata().await.ok();
    let total = metadata.map(|m| m.len());
    info!(
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
                        on_event(EngineEvent::SftpProgress(SftpProgress {
                            session_id: session_id.to_string(),
                            op: SftpProgressOp::Upload,
                            path: remote_path.to_string(),
                            transferred,
                            total,
                        }));
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
        match result {
            Ok(Ok(len)) => {
                transferred += len as u64;
                on_event(EngineEvent::SftpProgress(SftpProgress {
                    session_id: session_id.to_string(),
                    op: SftpProgressOp::Upload,
                    path: remote_path.to_string(),
                    transferred,
                    total,
                }));
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
    on_event: &EventCallback,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    let sftp = open_sftp(session).await?;
    let mut remote = sftp.open(remote_path.to_string()).await.map_err(|err| {
        EngineError::with_detail("sftp_download_failed", "无法打开远端文件", err.to_string())
    })?;
    let total = remote.metadata().await.ok().and_then(|m| m.size);
    info!(
        "sftp_download_start session_id={} remote_path={} local_path={} started_at_ms={} total_bytes={}",
        session_id,
        remote_path,
        local_path,
        started_at,
        total.unwrap_or(0)
    );
    let mut local = tokio::fs::File::create(local_path).await.map_err(|err| {
        EngineError::with_detail("sftp_download_failed", "无法创建本地文件", err.to_string())
    })?;
    let result = transfer_with_progress(
        session_id,
        SftpProgressOp::Download,
        remote_path,
        &mut remote,
        &mut local,
        total,
        on_event,
    )
    .await;
    match result {
        Ok(transferred) => {
            log_sftp_success(
                "sftp_download_success",
                &TransferLogContext {
                    session_id,
                    source_path: remote_path,
                    target_path: local_path,
                    started_at_ms: started_at,
                    elapsed_ms: started.elapsed().as_millis(),
                    transferred_bytes: transferred,
                    total_bytes: total,
                },
            );
            Ok(())
        }
        Err(err) => {
            log_sftp_failure(
                "sftp_download_failed",
                &TransferLogContext {
                    session_id,
                    source_path: remote_path,
                    target_path: local_path,
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

/// 重命名远端文件或目录。
pub async fn sftp_rename(
    session: &client::Handle<super::session::ClientHandler>,
    from: &str,
    to: &str,
) -> Result<(), EngineError> {
    let started_at = now_epoch_millis();
    let started = Instant::now();
    info!(
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
    info!(
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
    info!(
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
    info!(
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
    info!(
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
    info!(
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
    info!("sftp_home_start started_at_ms={}", started_at);
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
    info!(
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
    info!(
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
    info!(
        "sftp_resolve_path_success path={} resolved_path={} started_at_ms={} elapsed_ms={}",
        path,
        resolved,
        started_at,
        started.elapsed().as_millis()
    );
    Ok(resolved)
}

/// 以固定缓冲区大小复制并回调进度。
async fn transfer_with_progress(
    session_id: &str,
    op: SftpProgressOp,
    path: &str,
    reader: &mut (impl AsyncRead + Unpin),
    writer: &mut (impl AsyncWrite + Unpin),
    total: Option<u64>,
    on_event: &EventCallback,
) -> Result<u64, TransferProgressError> {
    let mut buf = vec![0u8; 256 * 1024];
    let mut transferred = 0u64;
    loop {
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
        on_event(EngineEvent::SftpProgress(SftpProgress {
            session_id: session_id.to_string(),
            op: op.clone(),
            path: path.to_string(),
            transferred,
            total,
        }));
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
    info!(
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
