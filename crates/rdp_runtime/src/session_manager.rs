//! # SessionManager
//!
//! `session_manager` 模块负责管理所有活动的 RDP 会话及其运行时状态。
//! 它充当控制平面（处理来自前端的命令）和数据平面（将 RDP 画面帧分发给桥接器）之间的协调者。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::ws::Message;
use serde_json::json;
use tokio::sync::{broadcast, mpsc};

use crate::ironrdp_runtime::run_ironrdp_session;
use crate::protocol::{ConnectSessionRequest, InputEventPayload, SessionSnapshot};
use crate::{RuntimeError, RuntimeResult};

/// 发送给 RDP 会话运行时的控制命令。
#[derive(Debug)]
pub enum RuntimeCommand {
    /// 转发键盘或鼠标输入。
    Input(InputEventPayload),
    /// 请求调整桌面分辨率。
    Resize { width: u32, height: u32 },
    /// 同步剪贴板内容。
    Clipboard(String),
    /// 主动断开连接。
    Disconnect,
    /// 响应服务器证书决策请求。
    CertificateDecision,
}

/// 全局会话管理器，提供线程安全的会话访问。
#[derive(Debug, Clone, Default)]
pub struct SessionManager {
    inner: Arc<Mutex<HashMap<String, SessionRuntime>>>,
}

/// 维护单个活动 RDP 会话的所有运行时上下文。
#[derive(Debug, Clone)]
struct SessionRuntime {
    /// 会话的当前状态快照。
    snapshot: SessionSnapshot,
    /// 用于向该会话的所有桥接客户端广播消息的频道。
    sender: broadcast::Sender<Message>,
    /// 用于向异步 RDP 协议任务发送控制命令的频道。
    command_tx: Option<mpsc::UnboundedSender<RuntimeCommand>>,
}

impl SessionManager {
    /// 初始化一个新的会话记录。
    ///
    /// 如果会话 ID 已存在，则返回现有会话的快照。
    pub fn create_session(&self, session_id: String, profile_id: String) -> SessionSnapshot {
        let mut inner = self.inner.lock().expect("session manager mutex poisoned");
        if let Some(runtime) = inner.get(&session_id) {
            return runtime.snapshot.clone();
        }
        let (sender, _) = broadcast::channel(512);
        let snapshot = SessionSnapshot {
            session_id: session_id.clone(),
            profile_id,
            state: "idle".to_string(),
            width: 1280,
            height: 720,
            ws_url: None,
        };
        inner.insert(
            session_id,
            SessionRuntime {
                snapshot: snapshot.clone(),
                sender,
                command_tx: None,
            },
        );
        snapshot
    }

