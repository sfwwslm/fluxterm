//! 串口 Profile 存储。

use std::fs;
use std::path::PathBuf;

use engine::EngineError;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config_paths::{resolve_serial_groups_path, resolve_serial_profiles_path};
use crate::serial::SerialProfile;
use crate::utils::write_atomic;

/// 串口 Profile 文件结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialProfileStore {
    pub version: u32,
    pub updated_at: u64,
    #[serde(default)]
    pub profiles: Vec<SerialProfile>,
}

impl Default for SerialProfileStore {
    fn default() -> Self {
        Self {
            version: 1,
            updated_at: now_epoch(),
            profiles: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GroupStore {
    version: u32,
    updated_at: u64,
    #[serde(default)]
    groups: Vec<String>,
}

impl Default for GroupStore {
    fn default() -> Self {
        Self {
            version: 1,
            updated_at: now_epoch(),
            groups: Vec::new(),
        }
    }
}

/// 读取串口 Profile 列表。
pub fn read_serial_profiles(app: &AppHandle) -> Result<SerialProfileStore, EngineError> {
    let path = profiles_path(app)?;
    if !path.exists() {
        return Ok(SerialProfileStore::default());
    }
    let content = fs::read_to_string(&path).map_err(|err| {
        EngineError::with_detail(
            "serial_profile_read_failed",
            "无法读取串口配置文件",
            err.to_string(),
        )
    })?;
    serde_json::from_str(&content).map_err(|err| {
        EngineError::with_detail(
            "serial_profile_parse_failed",
            "串口配置文件解析失败",
            err.to_string(),
        )
    })
}

/// 写入串口 Profile 列表。
pub fn write_serial_profiles(
    app: &AppHandle,
    store: &SerialProfileStore,
) -> Result<(), EngineError> {
    let path = profiles_path(app)?;
    let content = serde_json::to_string_pretty(store).map_err(|err| {
        EngineError::with_detail(
            "serial_profile_write_failed",
            "无法序列化串口配置文件",
            err.to_string(),
        )
    })?;
    write_atomic(path, &content)
}

/// 读取串口分组列表。
pub fn read_serial_groups(app: &AppHandle) -> Result<Vec<String>, EngineError> {
    let path = groups_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|err| {
        EngineError::with_detail(
            "serial_group_read_failed",
            "无法读取串口分组文件",
            err.to_string(),
        )
    })?;
    let store: GroupStore = serde_json::from_str(&content).map_err(|err| {
        EngineError::with_detail(
            "serial_group_parse_failed",
            "串口分组文件解析失败",
            err.to_string(),
        )
    })?;
    Ok(store.groups)
}

/// 写入串口分组列表。
pub fn write_serial_groups(app: &AppHandle, groups: &[String]) -> Result<(), EngineError> {
    let path = groups_path(app)?;
    let content = serde_json::to_string_pretty(&GroupStore {
        version: 1,
        updated_at: now_epoch(),
        groups: groups.to_vec(),
    })
    .map_err(|err| {
        EngineError::with_detail(
            "serial_group_write_failed",
            "无法序列化串口分组文件",
            err.to_string(),
        )
    })?;
    write_atomic(path, &content)
}

fn profiles_path(app: &AppHandle) -> Result<PathBuf, EngineError> {
    resolve_serial_profiles_path(app)
}

fn groups_path(app: &AppHandle) -> Result<PathBuf, EngineError> {
    resolve_serial_groups_path(app)
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
