//! 终端 AI 助手配置读取。

use std::fs;

use engine::EngineError;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config_paths::resolve_ai_settings_path;

const DEFAULT_SELECTION_MAX_CHARS: usize = 1_500;
const DEFAULT_SESSION_RECENT_OUTPUT_MAX_CHARS: usize = 1_200;
const DEFAULT_SESSION_RECENT_OUTPUT_MAX_SNIPPETS: usize = 4;
const DEFAULT_SELECTION_RECENT_OUTPUT_MAX_CHARS: usize = 600;
const DEFAULT_SELECTION_RECENT_OUTPUT_MAX_SNIPPETS: usize = 2;
const DEFAULT_REQUEST_CACHE_TTL_MS: u64 = 15_000;

/// 终端 AI 助手设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub version: u32,
    #[serde(default = "default_selection_max_chars")]
    pub selection_max_chars: usize,
    #[serde(default = "default_session_recent_output_max_chars")]
    pub session_recent_output_max_chars: usize,
    #[serde(default = "default_session_recent_output_max_snippets")]
    pub session_recent_output_max_snippets: usize,
    #[serde(default = "default_selection_recent_output_max_chars")]
    pub selection_recent_output_max_chars: usize,
    #[serde(default = "default_selection_recent_output_max_snippets")]
    pub selection_recent_output_max_snippets: usize,
    #[serde(default = "default_request_cache_ttl_ms")]
    pub request_cache_ttl_ms: u64,
}

/// 读取终端 AI 助手设置。
pub fn read_ai_settings(app: &AppHandle) -> Result<AiSettings, EngineError> {
    let path = resolve_ai_settings_path(app)?;
    if !path.exists() {
        return Ok(default_ai_settings());
    }
    let content = fs::read_to_string(&path).map_err(|err| {
        EngineError::with_detail(
            "ai_settings_read_failed",
            "无法读取终端 AI 配置文件",
            err.to_string(),
        )
    })?;
    let settings: AiSettings = serde_json::from_str(&content).map_err(|err| {
        EngineError::with_detail(
            "ai_settings_parse_failed",
            "终端 AI 配置文件解析失败",
            err.to_string(),
        )
    })?;

    if settings.selection_max_chars == 0 {
        return Err(EngineError::new(
            "ai_settings_invalid",
            "终端 AI 配置文件中的 selectionMaxChars 必须大于 0",
        ));
    }
    if settings.session_recent_output_max_chars == 0
        || settings.session_recent_output_max_snippets == 0
        || settings.selection_recent_output_max_chars == 0
        || settings.selection_recent_output_max_snippets == 0
        || settings.request_cache_ttl_ms == 0
    {
        return Err(EngineError::new(
            "ai_settings_invalid",
            "终端 AI 配置文件中的上下文预算与缓存 TTL 必须大于 0",
        ));
    }

    Ok(settings)
}

fn default_selection_max_chars() -> usize {
    DEFAULT_SELECTION_MAX_CHARS
}

fn default_session_recent_output_max_chars() -> usize {
    DEFAULT_SESSION_RECENT_OUTPUT_MAX_CHARS
}

fn default_session_recent_output_max_snippets() -> usize {
    DEFAULT_SESSION_RECENT_OUTPUT_MAX_SNIPPETS
}

fn default_selection_recent_output_max_chars() -> usize {
    DEFAULT_SELECTION_RECENT_OUTPUT_MAX_CHARS
}

fn default_selection_recent_output_max_snippets() -> usize {
    DEFAULT_SELECTION_RECENT_OUTPUT_MAX_SNIPPETS
}

fn default_request_cache_ttl_ms() -> u64 {
    DEFAULT_REQUEST_CACHE_TTL_MS
}

fn default_ai_settings() -> AiSettings {
    AiSettings {
        version: 1,
        selection_max_chars: default_selection_max_chars(),
        session_recent_output_max_chars: default_session_recent_output_max_chars(),
        session_recent_output_max_snippets: default_session_recent_output_max_snippets(),
        selection_recent_output_max_chars: default_selection_recent_output_max_chars(),
        selection_recent_output_max_snippets: default_selection_recent_output_max_snippets(),
        request_cache_ttl_ms: default_request_cache_ttl_ms(),
    }
}

#[cfg(test)]
pub fn default_ai_settings_for_test() -> AiSettings {
    default_ai_settings()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ai_settings_use_selection_limit() {
        let settings = default_ai_settings();
        assert_eq!(settings.version, 1);
        assert_eq!(settings.selection_max_chars, 1_500);
        assert_eq!(settings.session_recent_output_max_chars, 1_200);
        assert_eq!(settings.session_recent_output_max_snippets, 4);
        assert_eq!(settings.selection_recent_output_max_chars, 600);
        assert_eq!(settings.selection_recent_output_max_snippets, 2);
        assert_eq!(settings.request_cache_ttl_ms, 15_000);
    }
}
