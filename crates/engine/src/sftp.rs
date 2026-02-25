//! SFTP 操作实现。
use russh::client;
use russh_sftp::client::{RawSftpSession, SftpSession};
use russh_sftp::extensions;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::task::JoinSet;

use crate::error::EngineError;
use crate::types::{
    EngineEvent, EventCallback, SftpEntry, SftpEntryKind, SftpProgress, SftpProgressOp,
};

/// 读取远端目录条目列表。
pub async fn sftp_list(
    session: &client::Handle<super::session::ClientHandler>,
    path: &str,
) -> Result<Vec<SftpEntry>, EngineError> {
    let sftp = open_sftp(session).await?;
    let entries = sftp.read_dir(path.to_string()).await.map_err(|err| {
        EngineError::with_detail("sftp_list_failed", "无法读取目录", err.to_string())
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
    let (sftp, write_limit) = open_raw_sftp(session).await?;
    let mut local = tokio::fs::File::open(local_path).await.map_err(|err| {
        EngineError::with_detail("sftp_upload_failed", "无法读取本地文件", err.to_string())
    })?;
    let metadata = local.metadata().await.ok();
    let total = metadata.map(|m| m.len());
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
                        in_flight.abort_all();
                        let _ = sftp.close(handle_id.clone()).await;
                        let _ = sftp.close_session();
                        return Err(err);
                    }
                    Err(err) => {
                        in_flight.abort_all();
                        let _ = sftp.close(handle_id.clone()).await;
                        let _ = sftp.close_session();
                        return Err(EngineError::with_detail(
                            "sftp_transfer_failed",
                            "无法写入文件数据",
                            err.to_string(),
                        ));
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
                in_flight.abort_all();
                let _ = sftp.close(handle_id.clone()).await;
                let _ = sftp.close_session();
                return Err(err);
            }
            Err(err) => {
                in_flight.abort_all();
                let _ = sftp.close(handle_id.clone()).await;
                let _ = sftp.close_session();
                return Err(EngineError::with_detail(
                    "sftp_transfer_failed",
                    "无法写入文件数据",
                    err.to_string(),
                ));
            }
        }
    }

    sftp.close(handle_id).await.map_err(|err| {
        EngineError::with_detail("sftp_upload_failed", "无法关闭远端文件", err.to_string())
    })?;
    let _ = sftp.close_session();
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
    let sftp = open_sftp(session).await?;
    let mut remote = sftp.open(remote_path.to_string()).await.map_err(|err| {
        EngineError::with_detail("sftp_download_failed", "无法打开远端文件", err.to_string())
    })?;
    let total = remote.metadata().await.ok().and_then(|m| m.size);
    let mut local = tokio::fs::File::create(local_path).await.map_err(|err| {
        EngineError::with_detail("sftp_download_failed", "无法创建本地文件", err.to_string())
    })?;
    transfer_with_progress(
        session_id,
        SftpProgressOp::Download,
        remote_path,
        &mut remote,
        &mut local,
        total,
        on_event,
    )
    .await
}

/// 重命名远端文件或目录。
pub async fn sftp_rename(
    session: &client::Handle<super::session::ClientHandler>,
    from: &str,
    to: &str,
) -> Result<(), EngineError> {
    let sftp = open_sftp(session).await?;
    sftp.rename(from.to_string(), to.to_string())
        .await
        .map_err(|err| {
            EngineError::with_detail("sftp_rename_failed", "无法重命名", err.to_string())
        })
}

/// 删除远端文件。
pub async fn sftp_remove(
    session: &client::Handle<super::session::ClientHandler>,
    path: &str,
) -> Result<(), EngineError> {
    let sftp = open_sftp(session).await?;
    sftp.remove_file(path.to_string())
        .await
        .map_err(|err| EngineError::with_detail("sftp_remove_failed", "无法删除", err.to_string()))
}

/// 创建远端目录。
pub async fn sftp_mkdir(
    session: &client::Handle<super::session::ClientHandler>,
    path: &str,
) -> Result<(), EngineError> {
    let sftp = open_sftp(session).await?;
    sftp.create_dir(path.to_string()).await.map_err(|err| {
        EngineError::with_detail("sftp_mkdir_failed", "无法创建目录", err.to_string())
    })
}

/// 获取远端家目录路径。
pub async fn sftp_home(
    session: &client::Handle<super::session::ClientHandler>,
) -> Result<String, EngineError> {
    let sftp = open_sftp(session).await?;
    sftp.canonicalize(".").await.map_err(|err| {
        EngineError::with_detail("sftp_home_failed", "无法获取家目录", err.to_string())
    })
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
) -> Result<(), EngineError> {
    let mut buf = vec![0u8; 256 * 1024];
    let mut transferred = 0u64;
    loop {
        let n = reader.read(&mut buf).await.map_err(|err| {
            EngineError::with_detail("sftp_transfer_failed", "无法读取文件数据", err.to_string())
        })?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).await.map_err(|err| {
            EngineError::with_detail("sftp_transfer_failed", "无法写入文件数据", err.to_string())
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
    Ok(())
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
