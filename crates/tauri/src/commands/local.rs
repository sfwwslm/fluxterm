//! 本地文件操作命令。
use engine::EngineError;
use tauri::{AppHandle, Manager};

use crate::local_fs::local_list_entries;

#[tauri::command]
/// 获取本机家目录路径。
pub fn local_home(app: AppHandle) -> Result<String, EngineError> {
    let path = app.path().home_dir().map_err(|err| {
        EngineError::with_detail("local_home_failed", "无法获取本机家目录", err.to_string())
    })?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
/// 获取本机目录列表。
pub fn local_list(path: String) -> Result<Vec<engine::SftpEntry>, EngineError> {
    local_list_entries(&path)
}
