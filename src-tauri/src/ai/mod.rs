//! AI 能力接入模块。
//!
//! 当前职责：
//! - 维护 OpenAI 配置解析
//! - 维护终端会话问答所需的运行时缓存
//! - 向命令层暴露会话上下文构建能力

pub mod context;

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use engine::{EngineError, HostProfile, Session, SessionResourceSnapshot, SessionState};
use openai::OpenAiClientConfig;
use tauri::{AppHandle, Manager};

const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com";
const DEFAULT_OPENAI_MODEL: &str = "gpt-4.1-mini";
const DEFAULT_OPENAI_TIMEOUT_MS: u64 = 20_000;
const MAX_OUTPUT_CHARS: usize = 6_000;
const MAX_OUTPUT_SNIPPETS: usize = 8;

/// AI 运行时共享状态。
pub struct AiRuntimeState {
    inner: Mutex<AiRuntimeStore>,
}

impl Default for AiRuntimeState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(AiRuntimeStore::default()),
        }
    }
}

#[derive(Default)]
pub(crate) struct AiRuntimeStore {
    sessions: HashMap<String, SessionContextRecord>,
    active_streams: HashMap<String, Arc<AtomicBool>>,
    request_cache: HashMap<String, CachedAiResponse>,
}

#[derive(Clone)]
pub(crate) struct SessionContextRecord {
    pub session_id: String,
    pub session_label: String,
    pub session_kind: String,
    pub host: Option<String>,
    pub username: Option<String>,
    pub platform: Option<String>,
    pub shell_name: Option<String>,
    pub session_state: String,
    pub resource_monitor_status: Option<String>,
    pub host_key_status: Option<String>,
    pub recent_terminal_output: VecDeque<String>,
}

#[derive(Clone)]
struct CachedAiResponse {
    content: String,
    expires_at: Instant,
}

impl SessionContextRecord {
    fn from_remote(session: &Session, profile: &HostProfile) -> Self {
        Self {
            session_id: session.session_id.clone(),
            session_label: profile.name.clone(),
            session_kind: "ssh".to_string(),
            host: Some(profile.host.clone()),
            username: (!profile.username.trim().is_empty()).then(|| profile.username.clone()),
            platform: None,
            shell_name: None,
            session_state: "connected".to_string(),
            resource_monitor_status: None,
            host_key_status: Some("trusted".to_string()),
            recent_terminal_output: VecDeque::new(),
        }
    }

    fn from_local(session: &Session, label: &str, shell_name: Option<String>) -> Self {
        Self {
            session_id: session.session_id.clone(),
            session_label: label.to_string(),
            session_kind: "local".to_string(),
            host: None,
            username: None,
            platform: Some(current_platform().to_string()),
            shell_name,
            session_state: "connected".to_string(),
            resource_monitor_status: None,
            host_key_status: None,
            recent_terminal_output: VecDeque::new(),
        }
    }
}

