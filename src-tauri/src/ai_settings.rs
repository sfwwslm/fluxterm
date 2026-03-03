//! 终端 AI 助手配置读取与持久化。

use std::collections::{HashMap, HashSet};
use std::fs;

use engine::EngineError;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config_paths::resolve_ai_settings_path;
use crate::profile_store::{ProfileStore, read_profiles};
use crate::security::{CryptoService, SecretStore};

const DEFAULT_SELECTION_MAX_CHARS: usize = 1_500;
const DEFAULT_SESSION_RECENT_OUTPUT_MAX_CHARS: usize = 1_200;
const DEFAULT_SESSION_RECENT_OUTPUT_MAX_SNIPPETS: usize = 4;
const DEFAULT_SELECTION_RECENT_OUTPUT_MAX_CHARS: usize = 600;
const DEFAULT_SELECTION_RECENT_OUTPUT_MAX_SNIPPETS: usize = 2;
const DEFAULT_REQUEST_CACHE_TTL_MS: u64 = 15_000;
const DEFAULT_DEBUG_LOGGING_ENABLED: bool = true;
const CURRENT_AI_SETTINGS_VERSION: u32 = 1;

/// 终端 AI 助手落盘结构。
///
/// 当前文件同时保存两类信息：
/// - 终端 AI 助手本地能力配置
/// - 多个 OpenAI 标准接入配置与当前激活项
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
    #[serde(default = "default_debug_logging_enabled")]
    pub debug_logging_enabled: bool,
    #[serde(default)]
    pub active_openai_config_id: String,
    #[serde(default)]
    pub openai_configs: Vec<OpenAiConfigSettings>,
}

impl AiSettings {
    /// 返回当前激活的 OpenAI 标准接入配置。
    pub fn active_openai_config(&self) -> Option<&OpenAiConfigSettings> {
        self.openai_configs
            .iter()
            .find(|config| config.id == self.active_openai_config_id)
    }
}

/// 单个 OpenAI 标准接入配置。
///
/// `api_key_ref` 只保存加密后的 token，不回显明文 API Key。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiConfigSettings {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key_ref: Option<String>,
}

/// 返回给前端设置页的 AI 配置视图。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    pub version: u32,
    pub selection_max_chars: usize,
    pub session_recent_output_max_chars: usize,
    pub session_recent_output_max_snippets: usize,
    pub selection_recent_output_max_chars: usize,
    pub selection_recent_output_max_snippets: usize,
    pub request_cache_ttl_ms: u64,
    pub debug_logging_enabled: bool,
    pub active_openai_config_id: String,
    pub openai_configs: Vec<OpenAiConfigView>,
}

/// 前端可见的 OpenAI 接入配置视图。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiConfigView {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub api_key_configured: bool,
}

/// 前端保存 AI 配置时使用的输入结构。
///
/// 前端始终提交完整的 OpenAI 接入列表与当前激活项，
/// 后端据此生成新的落盘结构。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsSaveInput {
    pub selection_max_chars: usize,
    pub session_recent_output_max_chars: usize,
    pub session_recent_output_max_snippets: usize,
    pub selection_recent_output_max_chars: usize,
    pub selection_recent_output_max_snippets: usize,
    pub request_cache_ttl_ms: u64,
    pub debug_logging_enabled: bool,
    pub active_openai_config_id: String,
    pub openai_configs: Vec<OpenAiConfigInput>,
}

/// 前端保存单个 OpenAI 接入时使用的输入结构。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiConfigInput {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub api_key: SecretFieldUpdate,
}

/// 受保护字段的更新策略。
///
/// 密钥字段不直接回传明文，保存时通过 keep/replace/clear 明确表达意图。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum SecretFieldUpdate {
    Keep,
    Replace { value: String },
    Clear,
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
    let raw_value: serde_json::Value = serde_json::from_str(&content).map_err(|err| {
        EngineError::with_detail(
            "ai_settings_parse_failed",
            "终端 AI 配置文件解析失败",
            err.to_string(),
        )
    })?;
    let version = raw_value
        .get("version")
        .and_then(|value| value.as_u64())
        .unwrap_or(1);
    match version {
        1 => {
            let settings: AiSettings = serde_json::from_value(raw_value).map_err(|err| {
                EngineError::with_detail(
                    "ai_settings_parse_failed",
                    "终端 AI 配置文件解析失败",
                    err.to_string(),
                )
            })?;
            validate_ai_settings(settings)
        }
        _ => Err(EngineError::new(
            "ai_settings_parse_failed",
            "终端 AI 配置文件版本不受支持",
        )),
    }
}

