//! 本地 Shell 命令。
use engine::{EngineError, Session, TerminalSize};
use tauri::{AppHandle, State};

use crate::local_shell::{
    LocalShellProfile, LocalShellState, list_local_shells, resize_local_shell, start_local_shell,
    stop_local_shell, write_local_shell,
};

#[tauri::command]
/// 列出本地可用 Shell。
pub fn local_shell_list() -> Vec<LocalShellProfile> {
    list_local_shells()
}

#[tauri::command]
/// 启动本地 Shell 会话。
pub fn local_shell_connect(
    app: AppHandle,
    state: State<LocalShellState>,
    shell_id: Option<String>,
    size: TerminalSize,
) -> Result<Session, EngineError> {
    start_local_shell(app, &state, shell_id, size)
}

#[tauri::command]
/// 写入本地 Shell 数据。
pub fn local_shell_write(
    state: State<LocalShellState>,
    session_id: String,
    data: String,
) -> Result<(), EngineError> {
    write_local_shell(&state, &session_id, &data)
}

#[tauri::command]
/// 调整本地 Shell 终端尺寸。
pub fn local_shell_resize(
    state: State<LocalShellState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), EngineError> {
    resize_local_shell(&state, &session_id, cols, rows)
}

#[tauri::command]
/// 关闭本地 Shell 会话。
pub fn local_shell_disconnect(
    state: State<LocalShellState>,
    session_id: String,
) -> Result<(), EngineError> {
    stop_local_shell(&state, &session_id)
}
