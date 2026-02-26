//! 引擎对外数据类型定义。
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::EngineError;

/// 认证方式。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthType {
    Password,
    #[serde(alias = "key", alias = "public_key", alias = "publicKey")]
    PrivateKey,
    Agent,
}

/// 连接目标的主机配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(alias = "keyPath", alias = "publicKeyPath")]
    pub private_key_path: Option<String>,
    #[serde(alias = "keyPassphraseRef", alias = "publicKeyPassphraseRef")]
    pub private_key_passphrase_ref: Option<String>,
    pub password_ref: Option<String>,
    pub known_host: Option<String>,
    pub tags: Option<Vec<String>>,
}

/// 会话状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Connecting,
    Connected,
    Disconnected,
    Error,
}

/// 会话元数据。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub session_id: String,
    pub profile_id: String,
    pub state: SessionState,
    pub created_at: u64,
    pub last_error: Option<EngineError>,
}

/// SFTP 文件类型。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SftpEntryKind {
    File,
    Dir,
    Link,
}

/// SFTP 列表条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub path: String,
    pub name: String,
    pub kind: SftpEntryKind,
    pub size: Option<u64>,
    pub mtime: Option<u64>,
    pub permissions: Option<String>,
    pub owner: Option<String>,
    pub group: Option<String>,
}

/// 终端大小。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

/// SFTP 传输方向。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SftpProgressOp {
    Upload,
    Download,
}

/// SFTP 传输进度。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpProgress {
    pub session_id: String,
    pub op: SftpProgressOp,
    pub path: String,
    pub transferred: u64,
    pub total: Option<u64>,
}

/// 引擎事件回调载荷。
#[derive(Debug, Clone)]
pub enum EngineEvent {
    TerminalOutput {
        session_id: String,
        data: String,
    },
    TerminalExit {
        session_id: String,
    },
    SftpProgress(SftpProgress),
    SessionStatus {
        session_id: String,
        state: SessionState,
        error: Option<EngineError>,
    },
}

/// 引擎事件回调函数类型。
pub type EventCallback = Arc<dyn Fn(EngineEvent) + Send + Sync>;
