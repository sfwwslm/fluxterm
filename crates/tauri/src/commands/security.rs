//! 内置密钥的本地加密能力（开发阶段便捷模式）。
use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use engine::EngineError;
use rand::random;

const ENC_PREFIX: &str = "enc:v1:";
// 开发阶段便捷模式：内置固定密钥（32 字节）。
const BUILTIN_KEY: [u8; 32] = [
    0x46, 0x6c, 0x75, 0x78, 0x54, 0x65, 0x72, 0x6d, 0x2d, 0x44, 0x65, 0x76, 0x2d, 0x4b, 0x65, 0x79,
    0x2d, 0x32, 0x30, 0x32, 0x36, 0x2d, 0x30, 0x32, 0x2d, 0x32, 0x36, 0x2d, 0x58, 0x58, 0x58, 0x58,
];

/// 读取当前会话密钥（固定内置密钥）。
pub fn require_secret_key() -> Result<[u8; 32], EngineError> {
    Ok(BUILTIN_KEY)
}

/// 加密明文并输出 `enc:v1:` 前缀字符串。
pub fn encrypt_secret(key: &[u8; 32], plaintext: &str) -> Result<String, EngineError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|err| {
        EngineError::with_detail("secret_encrypt_failed", "无法初始化加密器", err.to_string())
    })?;
    let nonce = random_bytes_12();
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|_| EngineError::new("secret_encrypt_failed", "凭据加密失败"))?;
    let mut merged = nonce.to_vec();
    merged.extend(encrypted);
    Ok(format!("{ENC_PREFIX}{}", BASE64.encode(merged)))
}

/// 解密 `enc:v1:` 字符串。
pub fn decrypt_secret(key: &[u8; 32], value: &str) -> Result<String, EngineError> {
    let raw = value
        .strip_prefix(ENC_PREFIX)
        .ok_or_else(|| EngineError::new("secret_format_invalid", "凭据格式无效"))?;
    let bytes = BASE64.decode(raw).map_err(|err| {
        EngineError::with_detail("secret_format_invalid", "凭据格式无效", err.to_string())
    })?;
    if bytes.len() < 13 {
        return Err(EngineError::new("secret_format_invalid", "凭据格式无效"));
    }
    let (nonce, cipher) = bytes.split_at(12);
    let aes = Aes256Gcm::new_from_slice(key).map_err(|err| {
        EngineError::with_detail("secret_decrypt_failed", "无法初始化解密器", err.to_string())
    })?;
    let plain = aes
        .decrypt(Nonce::from_slice(nonce), cipher)
        .map_err(|_| EngineError::new("secret_decrypt_failed", "凭据解密失败"))?;
    String::from_utf8(plain).map_err(|err| {
        EngineError::with_detail("secret_decrypt_failed", "凭据解密结果无效", err.to_string())
    })
}

fn random_bytes_12() -> [u8; 12] {
    random()
}
