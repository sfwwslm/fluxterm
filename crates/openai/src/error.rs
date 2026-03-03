//! OpenAI 请求错误定义。

use std::fmt::{Display, Formatter};

/// OpenAI crate 的统一错误类型。
#[derive(Debug)]
pub enum OpenAiError {
    Config(String),
    Request(String),
    RateLimited(String),
    Timeout(String),
    Http(u16, String),
    ResponseInvalid(String),
}

impl Display for OpenAiError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(message)
            | Self::Request(message)
            | Self::RateLimited(message)
            | Self::Timeout(message)
            | Self::ResponseInvalid(message) => f.write_str(message),
            Self::Http(status, message) => write!(f, "HTTP {status}: {message}"),
        }
    }
}

impl std::error::Error for OpenAiError {}
