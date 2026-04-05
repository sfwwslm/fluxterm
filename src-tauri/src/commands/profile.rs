//! 主机配置相关命令。
use engine::{EngineError, HostProfile};
use serde_json::json;
use tauri::AppHandle;
use tauri::State;
use uuid::Uuid;

use crate::profile_secrets::{decrypt_profile_secrets, encrypt_profile_secrets};
use crate::security::{CryptoService, SecretStore};
use crate::security_store::read_security_config;
use crate::ssh_profile_store::{
    read_ssh_groups, read_ssh_profiles, write_ssh_groups, write_ssh_profiles,
};
use crate::state::SecurityState;
use crate::telemetry::{TelemetryLevel, log_telemetry};

const GROUP_NAME_MAX_LENGTH: usize = 12;
/// 会话名称上限与前端 ProfileModal 保持一致，避免前后端校验结果不同。
const PROFILE_NAME_MAX_LENGTH: usize = 14;

#[tauri::command]
/// 读取主机配置列表。
pub fn profile_list(
    app: AppHandle,
    security: State<'_, SecurityState>,
) -> Result<Vec<HostProfile>, EngineError> {
    let store = read_ssh_profiles(&app)?;
    let security_config = read_security_config(&app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(security_config.as_ref(), session.as_ref())?;
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
    Ok(dedupe_groups(read_ssh_groups(&app)?))
}

#[tauri::command]
/// 写入 SSH 分组列表。
pub fn profile_groups_save(
    app: AppHandle,
    groups: Vec<String>,
) -> Result<Vec<String>, EngineError> {
    let next = validate_and_dedupe_groups(groups)?;
    write_ssh_groups(&app, &next)?;
    Ok(next)
}

#[tauri::command]
/// 新增或更新主机配置。
pub fn profile_save(
    app: AppHandle,
    security: State<'_, SecurityState>,
    mut profile: HostProfile,
) -> Result<HostProfile, EngineError> {
    let mut store = read_ssh_profiles(&app)?;
    let security_config = read_security_config(&app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(security_config.as_ref(), session.as_ref())?;
    let secret_store = SecretStore::new(&crypto);
    profile.name = validate_profile_name(profile.name)?;
    profile.tags = normalize_profile_tags(profile.tags)?;
    profile = normalize_ssh_advanced_fields(profile)?;
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
    write_ssh_profiles(&app, &store)?;
    Ok(profile)
}

#[tauri::command]
/// 删除指定主机配置。
pub fn profile_remove(app: AppHandle, profile_id: String) -> Result<bool, EngineError> {
    let mut store = read_ssh_profiles(&app)?;
    let before = store.profiles.len();
    store.profiles.retain(|item| item.id != profile_id);
    store.updated_at = now_epoch();
    write_ssh_profiles(&app, &store)?;
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

/// 规范化 SSH 高级字段，确保旧字段与新字段保持一致。
pub(crate) fn normalize_ssh_advanced_fields(
    mut profile: HostProfile,
) -> Result<HostProfile, EngineError> {
    profile.private_key_path = normalize_optional_string(profile.private_key_path);
    profile.private_key_passphrase_ref =
        normalize_optional_string(profile.private_key_passphrase_ref);
    profile.password_ref = normalize_optional_string(profile.password_ref);
    profile.known_host = normalize_optional_string(profile.known_host);
    profile.proxy_command = normalize_optional_string(profile.proxy_command);
    profile.proxy_jump = normalize_optional_string(profile.proxy_jump);
    profile.add_keys_to_agent = normalize_optional_string(profile.add_keys_to_agent);
    profile.user_known_hosts_file = normalize_optional_string(profile.user_known_hosts_file);
    profile.terminal_type = normalize_optional_string(profile.terminal_type);
    profile.target_system = normalize_optional_string(profile.target_system);
    profile.charset = normalize_optional_string(profile.charset);
    profile.word_separators = normalize_optional_string(profile.word_separators);
    profile.description = normalize_optional_string(profile.description);
    profile.identity_files = normalize_identity_files(profile.identity_files)?;

    if profile.identity_files.is_none() && profile.private_key_path.is_some() {
        profile.identity_files = Some(vec![profile.private_key_path.clone().unwrap_or_default()]);
    }

    if let Some(identity_files) = profile.identity_files.as_ref() {
        profile.private_key_path = identity_files.first().cloned();
    }

    if profile.proxy_jump.is_some() {
        if profile.proxy_command.is_some() {
            log_telemetry(
                TelemetryLevel::Info,
                "ssh.profile.proxy_command.ignored",
                None,
                json!({
                    "profileId": profile.id,
                    "reason": "proxy_jump_present",
                }),
            );
        }
        profile.proxy_command = None;
    }

    if matches!(profile.auth_type, engine::AuthType::PrivateKey)
        && profile.private_key_path.is_none()
        && profile.identity_files.is_none()
    {
        return Err(EngineError::new(
            "profile_identity_files_required",
            "私钥认证至少需要一个私钥文件",
        ));
    }

    Ok(profile)
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_identity_files(
    values: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, EngineError> {
    let Some(values) = values else {
        return Ok(None);
    };
    let mut seen = std::collections::HashSet::new();
    let mut normalized = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_lowercase();
        if seen.insert(key) {
            normalized.push(trimmed.to_string());
        }
    }
    if normalized.is_empty() {
        return Ok(None);
    }
    Ok(Some(normalized))
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

#[cfg(test)]
mod tests {
    use engine::{AuthType, HostProfile};

    use super::normalize_ssh_advanced_fields;

    fn sample_profile() -> HostProfile {
        HostProfile {
            id: String::new(),
            name: "demo".to_string(),
            host: "example.com".to_string(),
            port: 22,
            username: "root".to_string(),
            auth_type: AuthType::Password,
            private_key_path: None,
            identity_files: None,
            private_key_passphrase_ref: None,
            password_ref: None,
            known_host: None,
            proxy_command: None,
            proxy_jump: None,
            add_keys_to_agent: None,
            user_known_hosts_file: None,
            strict_host_key_checking: None,
            tags: None,
            terminal_type: None,
            target_system: None,
            charset: None,
            word_separators: None,
            bell_mode: None,
            bell_cooldown_ms: None,
            description: None,
        }
    }

    #[test]
    fn normalize_ssh_advanced_fields_syncs_private_key_and_identity_files() {
        let mut profile = sample_profile();
        profile.auth_type = AuthType::PrivateKey;
        profile.private_key_path = Some("  C:/keys/id_ed25519  ".to_string());

        let normalized = normalize_ssh_advanced_fields(profile).expect("normalized");

        assert_eq!(
            normalized.identity_files,
            Some(vec!["C:/keys/id_ed25519".to_string()])
        );
        assert_eq!(
            normalized.private_key_path.as_deref(),
            Some("C:/keys/id_ed25519")
        );
    }

    #[test]
    fn normalize_ssh_advanced_fields_prefers_first_identity_file() {
        let mut profile = sample_profile();
        profile.auth_type = AuthType::PrivateKey;
        profile.private_key_path = Some("C:/keys/legacy".to_string());
        profile.identity_files = Some(vec![
            " C:/keys/id_a ".to_string(),
            "C:/keys/id_b".to_string(),
            "C:/keys/id_a".to_string(),
        ]);

        let normalized = normalize_ssh_advanced_fields(profile).expect("normalized");

        assert_eq!(
            normalized.identity_files,
            Some(vec!["C:/keys/id_a".to_string(), "C:/keys/id_b".to_string()])
        );
        assert_eq!(normalized.private_key_path.as_deref(), Some("C:/keys/id_a"));
    }

    #[test]
    fn normalize_ssh_advanced_fields_clears_proxy_command_when_proxy_jump_exists() {
        let mut profile = sample_profile();
        profile.proxy_jump = Some("bastion".to_string());
        profile.proxy_command = Some("ssh -W %h:%p bastion".to_string());

        let normalized = normalize_ssh_advanced_fields(profile).expect("normalized");

        assert_eq!(normalized.proxy_jump.as_deref(), Some("bastion"));
        assert!(normalized.proxy_command.is_none());
    }

    #[test]
    fn normalize_ssh_advanced_fields_rejects_private_key_auth_without_keys() {
        let mut profile = sample_profile();
        profile.auth_type = AuthType::PrivateKey;

        let err = normalize_ssh_advanced_fields(profile).expect_err("missing keys");

        assert_eq!(err.code, "profile_identity_files_required");
    }
}