    /// 启动 RDP 协议连接流程。
    ///
    /// 此方法会生成一个异步任务 (`tokio::spawn`) 来处理实际的 RDP 网络流量。
    pub fn connect_session(
        &self,
        session_id: &str,
        profile: ConnectSessionRequest,
        ws_url: String,
    ) -> RuntimeResult<SessionSnapshot> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        let runtime = inner
            .get_mut(session_id)
            .ok_or_else(session_not_found_error)?;
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        runtime.snapshot.state = "connecting".to_string();
        runtime.snapshot.width = profile.width.max(320);
        runtime.snapshot.height = profile.height.max(200);
        runtime.snapshot.ws_url = Some(ws_url);
        runtime.command_tx = Some(command_tx);
        send_state_message(
            &runtime.sender,
            "connecting",
            "In-process session is connecting",
        );
        let sender = runtime.sender.clone();
        let session_id = session_id.to_string();
        let sessions = self.clone();
        tokio::spawn(async move {
            run_ironrdp_session(sessions, sender, session_id, profile, command_rx).await;
        });
        Ok(runtime.snapshot.clone())
    }

    /// 断开指定的 RDP 会话并清理其资源。
    pub fn disconnect_session(&self, session_id: &str) -> RuntimeResult<SessionSnapshot> {
        let snapshot = {
            let mut inner = self.inner.lock().map_err(lock_error)?;
            let runtime = inner
                .get_mut(session_id)
                .ok_or_else(session_not_found_error)?;
            send_runtime_command(&runtime.command_tx, RuntimeCommand::Disconnect);
            set_runtime_state(runtime, "disconnected");
            send_state_message(&runtime.sender, "disconnected", "session closed");
            runtime.snapshot.clone()
        };
        self.remove_session(session_id)?;
        Ok(snapshot)
    }

    /// 请求调整 RDP 桌面分辨率。
    pub fn resize_session(
        &self,
        session_id: &str,
        width: u32,
        height: u32,
    ) -> RuntimeResult<SessionSnapshot> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        let runtime = inner
            .get_mut(session_id)
            .ok_or_else(session_not_found_error)?;
        runtime.snapshot.width = width.max(320);
        runtime.snapshot.height = height.max(200);
        send_runtime_command(
            &runtime.command_tx,
            RuntimeCommand::Resize {
                width: runtime.snapshot.width,
                height: runtime.snapshot.height,
            },
        );
        let _ = runtime.sender.send(json_message(
            "state",
            json!({
                "state": runtime.snapshot.state,
                "message": "desktop resized",
                "width": runtime.snapshot.width,
                "height": runtime.snapshot.height,
            }),
        ));
        Ok(runtime.snapshot.clone())
    }

    /// 向远端会话转发输入事件。
    pub fn send_input(&self, session_id: &str, input: InputEventPayload) -> RuntimeResult<()> {
        let inner = self.inner.lock().map_err(lock_error)?;
        let runtime = inner.get(session_id).ok_or_else(session_not_found_error)?;
        send_runtime_command(&runtime.command_tx, RuntimeCommand::Input(input.clone()));
        let _ = runtime.sender.send(json_message(
            "input-ack",
            json!({
                "kind": input.kind,
            }),
        ));
        Ok(())
    }

    /// 请求同步剪贴板到远程桌面。
    pub fn set_clipboard(&self, session_id: &str, text: String) -> RuntimeResult<()> {
        let inner = self.inner.lock().map_err(lock_error)?;
        let runtime = inner.get(session_id).ok_or_else(session_not_found_error)?;
        send_runtime_command(&runtime.command_tx, RuntimeCommand::Clipboard(text.clone()));
        let _ = runtime.sender.send(json_message(
            "clipboard",
            json!({
                "direction": "local-to-remote",
                "text": text,
            }),
        ));
        Ok(())
    }

    /// 同步证书决策结果到 RDP 协议栈。
    pub fn decide_certificate(
        &self,
        session_id: &str,
        accept: bool,
    ) -> RuntimeResult<SessionSnapshot> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        let runtime = inner
            .get_mut(session_id)
            .ok_or_else(session_not_found_error)?;
        send_runtime_command(&runtime.command_tx, RuntimeCommand::CertificateDecision);
        set_runtime_state(runtime, if accept { "connecting" } else { "disconnected" });
        let _ = runtime.sender.send(json_message(
            "state",
            json!({
                "state": runtime.snapshot.state,
                "message": if accept { "certificate accepted" } else { "certificate rejected" },
            }),
        ));
        Ok(runtime.snapshot.clone())
    }

    /// 允许 WebSocket 处理器订阅特定会话的消息流。
    pub fn subscribe(
        &self,
        session_id: &str,
    ) -> RuntimeResult<(SessionSnapshot, broadcast::Receiver<Message>)> {
        let inner = self.inner.lock().map_err(lock_error)?;
        let runtime = inner.get(session_id).ok_or_else(session_not_found_error)?;
        Ok((runtime.snapshot.clone(), runtime.sender.subscribe()))
    }

    /// 从管理器中移除一个已结束的会话。
    pub fn remove_session(&self, session_id: &str) -> RuntimeResult<()> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        inner.remove(session_id);
        Ok(())
    }

    /// 强制清空所有活动会话。
    pub fn clear(&self) -> RuntimeResult<()> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        inner.clear();
        Ok(())
    }

    /// 回写运行时上报的最新连接状态，并广播给所有桥接订阅者。
    ///
    /// 这保证 `SessionSnapshot.state` 与桥接消息保持一致，避免后续 resize 等事件
    /// 继续夹带旧状态覆盖前端 UI。
    pub fn publish_runtime_state(
        &self,
        session_id: &str,
        state: &str,
        message: impl Into<String>,
    ) -> RuntimeResult<()> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        let runtime = inner
            .get_mut(session_id)
            .ok_or_else(session_not_found_error)?;
        set_runtime_state(runtime, state);
        send_state_message(&runtime.sender, state, &message.into());
        Ok(())
    }
}

