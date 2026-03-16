//! 主机配置相关命令。
use engine::{EngineError, HostProfile};
use tauri::AppHandle;
use tauri::State;
use uuid::Uuid;

use crate::profile_secrets::{decrypt_profile_secrets, encrypt_profile_secrets};
use crate::profile_store::{read_profiles, write_profiles};
use crate::security::{CryptoService, SecretStore};
use crate::state::SecurityState;

const GROUP_NAME_MAX_LENGTH: usize = 12;
/// 会话名称上限与前端 ProfileModal 保持一致，避免前后端校验结果不同。
const PROFILE_NAME_MAX_LENGTH: usize = 14;

#[tauri::command]
/// 读取主机配置列表。
pub fn profile_list(
    app: AppHandle,
    security: State<'_, SecurityState>,
) -> Result<Vec<HostProfile>, EngineError> {
    let store = read_profiles(&app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(store.secret.as_ref(), session.as_ref())?;
    let secret_store = SecretStore::new(&crypto);
    store
        .profiles
        .into_iter()
        .map(
            |profile| match decrypt_profile_secrets(profile.clone(), &secret_store) {
                Ok(decrypted) => Ok(decrypted),
                Err(err)
                    if err.code == "security_locked"
                        && crypto.provider_kind()
                            == crate::security::EncryptionProviderKind::UserPassword =>
                {
                    Ok(redact_profile_secrets(profile))
                }
                Err(err) => Err(err),
            },
        )
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
    let next = validate_and_dedupe_groups(groups)?;
    store.ssh_groups = next.clone();
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    Ok(next)
}

#[tauri::command]
/// 新增或更新主机配置。
pub fn profile_save(
    app: AppHandle,
    security: State<'_, SecurityState>,
    mut profile: HostProfile,
) -> Result<HostProfile, EngineError> {
    let mut store = read_profiles(&app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(store.secret.as_ref(), session.as_ref())?;
    let secret_store = SecretStore::new(&crypto);
    profile.name = validate_profile_name(profile.name)?;
    profile.tags = normalize_profile_tags(profile.tags)?;
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }
    if profile.port == 0 {
        profile.port = 22;
    }
    let encrypted_profile = encrypt_profile_secrets(profile.clone(), &secret_store)?;
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

#[tauri::command]
/// 从默认 OpenSSH config 导入主机配置。
pub fn ssh_import_openssh_config(
    app: AppHandle,
) -> Result<crate::ssh_config_import::OpensshImportSummary, EngineError> {
    crate::ssh_config_import::import_openssh_config(&app)
}

pub(crate) fn dedupe_groups(values: Vec<String>) -> Vec<String> {
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

/// 校验并规范化会话名称：不能为空，且长度不能超过上限。
pub(crate) fn validate_profile_name(value: String) -> Result<String, EngineError> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(EngineError::new(
            "profile_name_required",
            "会话名称不能为空",
        ));
    }
    if normalized.chars().count() > PROFILE_NAME_MAX_LENGTH {
        return Err(EngineError::new(
            "profile_name_too_long",
            "会话名称不能超过 14 个字符",
        ));
    }
    Ok(normalized.to_string())
}

/// 校验并规范化分组名称列表：忽略空值，拒绝超长名称，再做去重排序。
pub(crate) fn validate_and_dedupe_groups(values: Vec<String>) -> Result<Vec<String>, EngineError> {
    let mut normalized = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() > GROUP_NAME_MAX_LENGTH {
            return Err(EngineError::new(
                "group_name_too_long",
                "分组名称不能超过 12 个字符",
            ));
        }
        normalized.push(trimmed.to_string());
    }
    Ok(dedupe_groups(normalized))
}

/// 规范化主机配置中的分组字段：空值移除，非空值要求长度合法。
pub(crate) fn normalize_profile_tags(
    tags: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, EngineError> {
    let Some(values) = tags else {
        return Ok(None);
    };
    let first = values.into_iter().next().unwrap_or_default();
    let normalized = first.trim();
    if normalized.is_empty() {
        return Ok(None);
    }
    if normalized.chars().count() > GROUP_NAME_MAX_LENGTH {
        return Err(EngineError::new(
            "group_name_too_long",
            "分组名称不能超过 12 个字符",
        ));
    }
    Ok(Some(vec![normalized.to_string()]))
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn redact_profile_secrets(mut profile: HostProfile) -> HostProfile {
    profile.password_ref = None;
    profile.private_key_passphrase_ref = None;
    profile
}
