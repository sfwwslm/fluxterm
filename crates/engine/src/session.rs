//! 会话执行与命令分发。
use std::sync::Arc;

use russh::client;
use russh::keys;
use tokio::sync::mpsc;

use crate::auth::authenticate;
use crate::error::EngineError;
use crate::sftp::{
    sftp_download, sftp_home, sftp_list, sftp_mkdir, sftp_remove, sftp_rename, sftp_resolve_path,
    sftp_upload,
};
use crate::types::{
    EngineEvent, EventCallback, HostProfile, SessionState, SftpEntry, TerminalSize,
};

/// 会话发送通道句柄。
#[derive(Clone)]
pub struct SessionHandle {
    pub tx: mpsc::UnboundedSender<SessionCommand>,
}

/// 会话内部命令。
pub enum SessionCommand {
    Write(Vec<u8>),
    Resize {
        cols: u16,
        rows: u16,
    },
    SftpList {
        path: String,
        respond_to: tokio::sync::oneshot::Sender<Result<Vec<SftpEntry>, EngineError>>,
    },
    SftpHome {
        respond_to: tokio::sync::oneshot::Sender<Result<String, EngineError>>,
    },
    SftpResolvePath {
        path: String,
        respond_to: tokio::sync::oneshot::Sender<Result<String, EngineError>>,
    },
    SftpUpload {
        local_path: String,
        remote_path: String,
        respond_to: tokio::sync::oneshot::Sender<Result<(), EngineError>>,
    },
    SftpDownload {
        remote_path: String,
        local_path: String,
        respond_to: tokio::sync::oneshot::Sender<Result<(), EngineError>>,
    },
    SftpRename {
        from: String,
        to: String,
        respond_to: tokio::sync::oneshot::Sender<Result<(), EngineError>>,
    },
    SftpRemove {
        path: String,
        respond_to: tokio::sync::oneshot::Sender<Result<(), EngineError>>,
    },
    SftpMkdir {
        path: String,
        respond_to: tokio::sync::oneshot::Sender<Result<(), EngineError>>,
    },
    Disconnect,
}

/// SSH 客户端回调处理器。
pub struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// 会话主循环，负责 SSH 与 SFTP 命令处理。
pub async fn run_session_loop(
    session_id: String,
    profile: HostProfile,
    size: TerminalSize,
    mut rx: mpsc::UnboundedReceiver<SessionCommand>,
    on_event: EventCallback,
) -> Result<(), EngineError> {
    let addr = format!("{}:{}", profile.host, profile.port);
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, addr, ClientHandler)
        .await
        .map_err(|err| {
            EngineError::with_detail("ssh_connect_failed", "无法连接到目标主机", err.to_string())
        })?;

    authenticate(&mut session, &profile).await?;

    let mut channel = session.channel_open_session().await.map_err(|err| {
        EngineError::with_detail(
            "ssh_channel_open_failed",
            "无法打开会话通道",
            err.to_string(),
        )
    })?;
    channel
        .request_pty(
            true,
            "xterm-256color",
            size.cols as u32,
            size.rows as u32,
            0,
            0,
            &[],
        )
        .await
        .map_err(|err| {
            EngineError::with_detail("ssh_pty_failed", "无法请求终端 PTY", err.to_string())
        })?;
    channel.request_shell(true).await.map_err(|err| {
        EngineError::with_detail("ssh_shell_failed", "无法启动 shell", err.to_string())
    })?;

    // 只有在 PTY 和交互 shell 都就绪后，前端才应把会话视为真正可用。
    // 这样 files 面板首轮触发的 SFTP 初始化不会抢在首屏横幅/提示符输出之前，
    // 避免首个 SSH 会话在冷启动阶段出现“横幅缺失 + SFTP checking 卡住”的竞态。
    on_event(EngineEvent::SessionStatus {
        session_id: session_id.clone(),
        state: SessionState::Connected,
        error: None,
    });

    let mut running = true;

    while running {
        tokio::select! {
            Some(cmd) = rx.recv() => {
                match cmd {
                    SessionCommand::Write(data) => {
                        let _ = channel.data(&data[..]).await;
                    }
                    SessionCommand::Resize { cols, rows } => {
                        let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                    }
                    SessionCommand::SftpList { path, respond_to } => {
                        let _ = respond_to.send(sftp_list(&session, &path).await);
                    }
                    SessionCommand::SftpHome { respond_to } => {
                        let _ = respond_to.send(sftp_home(&session).await);
                    }
                    SessionCommand::SftpResolvePath { path, respond_to } => {
                        let _ = respond_to.send(sftp_resolve_path(&session, &path).await);
                    }
                    SessionCommand::SftpUpload { local_path, remote_path, respond_to } => {
                        let _ = respond_to.send(sftp_upload(&session, &session_id, &local_path, &remote_path, &on_event).await);
                    }
                    SessionCommand::SftpDownload { remote_path, local_path, respond_to } => {
                        let _ = respond_to.send(sftp_download(&session, &session_id, &remote_path, &local_path, &on_event).await);
                    }
                    SessionCommand::SftpRename { from, to, respond_to } => {
                        let _ = respond_to.send(sftp_rename(&session, &from, &to).await);
                    }
                    SessionCommand::SftpRemove { path, respond_to } => {
                        let _ = respond_to.send(sftp_remove(&session, &path).await);
                    }
                    SessionCommand::SftpMkdir { path, respond_to } => {
                        let _ = respond_to.send(sftp_mkdir(&session, &path).await);
                    }
                    SessionCommand::Disconnect => {
                        let _ = channel.eof().await;
                        let _ = channel.close().await;
                        running = false;
                    }
                }
            }
            result = channel.wait() => {
                match result {
                    Some(russh::ChannelMsg::Data { data }) => {
                        let text = String::from_utf8_lossy(data.as_ref()).to_string();
                        on_event(EngineEvent::TerminalOutput { session_id: session_id.clone(), data: text });
                    }
                    Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                        let text = String::from_utf8_lossy(data.as_ref()).to_string();
                        on_event(EngineEvent::TerminalOutput { session_id: session_id.clone(), data: text });
                    }
                    Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                        running = false;
                    }
                    Some(_) => {}
                }
            }
        }
    }

    on_event(EngineEvent::TerminalExit {
        session_id: session_id.clone(),
    });
    on_event(EngineEvent::SessionStatus {
        session_id,
        state: SessionState::Disconnected,
        error: None,
    });
    Ok(())
}
