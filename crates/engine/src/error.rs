//! 引擎错误类型定义。
use serde::{Deserialize, Serialize};
use std::fmt;

/// 引擎错误类型，统一携带错误码、消息与可选细节。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineError {
    pub code: String,
    pub message: String,
    #[serde(rename = "details", alias = "detail")]
    pub detail: Option<String>,
}

impl EngineError {
    /// 创建仅包含错误码与消息的错误。
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: None,
        }
    }

    /// 创建包含详细信息的错误。
    pub fn with_detail(
        code: impl Into<String>,
        message: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: Some(detail.into()),
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{}: {} ({detail})", self.code, self.message),
            None => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

impl std::error::Error for EngineError {}
