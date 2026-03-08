//! 系统级通用命令。
use engine::EngineError;
use serde::Serialize;
use sysinfo::System;
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

/// 系统信息快照。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoDto {
    /// 操作系统名称（例如 Windows、macOS、Linux）。
    pub os_name: String,
    /// 操作系统版本（例如 11、15.4）。
    pub os_version: String,
    /// 内核版本。
    pub kernel_version: String,
    /// CPU 架构（例如 x86_64、aarch64）。
    pub arch: String,
}

/// 返回当前系统与架构信息。
#[tauri::command]
pub fn get_system_info() -> SystemInfoDto {
    let os_name = System::name().unwrap_or_else(|| "unknown".to_string());
    let os_version = System::os_version().unwrap_or_else(|| "unknown".to_string());
    let kernel_version = System::kernel_version().unwrap_or_else(|| "unknown".to_string());
    let arch = {
        let value = System::cpu_arch();
        if value.is_empty() {
            std::env::consts::ARCH.to_string()
        } else {
            value
        }
    };
    SystemInfoDto {
        os_name,
        os_version,
        kernel_version,
        arch,
    }
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
