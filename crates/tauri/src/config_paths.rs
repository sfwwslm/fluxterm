//! 应用配置目录路径解析。
use std::path::PathBuf;

use engine::EngineError;
use log::{debug, warn};
use tauri::{AppHandle, Manager};

const CONFIG_DIR_ENV_KEY: &str = "FLUXTERM_CONFIG_DIR";
const DEFAULT_CONFIG_DIR_NAME: &str = ".vust/flux-term";

/// 严格加载 dotenv 文件。
///
/// 行为约束：
/// - 仅加载 `crates/tauri/.env`。
/// - 若该文件存在但解析失败，返回错误，由调用方终止启动。
/// - 若该文件不存在，返回成功（继续使用默认配置）。
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

/// 解析应用配置目录。
///
/// 解析顺序：
/// 1. 环境变量 `FLUXTERM_CONFIG_DIR`（非空时优先）；
/// 2. 用户主目录下的 `.vust/flux-term`。
pub fn resolve_config_dir(app: &AppHandle) -> Result<PathBuf, EngineError> {
    let home = app.path().home_dir().map_err(|err| {
        EngineError::with_detail("config_path_failed", "无法获取用户主目录", err.to_string())
    })?;

    if let Ok(value) = std::env::var(CONFIG_DIR_ENV_KEY) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if path.is_absolute() {
                if path.starts_with(&home) {
                    debug!(
                        "config_dir_resolved source=env mode=absolute path={}",
                        path.to_string_lossy()
                    );
                    return Ok(path);
                }
                warn!(
                    "config_dir_invalid source=env mode=absolute path={} reason=outside_home",
                    path.to_string_lossy()
                );
                return Err(EngineError::new(
                    "config_path_invalid",
                    "配置目录必须位于用户主目录下",
                ));
            }
            // 相对路径统一锚定到用户主目录，避免受当前工作目录影响。
            let resolved = home.join(path);
            debug!(
                "config_dir_resolved source=env mode=relative path={}",
                resolved.to_string_lossy()
            );
            return Ok(resolved);
        }
        warn!("config_dir_env_ignored reason=empty");
    }

    let default_path = home.join(DEFAULT_CONFIG_DIR_NAME);
    debug!(
        "config_dir_resolved source=default mode=home path={}",
        default_path.to_string_lossy()
    );
    Ok(default_path)
}
