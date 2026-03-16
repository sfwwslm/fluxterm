//! 主机配置的本地存储。
use std::fs;
use std::path::PathBuf;

use engine::{EngineError, HostProfile};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;

use crate::config_paths::resolve_profiles_path;
use crate::telemetry::{TelemetryLevel, log_telemetry};
use crate::utils::write_atomic;

/// 主密码配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretConfig {
    pub version: u32,
    pub provider: String,
    #[serde(default)]
    pub active_key_id: Option<String>,
    #[serde(default)]
    pub kdf_salt: Option<String>,
    #[serde(default)]
    pub verify_hash: Option<String>,
}

/// 主机配置存储结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileStore {
    pub version: u32,
    pub updated_at: u64,
    #[serde(default)]
    pub ssh_groups: Vec<String>,
    #[serde(default)]
    pub secret: Option<SecretConfig>,
    pub profiles: Vec<HostProfile>,
}

impl Default for ProfileStore {
    fn default() -> Self {
        Self {
            version: 1,
            updated_at: now_epoch(),
            ssh_groups: Vec::new(),
            secret: Some(SecretConfig {
                version: 1,
                provider: "plaintext".to_string(),
                active_key_id: None,
                kdf_salt: None,
                verify_hash: None,
            }),
            profiles: Vec::new(),
        }
    }
}

/// 读取配置文件。
///
/// 职责：
/// 1. 若 profiles.json 不存在，返回默认明文存储结构。
/// 2. 反序列化磁盘内容并注入内存。
pub fn read_profiles(app: &AppHandle) -> Result<ProfileStore, EngineError> {
    let path = profiles_path(app)?;
    if !path.exists() {
        log_telemetry(
            TelemetryLevel::Debug,
            "profile.read.skipped",
            None,
            json!({
                "reason": "notFound",
            }),
        );
        return Ok(ProfileStore::default());
    }
    let content = fs::read_to_string(&path).map_err(|err| {
        EngineError::with_detail("profile_read_failed", "无法读取配置文件", err.to_string())
    })?;
    log_telemetry(
        TelemetryLevel::Debug,
        "profile.read.success",
        None,
        json!({
            "path": path.display().to_string(),
            "size": content.len(),
        }),
    );
    serde_json::from_str(&content).map_err(|err| {
        EngineError::with_detail("profile_parse_failed", "配置文件解析失败", err.to_string())
    })
}

/// 写入配置文件。
pub fn write_profiles(app: &AppHandle, store: &ProfileStore) -> Result<(), EngineError> {
    let path = profiles_path(app)?;
    let content = serde_json::to_string_pretty(store).map_err(|err| {
        EngineError::with_detail(
            "profile_write_failed",
            "无法序列化配置文件",
            err.to_string(),
        )
    })?;
    log_telemetry(
        TelemetryLevel::Debug,
        "profile.write.start",
        None,
        json!({
            "path": path.display().to_string(),
        }),
    );
    write_atomic(path, &content)
}

fn profiles_path(app: &AppHandle) -> Result<PathBuf, EngineError> {
    resolve_profiles_path(app)
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
