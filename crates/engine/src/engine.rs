//! 引擎核心实现。
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::runtime::Runtime;
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::error::EngineError;
use crate::proxy_backend::{BuiltinProxyBackend, ProxyBackend};
use crate::session::{ExpectedHostKey, SessionCommand, SessionHandle, run_session_loop};
use crate::types::{
    EventCallback, HostProfile, ProxyRuntime, ProxySpec, Session, SessionState, SftpEntry,
    SshTunnelRuntime, SshTunnelSpec, TerminalSize,
};
use crate::util::now_epoch;
use log::info;

/// 会话引擎，负责连接管理与命令分发。
pub struct Engine {
    sessions: Mutex<HashMap<String, SessionHandle>>,
    proxy_backend: Arc<dyn ProxyBackend>,
    runtime: Arc<Runtime>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    /// 创建新的引擎实例。
    pub fn new() -> Self {
        let runtime = Arc::new(Runtime::new().expect("failed to create runtime"));
        Self {
            sessions: Mutex::new(HashMap::new()),
            proxy_backend: Arc::new(BuiltinProxyBackend::new(Arc::clone(&runtime))),
            runtime,
        }
    }

    /// 建立 SSH 会话并启动后台处理循环。
    pub fn connect(
        &self,
        profile: HostProfile,
        expected_host_key: Option<ExpectedHostKey>,
        size: TerminalSize,
        on_event: EventCallback,
    ) -> Result<Session, EngineError> {
        let session_id = Uuid::new_v4().to_string();
        let created_at = now_epoch();
        let (tx, rx) = mpsc::unbounded_channel();

        info!(
            "ssh_connect_start profile_id={} host={} user={}",
            profile.id, profile.host, profile.username
        );
        on_event(crate::types::EngineEvent::SessionStatus {
            session_id: session_id.clone(),
            state: SessionState::Connecting,
            error: None,
        });

        let runtime = Arc::clone(&self.runtime);
        let session_id_clone = session_id.clone();
        let profile_clone = profile.clone();
        let on_event_clone = Arc::clone(&on_event);

        runtime.spawn(async move {
            let result = run_session_loop(
                session_id_clone.clone(),
                profile_clone,
                expected_host_key,
                size,
                rx,
                on_event_clone,
            )
            .await;
            if let Err(err) = result {
                on_event(crate::types::EngineEvent::SessionStatus {
                    session_id: session_id_clone.clone(),
                    state: SessionState::Error,
                    error: Some(err),
                });
            }
        });

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), SessionHandle { tx });

        Ok(Session {
            session_id,
            profile_id: profile.id,
            state: SessionState::Connecting,
            created_at,
            last_error: None,
        })
    }

    /// 断开指定会话。
    pub fn disconnect(&self, session_id: &str) -> Result<(), EngineError> {
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .remove(session_id)
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::Disconnect)
            .map_err(|_| EngineError::new("session_command_failed", "无法发送断开命令"))?;
        Ok(())
    }

    /// 向会话写入终端输入数据。
    pub fn write(&self, session_id: &str, data: Vec<u8>) -> Result<(), EngineError> {
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::Write(data))
            .map_err(|_| EngineError::new("session_command_failed", "无法发送输入数据"))?;
        Ok(())
    }

    /// 调整会话终端尺寸。
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), EngineError> {
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::Resize { cols, rows })
            .map_err(|_| EngineError::new("session_command_failed", "无法调整终端尺寸"))?;
        Ok(())
    }

    /// 获取远端目录列表。
    pub fn sftp_list(&self, session_id: &str, path: &str) -> Result<Vec<SftpEntry>, EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpList {
                path: path.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送 SFTP 列表命令"))?;
        self.await_response(resp_rx, "无法接收 SFTP 列表响应")
    }

    /// 获取远端家目录。
    pub fn sftp_home(&self, session_id: &str) -> Result<String, EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpHome {
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送 SFTP Home 命令"))?;
        self.await_response(resp_rx, "无法接收 SFTP Home 响应")
    }

    /// 解析远端路径到真实路径。
    pub fn sftp_resolve_path(&self, session_id: &str, path: &str) -> Result<String, EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpResolvePath {
                path: path.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| {
                EngineError::new("session_command_failed", "无法发送 SFTP 路径解析命令")
            })?;
        self.await_response(resp_rx, "无法接收 SFTP 路径解析响应")
    }

    /// 上传本地文件到远端。
    pub fn sftp_upload(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpUpload {
                local_path: local_path.to_string(),
                remote_path: remote_path.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送 SFTP 上传命令"))?;
        self.await_response(resp_rx, "无法接收 SFTP 上传响应")
    }

    /// 批量上传本地文件或目录到远端目录。
    pub fn sftp_upload_batch(
        &self,
        session_id: &str,
        local_paths: &[String],
        remote_dir: &str,
    ) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpUploadBatch {
                local_paths: local_paths.to_vec(),
                remote_dir: remote_dir.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| {
                EngineError::new("session_command_failed", "无法发送 SFTP 批量上传命令")
            })?;
        self.await_response(resp_rx, "无法接收 SFTP 批量上传响应")
    }

    /// 下载远端文件到本地。
    pub fn sftp_download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpDownload {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送 SFTP 下载命令"))?;
        self.await_response(resp_rx, "无法接收 SFTP 下载响应")
    }

    /// 下载远端目录到本地目录。
    pub fn sftp_download_dir(
        &self,
        session_id: &str,
        remote_path: &str,
        local_dir: &str,
    ) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpDownloadDir {
                remote_path: remote_path.to_string(),
                local_dir: local_dir.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| {
                EngineError::new("session_command_failed", "无法发送 SFTP 目录下载命令")
            })?;
        self.await_response(resp_rx, "无法接收 SFTP 目录下载响应")
    }

    /// 取消指定传输任务。
    pub fn sftp_cancel_transfer(
        &self,
        session_id: &str,
        transfer_id: &str,
    ) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpCancelTransfer {
                transfer_id: transfer_id.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| {
                EngineError::new("session_command_failed", "无法发送 SFTP 取消传输命令")
            })?;
        self.await_response(resp_rx, "无法接收 SFTP 取消传输响应")
    }

    /// 重命名远端文件或目录。
    pub fn sftp_rename(&self, session_id: &str, from: &str, to: &str) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpRename {
                from: from.to_string(),
                to: to.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送 SFTP 重命名命令"))?;
        self.await_response(resp_rx, "无法接收 SFTP 重命名响应")
    }

    /// 删除远端文件。
    pub fn sftp_remove(&self, session_id: &str, path: &str) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpRemove {
                path: path.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送 SFTP 删除命令"))?;
        self.await_response(resp_rx, "无法接收 SFTP 删除响应")
    }

    /// 创建远端目录。
    pub fn sftp_mkdir(&self, session_id: &str, path: &str) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::SftpMkdir {
                path: path.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| {
                EngineError::new("session_command_failed", "无法发送 SFTP 创建目录命令")
            })?;
        self.await_response(resp_rx, "无法接收 SFTP 创建目录响应")
    }

    /// 打开 SSH 隧道。
    pub fn tunnel_open(
        &self,
        session_id: &str,
        spec: SshTunnelSpec,
    ) -> Result<SshTunnelRuntime, EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::TunnelOpen {
                spec,
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送隧道创建命令"))?;
        self.await_response(resp_rx, "无法接收隧道创建响应")
    }

    /// 关闭 SSH 隧道。
    pub fn tunnel_close(&self, session_id: &str, tunnel_id: &str) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::TunnelClose {
                tunnel_id: tunnel_id.to_string(),
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送隧道关闭命令"))?;
        self.await_response(resp_rx, "无法接收隧道关闭响应")
    }

    /// 列出会话下所有 SSH 隧道。
    pub fn tunnel_list(&self, session_id: &str) -> Result<Vec<SshTunnelRuntime>, EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::TunnelList {
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送隧道列表命令"))?;
        self.await_response(resp_rx, "无法接收隧道列表响应")
    }

    /// 关闭会话下全部 SSH 隧道。
    pub fn tunnel_close_all(&self, session_id: &str) -> Result<(), EngineError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| EngineError::new("session_not_found", "会话不存在"))?;
        handle
            .tx
            .send(SessionCommand::TunnelCloseAll {
                respond_to: resp_tx,
            })
            .map_err(|_| EngineError::new("session_command_failed", "无法发送隧道批量关闭命令"))?;
        self.await_response(resp_rx, "无法接收隧道批量关闭响应")
    }

    /// 创建全局代理实例。
    pub fn proxy_open(
        &self,
        spec: ProxySpec,
        on_event: EventCallback,
        trace_id: Option<&str>,
    ) -> Result<ProxyRuntime, EngineError> {
        self.proxy_backend.open(spec, on_event, trace_id)
    }

    /// 关闭全局代理实例。
    pub fn proxy_close(&self, proxy_id: &str, trace_id: Option<&str>) -> Result<(), EngineError> {
        self.proxy_backend.close(proxy_id, trace_id)
    }

    /// 获取全局代理实例列表。
    pub fn proxy_list(&self) -> Result<Vec<ProxyRuntime>, EngineError> {
        self.proxy_backend.list()
    }

    /// 关闭全部全局代理实例。
    pub fn proxy_close_all(&self, trace_id: Option<&str>) -> Result<(), EngineError> {
        self.proxy_backend.close_all(trace_id)
    }

    /// 等待后台响应并转换为同步结果。
    fn await_response<T>(
        &self,
        rx: oneshot::Receiver<Result<T, EngineError>>,
        message: &str,
    ) -> Result<T, EngineError> {
        self.runtime.block_on(async {
            rx.await
                .map_err(|_| EngineError::new("session_command_failed", message))
        })?
    }
}
