//! 安全模块公共类型。

use serde::{Deserialize, Serialize};

/// 加密 Provider 类型。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EncryptionProviderKind {
    HardcodedKey,
    SystemKeychain,
    UserPassword,
    RemoteKey,
}

/// 加密算法标识。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EncryptionAlgorithm {
    Aes256Gcm,
}

/// Provider 返回的原始密文材料。
#[derive(Debug, Clone)]
pub struct ProviderCiphertext {
    pub algorithm: EncryptionAlgorithm,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// 结构化密文封装。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedPayload {
    pub version: u32,
    pub provider: EncryptionProviderKind,
    pub algorithm: EncryptionAlgorithm,
    pub key_id: String,
    pub nonce: String,
    pub ciphertext: String,
}

/// 当前安全服务状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    pub provider: EncryptionProviderKind,
    pub key_id: String,
    pub locked: bool,
    pub can_rotate: bool,
}
