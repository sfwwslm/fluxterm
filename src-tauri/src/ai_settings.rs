//! 终端 AI 助手配置读取。

use std::fs;

use engine::EngineError;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config_paths::resolve_ai_settings_path;

const DEFAULT_SELECTION_MAX_CHARS: usize = 1_500;

/// 终端 AI 助手设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub version: u32,
    #[serde(default = "default_selection_max_chars")]
    pub selection_max_chars: usize,
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

    Ok(settings)
}

fn default_selection_max_chars() -> usize {
    DEFAULT_SELECTION_MAX_CHARS
}

fn default_ai_settings() -> AiSettings {
    AiSettings {
        version: 1,
        selection_max_chars: default_selection_max_chars(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ai_settings_use_selection_limit() {
        let settings = default_ai_settings();
        assert_eq!(settings.version, 1);
        assert_eq!(settings.selection_max_chars, 1_500);
    }
}