/// 写入终端 AI 助手设置。
pub fn write_ai_settings(app: &AppHandle, settings: AiSettings) -> Result<AiSettings, EngineError> {
    let validated = validate_ai_settings(settings)?;
    let path = resolve_ai_settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            EngineError::with_detail(
                "ai_settings_write_failed",
                "无法创建终端 AI 配置目录",
                err.to_string(),
            )
        })?;
    }
    let content = serde_json::to_string_pretty(&validated).map_err(|err| {
        EngineError::with_detail(
            "ai_settings_serialize_failed",
            "无法序列化终端 AI 配置",
            err.to_string(),
        )
    })?;
    fs::write(path, content).map_err(|err| {
        EngineError::with_detail(
            "ai_settings_write_failed",
            "无法写入终端 AI 配置文件",
            err.to_string(),
        )
    })?;
    Ok(validated)
}

/// 读取前端设置页使用的 AI 配置视图。
pub fn read_ai_settings_view(app: &AppHandle) -> Result<AiSettingsView, EngineError> {
    let settings = read_ai_settings(app)?;
    Ok(build_settings_view(settings))
}

/// 保存前端设置页提交的 AI 配置。
pub fn save_ai_settings_input(
    app: &AppHandle,
    input: AiSettingsSaveInput,
) -> Result<AiSettingsView, EngineError> {
    let current = read_ai_settings(app)?;
    let crypto = load_ai_crypto(app)?;
    let secret_store = SecretStore::new(&crypto);
    let next = build_ai_settings_from_input(current, input, &secret_store)?;
    let saved = write_ai_settings(app, next)?;
    Ok(build_settings_view(saved))
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

fn default_debug_logging_enabled() -> bool {
    DEFAULT_DEBUG_LOGGING_ENABLED
}

fn default_ai_settings() -> AiSettings {
    AiSettings {
        version: CURRENT_AI_SETTINGS_VERSION,
        selection_max_chars: default_selection_max_chars(),
        session_recent_output_max_chars: default_session_recent_output_max_chars(),
        session_recent_output_max_snippets: default_session_recent_output_max_snippets(),
        selection_recent_output_max_chars: default_selection_recent_output_max_chars(),
        selection_recent_output_max_snippets: default_selection_recent_output_max_snippets(),
        request_cache_ttl_ms: default_request_cache_ttl_ms(),
        debug_logging_enabled: default_debug_logging_enabled(),
        active_openai_config_id: String::new(),
        openai_configs: Vec::new(),
    }
}

/// 对终端 AI 助手配置做统一归一化与校验。
fn validate_ai_settings(mut settings: AiSettings) -> Result<AiSettings, EngineError> {
    settings.version = CURRENT_AI_SETTINGS_VERSION;
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

    let mut seen_ids = HashSet::new();
    for config in &mut settings.openai_configs {
        config.id = config.id.trim().to_string();
        config.name = config.name.trim().to_string();
        config.base_url = config.base_url.trim().to_string();
        config.model = config.model.trim().to_string();
        config.api_key_ref = config
            .api_key_ref
            .take()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if config.id.is_empty() {
            return Err(EngineError::new(
                "ai_settings_invalid",
                "OpenAI 接入配置的 id 不能为空",
            ));
        }
        if !seen_ids.insert(config.id.clone()) {
            return Err(EngineError::new(
                "ai_settings_invalid",
                "OpenAI 接入配置的 id 不能重复",
            ));
        }
    }

    settings.active_openai_config_id = settings.active_openai_config_id.trim().to_string();
    if settings.openai_configs.is_empty() {
        settings.active_openai_config_id.clear();
    } else if settings.active_openai_config_id.is_empty()
        || !settings
            .openai_configs
            .iter()
            .any(|config| config.id == settings.active_openai_config_id)
    {
        return Err(EngineError::new(
            "ai_settings_invalid",
            "当前激活的 OpenAI 接入不存在",
        ));
    }

    Ok(settings)
}

/// 将落盘结构转换成前端设置页使用的只读视图。
fn build_settings_view(settings: AiSettings) -> AiSettingsView {
    AiSettingsView {
        version: settings.version,
        selection_max_chars: settings.selection_max_chars,
        session_recent_output_max_chars: settings.session_recent_output_max_chars,
        session_recent_output_max_snippets: settings.session_recent_output_max_snippets,
        selection_recent_output_max_chars: settings.selection_recent_output_max_chars,
        selection_recent_output_max_snippets: settings.selection_recent_output_max_snippets,
        request_cache_ttl_ms: settings.request_cache_ttl_ms,
        debug_logging_enabled: settings.debug_logging_enabled,
        active_openai_config_id: settings.active_openai_config_id,
        openai_configs: settings
            .openai_configs
            .into_iter()
            .map(|config| OpenAiConfigView {
                id: config.id,
                name: config.name,
                base_url: config.base_url,
                model: config.model,
                api_key_configured: config.api_key_ref.is_some(),
            })
            .collect(),
    }
}

fn build_ai_settings_from_input(
    current: AiSettings,
    input: AiSettingsSaveInput,
    secret_store: &SecretStore<'_>,
) -> Result<AiSettings, EngineError> {
    let current_config_map = current
        .openai_configs
        .iter()
        .map(|config| (config.id.clone(), config.clone()))
        .collect::<HashMap<_, _>>();
    let mut next_configs = Vec::with_capacity(input.openai_configs.len());
    for config in input.openai_configs {
        let current_config = current_config_map.get(&config.id);
        // 前端不会回传明文密钥状态，后端按显式策略保留、替换或清空当前 token。
        let api_key_ref = match config.api_key {
            SecretFieldUpdate::Keep => current_config.and_then(|item| item.api_key_ref.clone()),
            SecretFieldUpdate::Clear => None,
            SecretFieldUpdate::Replace { value } => {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    current_config.and_then(|item| item.api_key_ref.clone())
                } else {
                    secret_store.protect_optional_string(Some(trimmed))?
                }
            }
        };
        next_configs.push(OpenAiConfigSettings {
            id: config.id,
            name: config.name,
            base_url: config.base_url,
            model: config.model,
            api_key_ref,
        });
    }

    validate_ai_settings(AiSettings {
        version: CURRENT_AI_SETTINGS_VERSION,
        selection_max_chars: input.selection_max_chars,
        session_recent_output_max_chars: input.session_recent_output_max_chars,
        session_recent_output_max_snippets: input.session_recent_output_max_snippets,
        selection_recent_output_max_chars: input.selection_recent_output_max_chars,
        selection_recent_output_max_snippets: input.selection_recent_output_max_snippets,
        request_cache_ttl_ms: input.request_cache_ttl_ms,
        debug_logging_enabled: input.debug_logging_enabled,
        active_openai_config_id: input.active_openai_config_id,
        openai_configs: next_configs,
    })
}

/// 复用应用现有 secret provider，为 OpenAI API Key 提供同一套加密能力。
fn load_ai_crypto(app: &AppHandle) -> Result<CryptoService, EngineError> {
    let store = read_profiles(app).unwrap_or_else(|_| ProfileStore::default());
    CryptoService::new(store.secret.as_ref())
}

#[cfg(test)]
pub fn default_ai_settings_for_test() -> AiSettings {
    default_ai_settings()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ai_settings_are_blank_until_user_configures_openai() {
        let settings = default_ai_settings();
        assert_eq!(settings.version, 1);
        assert_eq!(settings.selection_max_chars, 1_500);
        assert!(settings.active_openai_config_id.is_empty());
        assert!(settings.openai_configs.is_empty());
    }
}
