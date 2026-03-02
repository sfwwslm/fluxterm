//! 硬编码密钥 Provider。
//!
//! Alpha 阶段允许继续使用弱保护模型，但业务层不再直接依赖固定 key 或 AES 实现。

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use engine::EngineError;
use rand::random;

use crate::security::provider::EncryptionProvider;
use crate::security::types::{EncryptionAlgorithm, EncryptionProviderKind, ProviderCiphertext};

const BUILTIN_KEY_ID: &str = "builtin-v1";
const BUILTIN_KEY: [u8; 32] = [
    0x46, 0x6c, 0x75, 0x78, 0x54, 0x65, 0x72, 0x6d, 0x2d, 0x44, 0x65, 0x76, 0x2d, 0x4b, 0x65, 0x79,
    0x2d, 0x32, 0x30, 0x32, 0x36, 0x2d, 0x30, 0x32, 0x2d, 0x32, 0x36, 0x2d, 0x58, 0x58, 0x58, 0x58,
];

/// 基于固定 32 字节密钥的 AES-256-GCM Provider。
pub struct HardcodedKeyProvider;

impl HardcodedKeyProvider {
    fn cipher(&self) -> Result<Aes256Gcm, EngineError> {
        Aes256Gcm::new_from_slice(&BUILTIN_KEY).map_err(|err| {
            EngineError::with_detail("crypto_init_failed", "无法初始化加密器", err.to_string())
        })
    }
}

impl EncryptionProvider for HardcodedKeyProvider {
    fn kind(&self) -> EncryptionProviderKind {
        EncryptionProviderKind::HardcodedKey
    }

    fn key_id(&self) -> &str {
        BUILTIN_KEY_ID
    }

    fn is_locked(&self) -> bool {
        false
    }

    fn encrypt(&self, plaintext: &[u8]) -> Result<ProviderCiphertext, EngineError> {
        let cipher = self.cipher()?;
        let nonce: [u8; 12] = random();
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext)
            .map_err(|_| EngineError::new("secret_encrypt_failed", "凭据加密失败"))?;
        Ok(ProviderCiphertext {
            algorithm: EncryptionAlgorithm::Aes256Gcm,
            nonce: nonce.to_vec(),
            ciphertext,
        })
    }

    fn decrypt(&self, payload: &ProviderCiphertext) -> Result<Vec<u8>, EngineError> {
        let cipher = self.cipher()?;
        cipher
            .decrypt(
                Nonce::from_slice(&payload.nonce),
                payload.ciphertext.as_ref(),
            )
            .map_err(|_| EngineError::new("secret_decrypt_failed", "凭据解密失败"))
    }
}
