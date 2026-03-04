//! 系统级通用命令。
use engine::EngineError;
use tauri::{AppHandle, WebviewWindow};

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

/// 打开当前窗口的开发者工具（仅调试构建可用）。
#[tauri::command]
pub fn open_devtools(webview_window: WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        webview_window.open_devtools();
        Ok(())
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = webview_window;
        Err("open_devtools is only available in debug builds".to_string())
    }
}
