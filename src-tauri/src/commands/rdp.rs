//! RDP profile 与会话命令。
use engine::EngineError;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::profile_secrets::{decrypt_rdp_profile_secrets, encrypt_rdp_profile_secrets};
use crate::profile_store::{read_profiles, write_profiles};
use crate::rdp::{RdpInputEvent, RdpProfile, RdpSessionSnapshot, RdpState};
use crate::security::{CryptoService, SecretStore};
use crate::state::SecurityState;

use super::profile::{
    dedupe_groups, normalize_profile_tags, validate_and_dedupe_groups, validate_profile_name,
};

#[tauri::command]
/// 读取 RDP 分组列表。
pub fn rdp_profile_groups_list(app: AppHandle) -> Result<Vec<String>, EngineError> {
    let store = read_profiles(&app)?;
    Ok(dedupe_groups(store.rdp_groups))
}

#[tauri::command]
/// 写入 RDP 分组列表。
pub fn rdp_profile_groups_save(
    app: AppHandle,
    groups: Vec<String>,
) -> Result<Vec<String>, EngineError> {
    let mut store = read_profiles(&app)?;
    let next = validate_and_dedupe_groups(groups)?;
    store.rdp_groups = next.clone();
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    Ok(next)
}

#[tauri::command]
/// 读取 RDP Profile 列表。
pub fn rdp_profile_list(
    app: AppHandle,
    security: State<'_, SecurityState>,
) -> Result<Vec<RdpProfile>, EngineError> {
    let store = read_profiles(&app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(store.secret.as_ref(), session.as_ref())?;
    let secret_store = SecretStore::new(&crypto);
    store
        .rdp_profiles
        .into_iter()
        .map(
            |profile| match decrypt_rdp_profile_secrets(profile.clone(), &secret_store) {
                Ok(decrypted) => Ok(decrypted),
                Err(err)
                    if err.code == "security_locked"
                        && crypto.provider_kind()
                            == crate::security::EncryptionProviderKind::UserPassword =>
                {
                    let mut profile = profile;
                    profile.password_ref = None;
                    Ok(profile)
                }
                Err(err) => Err(err),
            },
        )
        .collect()
}

#[tauri::command]
/// 保存 RDP Profile。
pub fn rdp_profile_save(
    app: AppHandle,
    security: State<'_, SecurityState>,
    mut profile: RdpProfile,
) -> Result<RdpProfile, EngineError> {
    let mut store = read_profiles(&app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(store.secret.as_ref(), session.as_ref())?;
    let secret_store = SecretStore::new(&crypto);

    profile.name = validate_profile_name(profile.name)?;
    profile.host = profile.host.trim().to_string();
    profile.username = profile.username.trim().to_string();
    profile.tags = normalize_profile_tags(profile.tags)?;
    if profile.host.is_empty() || profile.username.is_empty() {
        return Err(EngineError::new(
            "rdp_profile_required",
            "RDP 主机地址和用户名不能为空",
        ));
    }
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }
    if profile.port == 0 {
        profile.port = 3389;
    }
    if profile.width == 0 {
        profile.width = 1280;
    }
    if profile.height == 0 {
        profile.height = 720;
    }
    let encrypted = encrypt_rdp_profile_secrets(profile.clone(), &secret_store)?;
    let existing = store
        .rdp_profiles
        .iter_mut()
        .find(|item| item.id == profile.id);
    if let Some(item) = existing {
        *item = encrypted;
    } else {
        store.rdp_profiles.push(encrypted);
    }
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    Ok(profile)
}

#[tauri::command]
/// 删除 RDP Profile。
pub fn rdp_profile_delete(app: AppHandle, profile_id: String) -> Result<bool, EngineError> {
    let mut store = read_profiles(&app)?;
    let before = store.rdp_profiles.len();
    store.rdp_profiles.retain(|item| item.id != profile_id);
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    Ok(before != store.rdp_profiles.len())
}

#[tauri::command]
/// 创建 RDP 会话。
pub async fn rdp_session_create(
    app: AppHandle,
    security: State<'_, SecurityState>,
    rdp: State<'_, RdpState>,
    profile_id: String,
) -> Result<RdpSessionSnapshot, EngineError> {
    let profile = load_profile(&app, &security, &profile_id)?;
    rdp.create_session(&profile).await
}

#[tauri::command]
/// 启动 RDP 会话桥接。
pub async fn rdp_session_connect(
    rdp: State<'_, RdpState>,
    session_id: String,
) -> Result<RdpSessionSnapshot, EngineError> {
    rdp.connect_session(&session_id).await
}

#[tauri::command]
/// 断开 RDP 会话。
pub async fn rdp_session_disconnect(
    rdp: State<'_, RdpState>,
    session_id: String,
) -> Result<RdpSessionSnapshot, EngineError> {
    rdp.disconnect_session(&session_id).await
}

#[tauri::command]
/// 发送 RDP 输入。
pub async fn rdp_session_send_input(
    rdp: State<'_, RdpState>,
    session_id: String,
    input: RdpInputEvent,
) -> Result<(), EngineError> {
    rdp.send_input(&session_id, input).await
}

#[tauri::command]
/// 调整 RDP 远端分辨率。
pub async fn rdp_session_resize(
    rdp: State<'_, RdpState>,
    session_id: String,
    width: u32,
    height: u32,
) -> Result<RdpSessionSnapshot, EngineError> {
    rdp.resize_session(&session_id, width, height).await
}

#[tauri::command]
/// 设置 RDP 剪贴板内容。
pub async fn rdp_session_set_clipboard(
    rdp: State<'_, RdpState>,
    session_id: String,
    text: String,
) -> Result<(), EngineError> {
    rdp.set_clipboard(&session_id, text).await
}

#[tauri::command]
/// 响应 RDP 证书确认。
pub async fn rdp_session_cert_decide(
    rdp: State<'_, RdpState>,
    session_id: String,
    accept: bool,
) -> Result<RdpSessionSnapshot, EngineError> {
    rdp.decide_certificate(&session_id, accept).await
}

fn load_profile(
    app: &AppHandle,
    security: &State<'_, SecurityState>,
    profile_id: &str,
) -> Result<RdpProfile, EngineError> {
    let store = read_profiles(app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(store.secret.as_ref(), session.as_ref())?;
    let secret_store = SecretStore::new(&crypto);
    let profile = store
        .rdp_profiles
        .into_iter()
        .find(|item| item.id == profile_id)
        .ok_or_else(|| EngineError::new("rdp_profile_not_found", "RDP Profile 不存在"))?;
    decrypt_rdp_profile_secrets(profile, &secret_store)
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
