//! 系统级通用命令。
use engine::EngineError;
use tauri::AppHandle;

use crate::config_paths::{resolve_config_root_dir, resolve_data_root_dir};

/// 返回应用配置目录绝对路径。
#[tauri::command]
pub fn app_config_dir(app: AppHandle) -> Result<String, EngineError> {
    let path = resolve_config_root_dir(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

/// 返回应用数据目录绝对路径。
#[tauri::command]
pub fn app_data_dir(app: AppHandle) -> Result<String, EngineError> {
    let path = resolve_data_root_dir(&app)?;
    Ok(path.to_string_lossy().into_owned())
}
