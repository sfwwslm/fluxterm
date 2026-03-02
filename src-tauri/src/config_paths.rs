//! 应用配置目录路径解析。
use std::path::PathBuf;

use engine::EngineError;
use log::{debug, warn};
use tauri::{AppHandle, Manager};

const CONFIG_DIR_ENV_KEY: &str = "FLUXTERM_CONFIG_DIR";
const DEFAULT_CONFIG_DIR_NAME: &str = ".vust/flux-term";

/// 严格加载 dotenv 文件（仅 debug 构建启用）。
///
/// 行为约束：
/// - 仅加载 `crates/tauri/.env`。
/// - 若该文件存在但解析失败，返回错误，由调用方终止启动。
/// - 若该文件不存在，返回成功（继续使用默认配置）。
#[cfg(debug_assertions)]
pub fn load_dotenv_strict() -> Result<(), String> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let tauri_env_path = manifest_dir.join(".env");
    if tauri_env_path.exists() {
        return dotenvy::from_path(&tauri_env_path).map_err(|err| {
            format!(
                "[flux-term] failed to load dotenv from {}: {}",
                tauri_env_path.display(),
                err
            )
        });
    }

    Ok(())
}

/// release 构建不加载 dotenv，避免本地开发文件影响生产行为。
#[cfg(not(debug_assertions))]
pub fn load_dotenv_strict() -> Result<(), String> {
    Ok(())
}

/// 解析应用配置根目录。
pub fn resolve_config_root_dir(app: &AppHandle) -> Result<PathBuf, EngineError> {
    let home = app.path().home_dir().map_err(|err| {
        EngineError::with_detail("config_path_failed", "无法获取用户主目录", err.to_string())
    })?;

    if let Ok(value) = std::env::var(CONFIG_DIR_ENV_KEY) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            let resolved = if path.is_absolute() {
                path
            } else {
                // 相对路径统一锚定到用户主目录，避免受当前工作目录影响。
                home.join(path)
            };
            debug!(
                "config_dir_resolved source=env path={}",
                resolved.to_string_lossy()
            );
            return Ok(resolved);
        }
        warn!("config_dir_env_ignored reason=empty");
    }

    Ok(home.join(DEFAULT_CONFIG_DIR_NAME))
}

/// 解析应用数据根目录。
pub fn resolve_data_root_dir(app: &AppHandle) -> Result<PathBuf, EngineError> {
    app.path().app_data_dir().map_err(|err| {
        EngineError::with_detail("data_path_failed", "无法获取应用数据目录", err.to_string())
    })
}

/// 解析应用级配置目录。
pub fn resolve_global_config_dir(app: &AppHandle) -> Result<PathBuf, EngineError> {
    let dir = resolve_config_root_dir(app)?;
    Ok(dir.join("global"))
}

/// 解析终端域配置目录。
pub fn resolve_terminal_config_dir(app: &AppHandle) -> Result<PathBuf, EngineError> {
    let dir = resolve_config_root_dir(app)?;
    Ok(dir.join("terminal"))
}

/// 解析主机配置文件路径。
pub fn resolve_profiles_path(app: &AppHandle) -> Result<PathBuf, EngineError> {
    let dir = resolve_global_config_dir(app)?;
    Ok(dir.join("profiles.json"))
}
