//! SSH 会话相关命令。
use engine::{EngineError, HostProfile, Session, TerminalSize};
use tauri::{AppHandle, State};

use crate::events::build_event_bridge;
use crate::resource_monitor::ResourceMonitorState;
use crate::state::EngineState;

#[tauri::command]
/// 建立 SSH 会话连接。
pub fn ssh_connect(
    app: AppHandle,
    state: State<EngineState>,
    profile: HostProfile,
    size: TerminalSize,
) -> Result<Session, EngineError> {
    let on_event = build_event_bridge(app.clone());
    state.engine.connect(profile, size, on_event)
}

#[tauri::command]
/// 断开 SSH 会话连接。
pub fn ssh_disconnect(
    state: State<EngineState>,
    monitor_state: State<ResourceMonitorState>,
    session_id: String,
) -> Result<(), EngineError> {
    monitor_state.stop(&session_id);
    state.engine.disconnect(&session_id)
}

#[tauri::command]
/// 调整会话终端尺寸。
pub fn ssh_resize(
    state: State<EngineState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), EngineError> {
    state.engine.resize(&session_id, cols, rows)
}

#[tauri::command]
/// 发送终端输入数据。
pub fn ssh_write(
    state: State<EngineState>,
    session_id: String,
    data: String,
) -> Result<(), EngineError> {
    state.engine.write(&session_id, data.into_bytes())
}