/// 读取当前 OpenAI 配置。
pub fn read_openai_config() -> Result<OpenAiClientConfig, EngineError> {
    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err(EngineError::new(
            "ai_api_key_missing",
            "未配置 OPENAI_API_KEY，AI 功能当前不可用",
        ));
    }

    let base_url = std::env::var("OPENAI_BASE_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_OPENAI_BASE_URL.to_string());
    let model = std::env::var("OPENAI_MODEL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string());
    let timeout_ms = std::env::var("OPENAI_TIMEOUT_MS")
        .ok()
        .map(|value| value.trim().parse::<u64>())
        .transpose()
        .map_err(|err| {
            EngineError::with_detail(
                "ai_config_invalid",
                "OPENAI_TIMEOUT_MS 不是合法整数",
                err.to_string(),
            )
        })?
        .unwrap_or(DEFAULT_OPENAI_TIMEOUT_MS);

    Ok(OpenAiClientConfig {
        api_key,
        base_url,
        model,
        timeout_ms,
    })
}

/// 记录 SSH 会话元数据，供后续 AI 上下文消费。
pub fn register_remote_session(
    state: &AiRuntimeState,
    session: &Session,
    profile: &HostProfile,
) -> Result<(), EngineError> {
    let mut store = state
        .inner
        .lock()
        .map_err(|_| EngineError::new("ai_state_lock_failed", "无法访问 AI 运行时状态"))?;
    store.sessions.insert(
        session.session_id.clone(),
        SessionContextRecord::from_remote(session, profile),
    );
    Ok(())
}

/// 记录本地 Shell 会话元数据，供后续 AI 上下文消费。
pub fn register_local_session(
    state: &AiRuntimeState,
    session: &Session,
    label: &str,
    shell_name: Option<String>,
) -> Result<(), EngineError> {
    let mut store = state
        .inner
        .lock()
        .map_err(|_| EngineError::new("ai_state_lock_failed", "无法访问 AI 运行时状态"))?;
    store.sessions.insert(
        session.session_id.clone(),
        SessionContextRecord::from_local(session, label, shell_name),
    );
    Ok(())
}

/// 记录终端输出片段。
pub fn record_terminal_output_from_app(app: &AppHandle, session_id: &str, data: &str) {
    let state = app.state::<AiRuntimeState>();
    if let Ok(mut store) = state.inner.lock()
        && let Some(session) = store.sessions.get_mut(session_id)
    {
        let normalized = data.trim();
        if normalized.is_empty() {
            return;
        }
        session
            .recent_terminal_output
            .push_back(truncate_chars(normalized, 512));
        while session.recent_terminal_output.len() > MAX_OUTPUT_SNIPPETS {
            session.recent_terminal_output.pop_front();
        }
        trim_output_budget(&mut session.recent_terminal_output, MAX_OUTPUT_CHARS);
    }
}

/// 记录终端退出。
pub fn record_terminal_exit_from_app(app: &AppHandle, session_id: &str) {
    let state = app.state::<AiRuntimeState>();
    if let Ok(mut store) = state.inner.lock()
        && let Some(session) = store.sessions.get_mut(session_id)
    {
        session.session_state = "disconnected".to_string();
    }
}

/// 记录会话状态事件。
pub fn record_session_status_from_app(
    app: &AppHandle,
    session_id: &str,
    state_name: SessionState,
    error: Option<engine::EngineError>,
) {
    let state = app.state::<AiRuntimeState>();
    if let Ok(mut store) = state.inner.lock()
        && let Some(session) = store.sessions.get_mut(session_id)
    {
        session.session_state = match state_name {
            SessionState::Connecting => "connecting",
            SessionState::Connected => "connected",
            SessionState::Disconnected => "disconnected",
            SessionState::Error => "error",
        }
        .to_string();
        if let Some(error) = error {
            update_host_key_status(session, &error.code);
        }
    }
}

/// 记录资源监控状态。
pub fn record_resource_snapshot_from_app(app: &AppHandle, snapshot: &SessionResourceSnapshot) {
    let state = app.state::<AiRuntimeState>();
    if let Ok(mut store) = state.inner.lock()
        && let Some(session) = store.sessions.get_mut(&snapshot.session_id)
    {
        session.resource_monitor_status = Some(format!("{:?}", snapshot.status).to_lowercase());
    }
}

pub(crate) fn with_store<T>(
    state: &AiRuntimeState,
    callback: impl FnOnce(&AiRuntimeStore) -> Result<T, EngineError>,
) -> Result<T, EngineError> {
    let store = state
        .inner
        .lock()
        .map_err(|_| EngineError::new("ai_state_lock_failed", "无法访问 AI 运行时状态"))?;
    callback(&store)
}

/// 注册流式问答请求，返回取消标记。
pub fn register_chat_stream(
    state: &AiRuntimeState,
    request_id: &str,
) -> Result<Arc<AtomicBool>, EngineError> {
    let mut store = state
        .inner
        .lock()
        .map_err(|_| EngineError::new("ai_state_lock_failed", "无法访问 AI 运行时状态"))?;
    let cancelled = Arc::new(AtomicBool::new(false));
    store
        .active_streams
        .insert(request_id.to_string(), cancelled.clone());
    Ok(cancelled)
}

/// 取消流式问答请求。
pub fn cancel_chat_stream(state: &AiRuntimeState, request_id: &str) -> Result<bool, EngineError> {
    let store = state
        .inner
        .lock()
        .map_err(|_| EngineError::new("ai_state_lock_failed", "无法访问 AI 运行时状态"))?;
    Ok(store
        .active_streams
        .get(request_id)
        .map(|flag| {
            flag.store(true, Ordering::SeqCst);
            true
        })
        .unwrap_or(false))
}

/// 清理流式问答请求。
pub fn finish_chat_stream(state: &AiRuntimeState, request_id: &str) -> Result<(), EngineError> {
    let mut store = state
        .inner
        .lock()
        .map_err(|_| EngineError::new("ai_state_lock_failed", "无法访问 AI 运行时状态"))?;
    store.active_streams.remove(request_id);
    Ok(())
}

/// 尝试读取尚未过期的 AI 响应缓存。
pub fn get_cached_response(
    state: &AiRuntimeState,
    cache_key: &str,
) -> Result<Option<String>, EngineError> {
    let mut store = state
        .inner
        .lock()
        .map_err(|_| EngineError::new("ai_state_lock_failed", "无法访问 AI 运行时状态"))?;
    prune_expired_cache(&mut store.request_cache);
    Ok(store
        .request_cache
        .get(cache_key)
        .map(|entry| entry.content.clone()))
}

/// 写入短时间内可复用的 AI 响应缓存。
pub fn store_cached_response(
    state: &AiRuntimeState,
    cache_key: String,
    content: String,
    ttl_ms: u64,
) -> Result<(), EngineError> {
    let mut store = state
        .inner
        .lock()
        .map_err(|_| EngineError::new("ai_state_lock_failed", "无法访问 AI 运行时状态"))?;
    prune_expired_cache(&mut store.request_cache);
    store.request_cache.insert(
        cache_key,
        CachedAiResponse {
            content,
            expires_at: Instant::now() + Duration::from_millis(ttl_ms),
        },
    );
    Ok(())
}

fn update_host_key_status(session: &mut SessionContextRecord, error_code: &str) {
    session.host_key_status =
        resolve_host_key_status(error_code).or_else(|| session.host_key_status.clone());
}

fn resolve_host_key_status(error_code: &str) -> Option<String> {
    match error_code {
        "ssh_host_key_unknown" => Some("unknown".to_string()),
        "ssh_host_key_mismatch" => Some("mismatch".to_string()),
        _ => None,
    }
}

fn trim_output_budget(items: &mut VecDeque<String>, limit: usize) {
    while items.iter().map(|item| item.chars().count()).sum::<usize>() > limit {
        items.pop_front();
    }
}

fn prune_expired_cache(cache: &mut HashMap<String, CachedAiResponse>) {
    let now = Instant::now();
    cache.retain(|_, value| value.expires_at > now);
}

fn truncate_chars(input: &str, limit: usize) -> String {
    if input.chars().count() <= limit {
        return input.to_string();
    }
    input.chars().take(limit).collect()
}

fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }

    #[cfg(target_os = "linux")]
    {
        "linux"
    }

    #[cfg(target_os = "macos")]
    {
        "macos"
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        "unknown"
    }
}

#[cfg(test)]
pub fn record_terminal_output_for_test(state: &AiRuntimeState, session_id: &str, data: &str) {
    if let Ok(mut store) = state.inner.lock()
        && let Some(session) = store.sessions.get_mut(session_id)
    {
        session.recent_terminal_output.push_back(data.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_chars_keeps_limit() {
        let result = truncate_chars("abcdefgh", 4);
        assert_eq!(result, "abcd");
    }

    #[test]
    fn cached_response_expires() {
        let state = AiRuntimeState::default();
        store_cached_response(&state, "k".to_string(), "v".to_string(), 1).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        let cached = get_cached_response(&state, "k").unwrap();
        assert!(cached.is_none());
    }
}
