//! 系统安全存储 Provider 占位实现。
//!
//! 本轮只保留抽象与切换点，不接入真实系统钥匙串。

use engine::EngineError;

use crate::security::provider::EncryptionProvider;
use crate::security::types::{EncryptionProviderKind, ProviderCiphertext, SecurityStatus};

/// 未来用于接入系统安全存储的占位 Provider。
pub struct SystemKeychainProvider;

impl EncryptionProvider for SystemKeychainProvider {
    fn kind(&self) -> EncryptionProviderKind {
        EncryptionProviderKind::SystemKeychain
    }

    fn key_id(&self) -> &str {
        "system-keychain"
    }

    fn is_locked(&self) -> bool {
        true
    }

    fn encrypt(&self, _plaintext: &[u8]) -> Result<ProviderCiphertext, EngineError> {
        Err(EngineError::new(
            "crypto_provider_unavailable",
            "系统安全存储 Provider 尚未启用",
        ))
    }

    fn decrypt(&self, _payload: &ProviderCiphertext) -> Result<Vec<u8>, EngineError> {
        Err(EngineError::new(
            "crypto_provider_unavailable",
            "系统安全存储 Provider 尚未启用",
        ))
    }

    fn status(&self) -> SecurityStatus {
        SecurityStatus {
            provider: self.kind(),
            key_id: self.key_id().to_string(),
            locked: true,
            can_rotate: false,
        }
    }
}
