//! SSH 认证逻辑。
use std::path::Path;
use std::sync::Arc;

use russh::client;
use russh::keys::{self, PrivateKeyWithHashAlg};

use crate::error::EngineError;
use crate::session::ClientHandler;
use crate::types::{AuthType, HostProfile};

/// 执行 SSH 认证流程。
pub async fn authenticate(
    session: &mut client::Handle<ClientHandler>,
    profile: &HostProfile,
) -> Result<(), EngineError> {
    let authenticated = match profile.auth_type {
        AuthType::Password => {
            let password = profile
                .password_ref
                .clone()
                .ok_or_else(|| EngineError::new("ssh_auth_failed", "缺少密码"))?;
            session
                .authenticate_password(profile.username.clone(), password)
                .await
                .map_err(|err| {
                    EngineError::with_detail("ssh_auth_failed", "密码认证失败", err.to_string())
                })?
        }
        AuthType::Key => {
            let key_path = profile
                .key_path
                .clone()
                .ok_or_else(|| EngineError::new("ssh_auth_failed", "缺少密钥路径"))?;
            let key = load_key(&key_path, profile.key_passphrase_ref.as_deref())?;
            let key = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            session
                .authenticate_publickey(profile.username.clone(), key)
                .await
                .map_err(|err| {
                    EngineError::with_detail("ssh_auth_failed", "密钥认证失败", err.to_string())
                })?
        }
        AuthType::Agent => {
            return Err(EngineError::new("ssh_auth_failed", "Agent 认证暂未实现"));
        }
    };

    if !authenticated.success() {
        return Err(EngineError::new("ssh_auth_failed", "认证未成功"));
    }

    Ok(())
}

/// 从本地读取密钥文件。
fn load_key(path: &str, passphrase: Option<&str>) -> Result<keys::PrivateKey, EngineError> {
    keys::load_secret_key(Path::new(path), passphrase)
        .map_err(|err| EngineError::with_detail("ssh_auth_failed", "无法读取密钥", err.to_string()))
}
