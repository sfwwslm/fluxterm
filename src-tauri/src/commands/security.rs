//! 安全状态与主密码命令。

use engine::{EngineError, HostProfile};
use tauri::{AppHandle, State};

use crate::ai_settings::{AiSettings, read_ai_settings, write_ai_settings};
use crate::profile_secrets::{decrypt_profile_secrets, encrypt_profile_secrets};
use crate::profile_store::{ProfileStore, read_profiles, write_profiles};
use crate::security::{CryptoService, SecretStore, SecurityStatus};
use crate::state::SecurityState;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPasswordInput {
    pub password: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPasswordChangeInput {
    pub current_password: String,
    pub next_password: String,
}

/// 返回当前安全服务状态。
#[tauri::command]
pub fn security_status(
    app: AppHandle,
    security: State<'_, SecurityState>,
) -> Result<SecurityStatus, EngineError> {
    let store = read_profiles(&app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(store.secret.as_ref(), session.as_ref())?;
    Ok(crypto.status())
}

/// 使用当前安全密码解锁已加密的数据。
#[tauri::command]
pub fn security_unlock(
    app: AppHandle,
    security: State<'_, SecurityState>,
    input: SecurityPasswordInput,
) -> Result<SecurityStatus, EngineError> {
    let store = read_profiles(&app)?;
    let config = store
        .secret
        .as_ref()
        .ok_or_else(|| EngineError::new("security_mode_invalid", "当前未配置安全模式"))?;
    let provider = config.provider.trim().to_ascii_lowercase();
    if provider != "user_password" {
        return Err(EngineError::new(
            "security_unlock_unavailable",
            "当前未启用主密码加密，无需解锁。",
        ));
    }
    let session = CryptoService::unlock_user_password(config, &input.password)?;
    security.set_session(session);
    security_status(app, security)
}

/// 清除当前内存中的已解锁主密码。
#[tauri::command]
pub fn security_lock(
    app: AppHandle,
    security: State<'_, SecurityState>,
) -> Result<SecurityStatus, EngineError> {
    security.clear_session();
    security_status(app, security)
}

/// 从明文模式启用主密码加密，并将现有敏感字段统一迁移为密文。
#[tauri::command]
pub fn security_enable_with_password(
    app: AppHandle,
    security: State<'_, SecurityState>,
    input: SecurityPasswordInput,
) -> Result<SecurityStatus, EngineError> {
    let mut store = read_profiles(&app)?;
    let current_session = security.current_session();
    let current_crypto = CryptoService::new(store.secret.as_ref(), current_session.as_ref())?;
    if current_crypto.provider_kind() != crate::security::EncryptionProviderKind::Plaintext {
        return Err(EngineError::new(
            "security_enable_unavailable",
            "当前已启用加密，请使用修改密码功能。",
        ));
    }
    if current_session.is_none()
        && current_crypto.provider_kind() == crate::security::EncryptionProviderKind::UserPassword
    {
        return Err(EngineError::new(
            "security_locked",
            "当前安全数据已锁定，请先输入安全密码解锁。",
        ));
    }

    let profiles_plain = decrypt_profiles(&store, &current_crypto)?;
    let ai_plain = decrypt_ai_settings(&app, &current_crypto)?;
    let (next_config, next_session) = CryptoService::build_user_password_config(&input.password)?;
    let next_crypto = CryptoService::new(Some(&next_config), Some(&next_session))?;

    store.secret = Some(next_config.clone());
    store.profiles = encrypt_profiles(profiles_plain, &next_crypto)?;
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    write_ai_settings(&app, encrypt_ai_settings(ai_plain, &next_crypto)?)?;
    security.set_session(next_session);
    security_status(app, security)
}

/// 修改当前主密码，并对现有密文执行重加密。
#[tauri::command]
pub fn security_change_password(
    app: AppHandle,
    security: State<'_, SecurityState>,
    input: SecurityPasswordChangeInput,
) -> Result<SecurityStatus, EngineError> {
    let mut store = read_profiles(&app)?;
    let config = store
        .secret
        .as_ref()
        .ok_or_else(|| EngineError::new("security_mode_invalid", "当前未配置安全模式"))?;
    if !config.provider.trim().eq_ignore_ascii_case("user_password") {
        return Err(EngineError::new(
            "security_change_unavailable",
            "当前未启用主密码加密，无法修改安全密码。",
        ));
    }

    let current_session = CryptoService::unlock_user_password(config, &input.current_password)?;
    let current_crypto = CryptoService::new(store.secret.as_ref(), Some(&current_session))?;
    let profiles_plain = decrypt_profiles(&store, &current_crypto)?;
    let ai_plain = decrypt_ai_settings(&app, &current_crypto)?;
    let (next_config, next_session) =
        CryptoService::build_user_password_config(&input.next_password)?;
    let next_crypto = CryptoService::new(Some(&next_config), Some(&next_session))?;

    store.secret = Some(next_config.clone());
    store.profiles = encrypt_profiles(profiles_plain, &next_crypto)?;
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    write_ai_settings(&app, encrypt_ai_settings(ai_plain, &next_crypto)?)?;
    security.set_session(next_session);
    security_status(app, security)
}

/// 关闭加密，并将所有敏感字段恢复为明文保存。
#[tauri::command]
pub fn security_disable_encryption(
    app: AppHandle,
    security: State<'_, SecurityState>,
) -> Result<SecurityStatus, EngineError> {
    let mut store = read_profiles(&app)?;
    let current_session = security.current_session();
    let current_crypto = CryptoService::new(store.secret.as_ref(), current_session.as_ref())?;
    if current_crypto.provider_kind() == crate::security::EncryptionProviderKind::UserPassword
        && current_session.is_none()
    {
        return Err(EngineError::new(
            "security_locked",
            "当前安全数据已锁定，请先输入安全密码解锁。",
        ));
    }

    let profiles_plain = decrypt_profiles(&store, &current_crypto)?;
    let ai_plain = decrypt_ai_settings(&app, &current_crypto)?;
    let plaintext = CryptoService::plaintext();

    store.secret = Some(crate::profile_store::SecretConfig {
        version: 1,
        provider: "plaintext".to_string(),
        active_key_id: None,
        kdf_salt: None,
        verify_hash: None,
    });
    store.profiles = encrypt_profiles(profiles_plain, &plaintext)?;
    store.updated_at = now_epoch();
    write_profiles(&app, &store)?;
    write_ai_settings(&app, encrypt_ai_settings(ai_plain, &plaintext)?)?;
    security.clear_session();
    security_status(app, security)
}

fn decrypt_profiles(
    store: &ProfileStore,
    crypto: &CryptoService,
) -> Result<Vec<HostProfile>, EngineError> {
    let secret_store = SecretStore::new(crypto);
    store
        .profiles
        .clone()
        .into_iter()
        .map(|profile| decrypt_profile_secrets(profile, &secret_store))
        .collect()
}

fn encrypt_profiles(
    profiles: Vec<HostProfile>,
    crypto: &CryptoService,
) -> Result<Vec<HostProfile>, EngineError> {
    let secret_store = SecretStore::new(crypto);
    profiles
        .into_iter()
        .map(|profile| encrypt_profile_secrets(profile, &secret_store))
        .collect()
}

fn decrypt_ai_settings(app: &AppHandle, crypto: &CryptoService) -> Result<AiSettings, EngineError> {
    let mut settings = read_ai_settings(app)?;
    let secret_store = SecretStore::new(crypto);
    for provider in &mut settings.providers {
        provider.api_key_ref = secret_store.reveal_optional_string(provider.api_key_ref.take())?;
    }
    Ok(settings)
}

fn encrypt_ai_settings(
    mut settings: AiSettings,
    crypto: &CryptoService,
) -> Result<AiSettings, EngineError> {
    let secret_store = SecretStore::new(crypto);
    for provider in &mut settings.providers {
        provider.api_key_ref = secret_store.protect_optional_string(provider.api_key_ref.take())?;
    }
    Ok(settings)
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
