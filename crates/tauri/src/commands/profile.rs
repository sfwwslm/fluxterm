//! 主机配置相关命令。
use engine::{EngineError, HostProfile};
use tauri::AppHandle;
use uuid::Uuid;

use crate::commands::security::{decrypt_secret, encrypt_secret, require_secret_key};
use crate::profile_store::{read_profiles, write_profiles};

#[tauri::command]
/// 读取主机配置列表。
pub fn profile_list(app: AppHandle) -> Result<Vec<HostProfile>, EngineError> {
    let store = read_profiles(&app)?;
    let key = require_secret_key()?;
    store
        .profiles
        .into_iter()
        .map(|profile| decrypt_profile(profile, &key))
        .collect()
}

#[tauri::command]
/// 读取 SSH 分组列表。
pub fn profile_groups_list(app: AppHandle) -> Result<Vec<String>, EngineError> {
    let store = read_profiles(&app)?;
    Ok(dedupe_groups(store.ssh_groups))
}

#[tauri::command]
/// 写入 SSH 分组列表。
pub fn profile_groups_save(
    app: AppHandle,
    groups: Vec<String>,
) -> Result<Vec<String>, EngineError> {
    let mut store = read_profiles(&app)?;
    let next = dedupe_groups(groups);
    store.ssh_groups = next.clone();
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    Ok(next)
}

#[tauri::command]
/// 新增或更新主机配置。
pub fn profile_save(app: AppHandle, mut profile: HostProfile) -> Result<HostProfile, EngineError> {
    let mut store = read_profiles(&app)?;
    let key = require_secret_key()?;
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }
    if profile.port == 0 {
        profile.port = 22;
    }
    let encrypted_profile = encrypt_profile(profile.clone(), &key)?;
    let existing = store.profiles.iter_mut().find(|item| item.id == profile.id);
    if let Some(item) = existing {
        *item = encrypted_profile;
    } else {
        store.profiles.push(encrypted_profile);
    }
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    Ok(profile)
}

#[tauri::command]
/// 删除指定主机配置。
pub fn profile_remove(app: AppHandle, profile_id: String) -> Result<bool, EngineError> {
    let mut store = read_profiles(&app)?;
    let before = store.profiles.len();
    store.profiles.retain(|item| item.id != profile_id);
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    Ok(before != store.profiles.len())
}

fn encrypt_profile(mut profile: HostProfile, key: &[u8; 32]) -> Result<HostProfile, EngineError> {
    if let Some(value) = profile.password_ref.clone() {
        if value.is_empty() {
            profile.password_ref = None;
        } else {
            profile.password_ref = Some(encrypt_secret(key, &value)?);
        }
    }
    if let Some(value) = profile.private_key_passphrase_ref.clone() {
        if value.is_empty() {
            profile.private_key_passphrase_ref = None;
        } else {
            profile.private_key_passphrase_ref = Some(encrypt_secret(key, &value)?);
        }
    }
    Ok(profile)
}

fn decrypt_profile(mut profile: HostProfile, key: &[u8; 32]) -> Result<HostProfile, EngineError> {
    if let Some(value) = profile.password_ref.clone() {
        profile.password_ref = Some(decrypt_secret(key, &value)?);
    }
    if let Some(value) = profile.private_key_passphrase_ref.clone() {
        profile.private_key_passphrase_ref = Some(decrypt_secret(key, &value)?);
    }
    Ok(profile)
}

fn dedupe_groups(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut list = Vec::new();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        let key = normalized.to_lowercase();
        if seen.insert(key) {
            list.push(normalized.to_string());
        }
    }
    list.sort_by_key(|a| a.to_lowercase());
    list
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
