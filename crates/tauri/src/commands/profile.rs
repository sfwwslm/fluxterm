//! 主机配置相关命令。
use engine::{EngineError, HostProfile};
use tauri::AppHandle;
use uuid::Uuid;

use crate::profile_store::{read_profiles, write_profiles};

#[tauri::command]
/// 读取主机配置列表。
pub fn profile_list(app: AppHandle) -> Result<Vec<HostProfile>, EngineError> {
    let store = read_profiles(&app)?;
    Ok(store.profiles)
}

#[tauri::command]
/// 新增或更新主机配置。
pub fn profile_save(app: AppHandle, mut profile: HostProfile) -> Result<HostProfile, EngineError> {
    let mut store = read_profiles(&app)?;
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }
    if profile.port == 0 {
        profile.port = 22;
    }
    let existing = store.profiles.iter_mut().find(|item| item.id == profile.id);
    if let Some(item) = existing {
        *item = profile.clone();
    } else {
        store.profiles.push(profile.clone());
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

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