/// 辅助函数：构造一个包含 JSON 载荷的 WebSocket 文本消息。
pub fn json_message(kind: &str, body: serde_json::Value) -> Message {
    let mut object = serde_json::Map::new();
    object.insert(
        "type".to_string(),
        serde_json::Value::String(kind.to_string()),
    );
    if let serde_json::Value::Object(map) = body {
        object.extend(map);
    }
    Message::Text(serde_json::Value::Object(object).to_string().into())
}

/// 辅助函数：构造一个 RGBA 脏矩形帧的二进制消息。
///
/// 协议布局：
/// `[Type:1][X:4][Y:4][Width:4][Height:4][SurfaceW:4][SurfaceH:4][Pixels:...]`
pub fn build_rgba_frame_message<F>(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    surface_width: u32,
    surface_height: u32,
    pixels_provider: F,
) -> Message
where
    F: FnOnce(&mut Vec<u8>),
{
    let pixel_count = (width * height * 4) as usize;
    let mut bytes = Vec::with_capacity(25 + pixel_count);
    bytes.push(1);
    bytes.extend_from_slice(&x.to_le_bytes());
    bytes.extend_from_slice(&y.to_le_bytes());
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&surface_width.to_le_bytes());
    bytes.extend_from_slice(&surface_height.to_le_bytes());
    pixels_provider(&mut bytes);
    Message::Binary(bytes.into())
}

/// 辅助函数：构造一个包含多个脏矩形的批量二进制消息。
///
/// 相比于发送多个单矩形消息，批量发送能有效降低 WebSocket 开销。
pub fn build_rgba_frame_batch_message<F>(
    surface_width: u32,
    surface_height: u32,
    rects_info: &[(u32, u32, u32, u32)],
    mut pixels_provider: F,
) -> Message
where
    F: FnMut(usize, &mut Vec<u8>),
{
    let mut total_pixel_bytes = 0;
    for (_, _, width, height) in rects_info {
        total_pixel_bytes += (*width as usize) * (*height as usize) * 4;
    }

    let total_len = 13 + (rects_info.len() * 16) + total_pixel_bytes;
    let mut bytes = Vec::with_capacity(total_len);

    bytes.push(2); // Batch type
    bytes.extend_from_slice(&surface_width.to_le_bytes());
    bytes.extend_from_slice(&surface_height.to_le_bytes());
    bytes.extend_from_slice(&(rects_info.len() as u32).to_le_bytes());

    for (i, &(x, y, width, height)) in rects_info.iter().enumerate() {
        bytes.extend_from_slice(&x.to_le_bytes());
        bytes.extend_from_slice(&y.to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        pixels_provider(i, &mut bytes);
    }

    Message::Binary(bytes.into())
}

fn send_runtime_command(
    command_tx: &Option<mpsc::UnboundedSender<RuntimeCommand>>,
    command: RuntimeCommand,
) {
    if let Some(command_tx) = command_tx {
        let _ = command_tx.send(command);
    }
}

fn send_state_message(sender: &broadcast::Sender<Message>, state: &str, message: &str) {
    let _ = sender.send(json_message(
        "state",
        json!({
            "state": state,
            "message": message,
        }),
    ));
}

fn set_runtime_state(runtime: &mut SessionRuntime, state: &str) {
    runtime.snapshot.state = state.to_string();
}

fn session_not_found_error() -> RuntimeError {
    RuntimeError::new("rdp_session_not_found", "RDP 会话不存在")
}

fn lock_error<T>(_: std::sync::PoisonError<std::sync::MutexGuard<'_, T>>) -> RuntimeError {
    RuntimeError::new("rdp_runtime_poisoned", "RDP 运行时状态损坏")
}
