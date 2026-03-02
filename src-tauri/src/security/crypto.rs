//! 统一 Crypto 门面。

use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use engine::EngineError;

use crate::profile_store::SecretConfig;
use crate::security::provider::EncryptionProvider;
use crate::security::providers::{HardcodedKeyProvider, SystemKeychainProvider};
use crate::security::types::{
    EncryptedPayload, EncryptionAlgorithm, EncryptionProviderKind, ProviderCiphertext,
    SecurityStatus,
};

/// 统一的加密服务入口。
pub struct CryptoService {
    provider: Arc<dyn EncryptionProvider>,
}

impl CryptoService {
    /// 根据当前 secret 配置选择 Provider。
    pub fn new(config: Option<&SecretConfig>) -> Result<Self, EngineError> {
        let provider_name = config
            .map(|item| item.provider.trim().to_ascii_lowercase())
            .unwrap_or_else(|| "hardcoded_key".to_string());
        let provider: Arc<dyn EncryptionProvider> = match provider_name.as_str() {
            "hardcoded_key" | "" => Arc::new(HardcodedKeyProvider),
            "system_keychain" => Arc::new(SystemKeychainProvider),
            "user_password" => {
                return Err(EngineError::new(
                    "crypto_provider_unavailable",
                    "用户主密码 Provider 尚未实现",
                ));
            }
            "remote_key" => {
                return Err(EngineError::new(
                    "crypto_provider_unavailable",
                    "远端密钥 Provider 尚未实现",
                ));
            }
            _ => {
                return Err(EngineError::new(
                    "crypto_provider_invalid",
                    "未知的加密 Provider 配置",
                ));
            }
        };
        Ok(Self { provider })
    }

    /// 对明文字符串执行加密并返回结构化密文字符串。
    pub fn encrypt_string(&self, plaintext: &str) -> Result<String, EngineError> {
        let payload = self.provider.encrypt(plaintext.as_bytes())?;
        let serialized = EncryptedPayload {
            version: 1,
            provider: self.provider.kind(),
            algorithm: payload.algorithm,
            key_id: self.provider.key_id().to_string(),
            nonce: BASE64.encode(payload.nonce),
            ciphertext: BASE64.encode(payload.ciphertext),
        };
        serde_json::to_string(&serialized).map_err(|err| {
            EngineError::with_detail(
                "secret_serialize_failed",
                "无法序列化密文载荷",
                err.to_string(),
            )
        })
    }

    /// 对结构化密文字符串执行解密。
    pub fn decrypt_string(&self, serialized: &str) -> Result<String, EngineError> {
        let payload: EncryptedPayload = serde_json::from_str(serialized).map_err(|err| {
            EngineError::with_detail("secret_format_invalid", "凭据格式无效", err.to_string())
        })?;
        if payload.version != 1 {
            return Err(EngineError::new(
                "secret_version_unsupported",
                "不支持的凭据版本",
            ));
        }
        if payload.algorithm != EncryptionAlgorithm::Aes256Gcm {
            return Err(EngineError::new(
                "secret_algorithm_unsupported",
                "不支持的加密算法",
            ));
        }
        let nonce = BASE64.decode(payload.nonce).map_err(|err| {
            EngineError::with_detail("secret_format_invalid", "凭据格式无效", err.to_string())
        })?;
        let ciphertext = BASE64.decode(payload.ciphertext).map_err(|err| {
            EngineError::with_detail("secret_format_invalid", "凭据格式无效", err.to_string())
        })?;
        let plaintext = self.provider.decrypt(&ProviderCiphertext {
            algorithm: payload.algorithm,
            nonce,
            ciphertext,
        })?;
        String::from_utf8(plaintext).map_err(|err| {
            EngineError::with_detail("secret_decrypt_failed", "凭据解密结果无效", err.to_string())
        })
    }

    /// 返回当前安全服务状态。
    pub fn status(&self) -> SecurityStatus {
        self.provider.status()
    }

    /// 返回当前 Provider 类型。
    pub fn provider_kind(&self) -> EncryptionProviderKind {
        self.provider.kind()
    }

    /// 返回当前 key 标识。
    pub fn key_id(&self) -> &str {
        self.provider.key_id()
    }

    /// 将 Provider 枚举转换为稳定的配置字符串。
    pub fn provider_name(kind: &EncryptionProviderKind) -> &'static str {
        match kind {
            EncryptionProviderKind::HardcodedKey => "hardcoded_key",
            EncryptionProviderKind::SystemKeychain => "system_keychain",
            EncryptionProviderKind::UserPassword => "user_password",
            EncryptionProviderKind::RemoteKey => "remote_key",
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::profile_store::SecretConfig;

    use super::CryptoService;

    #[test]
    fn crypto_service_encrypts_and_decrypts_roundtrip() {
        let config = SecretConfig {
            version: 1,
            provider: "hardcoded_key".to_string(),
            active_key_id: Some("builtin-v1".to_string()),
            kdf_salt: None,
            verify_hash: None,
        };
        let crypto = CryptoService::new(Some(&config)).expect("crypto service");
        let encrypted = crypto.encrypt_string("secret-value").expect("encrypt");
        assert_ne!(encrypted, "secret-value");
        let decrypted = crypto.decrypt_string(&encrypted).expect("decrypt");
        assert_eq!(decrypted, "secret-value");
    }

    #[test]
    fn crypto_service_rejects_invalid_payload() {
        let crypto = CryptoService::new(None).expect("crypto service");
        let result = crypto.decrypt_string("enc:v1:legacy");
        assert!(result.is_err());
    }
}
