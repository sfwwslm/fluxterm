//! AI 会话上下文构建模块。

use engine::EngineError;
use openai::{
    ChatMessage, OpenAiSelectionExplainInput, OpenAiSessionChatInput, OpenAiSessionChatStreamInput,
    ResponseLanguageStrategy, SessionContextSnapshot,
};

use crate::ai::{AiRuntimeState, SessionContextRecord, with_store};

/// 会话上下文问答请求。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionChatRequest {
    pub session_id: String,
    pub response_language_strategy: ResponseLanguageStrategy,
    pub ui_language: String,
    pub messages: Vec<ChatMessage>,
}

/// 会话上下文问答流式请求。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionChatStreamRequest {
    pub request_id: String,
    pub session_id: String,
    pub response_language_strategy: ResponseLanguageStrategy,
    pub ui_language: String,
    pub messages: Vec<ChatMessage>,
}

/// 终端选中文本解释请求。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExplainSelectionRequest {
    pub session_id: String,
    pub response_language_strategy: ResponseLanguageStrategy,
    pub ui_language: String,
    pub selection_text: String,
}

/// 从运行时缓存构建会话上下文问答输入。
pub fn build_session_chat_input(
    state: &AiRuntimeState,
    request: AiSessionChatRequest,
) -> Result<OpenAiSessionChatInput, EngineError> {
    with_store(state, |store| {
        let session = store
            .sessions
            .get(&request.session_id)
            .ok_or_else(|| EngineError::new("ai_context_missing", "未找到当前会话的 AI 上下文"))?;
        Ok(OpenAiSessionChatInput {
            context: build_session_context_snapshot(session),
            response_language_strategy: request.response_language_strategy,
            ui_language: request.ui_language,
            messages: request.messages,
        })
    })
}

/// 从运行时缓存构建流式会话上下文问答输入。
pub fn build_session_chat_stream_input(
    state: &AiRuntimeState,
    request: AiSessionChatStreamRequest,
) -> Result<OpenAiSessionChatStreamInput, EngineError> {
    with_store(state, |store| {
        let session = store
            .sessions
            .get(&request.session_id)
            .ok_or_else(|| EngineError::new("ai_context_missing", "未找到当前会话的 AI 上下文"))?;
        Ok(OpenAiSessionChatStreamInput {
            request_id: request.request_id,
            context: build_session_context_snapshot(session),
            response_language_strategy: request.response_language_strategy,
            ui_language: request.ui_language,
            messages: request.messages,
        })
    })
}

/// 从运行时缓存构建选中文本解释输入。
pub fn build_selection_explain_input(
    state: &AiRuntimeState,
    request: AiExplainSelectionRequest,
    selection_max_chars: usize,
) -> Result<OpenAiSelectionExplainInput, EngineError> {
    with_store(state, |store| {
        let session = store
            .sessions
            .get(&request.session_id)
            .ok_or_else(|| EngineError::new("ai_context_missing", "未找到当前会话的 AI 上下文"))?;
        let selection_text = request.selection_text.trim();
        if selection_text.is_empty() {
            return Err(EngineError::new("ai_input_invalid", "选中文本不能为空"));
        }
        Ok(OpenAiSelectionExplainInput {
            context: build_session_context_snapshot(session),
            response_language_strategy: request.response_language_strategy,
            ui_language: request.ui_language,
            selection_text: truncate_chars(selection_text, selection_max_chars),
        })
    })
}

fn build_session_context_snapshot(session: &SessionContextRecord) -> SessionContextSnapshot {
    SessionContextSnapshot {
        session_id: session.session_id.clone(),
        session_label: session.session_label.clone(),
        session_kind: session.session_kind.clone(),
        host: session.host.clone(),
        username: session.username.clone(),
        platform: session.platform.clone(),
        shell_name: session.shell_name.clone(),
        session_state: session.session_state.clone(),
        resource_monitor_status: session.resource_monitor_status.clone(),
        host_key_status: session.host_key_status.clone(),
        recent_terminal_output: session.recent_terminal_output.iter().cloned().collect(),
    }
}

fn truncate_chars(input: &str, limit: usize) -> String {
    if input.chars().count() <= limit {
        return input.to_string();
    }
    input.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{AiRuntimeState, register_local_session};
    use engine::{Session, SessionState};

    #[test]
    fn build_session_chat_input_requires_session() {
        let state = AiRuntimeState::default();
        let err = build_session_chat_input(
            &state,
            AiSessionChatRequest {
                session_id: "missing".to_string(),
                response_language_strategy: ResponseLanguageStrategy::FollowUserInput,
                ui_language: "zh".to_string(),
                messages: vec![],
            },
        )
        .expect_err("missing session should fail");
        assert_eq!(err.code, "ai_context_missing");
    }

    #[test]
    fn build_session_chat_input_uses_registered_session() {
        let state = AiRuntimeState::default();
        register_local_session(
            &state,
            &Session {
                session_id: "local-1".to_string(),
                profile_id: "__local_shell__".to_string(),
                state: SessionState::Connected,
                created_at: 0,
                last_error: None,
            },
            "PowerShell",
            Some("PowerShell".to_string()),
        )
        .unwrap();

        let input = build_session_chat_input(
            &state,
            AiSessionChatRequest {
                session_id: "local-1".to_string(),
                response_language_strategy: ResponseLanguageStrategy::FollowUserInput,
                ui_language: "en".to_string(),
                messages: vec![ChatMessage {
                    role: "user".to_string(),
                    content: "pwd".to_string(),
                }],
            },
        )
        .expect("session chat input should build");

        assert_eq!(input.context.session_label, "PowerShell");
        assert_eq!(input.context.platform.as_deref(), Some("windows"));
        assert_eq!(input.messages.len(), 1);
    }

    #[test]
    fn build_selection_explain_input_requires_selection_text() {
        let state = AiRuntimeState::default();
        register_local_session(
            &state,
            &Session {
                session_id: "local-2".to_string(),
                profile_id: "__local_shell__".to_string(),
                state: SessionState::Connected,
                created_at: 0,
                last_error: None,
            },
            "PowerShell",
            Some("PowerShell".to_string()),
        )
        .unwrap();

        let err = build_selection_explain_input(
            &state,
            AiExplainSelectionRequest {
                session_id: "local-2".to_string(),
                response_language_strategy: ResponseLanguageStrategy::FollowUi,
                ui_language: "zh".to_string(),
                selection_text: "   ".to_string(),
            },
            1_500,
        )
        .expect_err("empty selection should fail");

        assert_eq!(err.code, "ai_input_invalid");
    }

    #[test]
    fn build_selection_explain_input_uses_configured_limit() {
        let state = AiRuntimeState::default();
        register_local_session(
            &state,
            &Session {
                session_id: "local-3".to_string(),
                profile_id: "__local_shell__".to_string(),
                state: SessionState::Connected,
                created_at: 0,
                last_error: None,
            },
            "PowerShell",
            Some("PowerShell".to_string()),
        )
        .unwrap();

        let input = build_selection_explain_input(
            &state,
            AiExplainSelectionRequest {
                session_id: "local-3".to_string(),
                response_language_strategy: ResponseLanguageStrategy::FollowUi,
                ui_language: "zh".to_string(),
                selection_text: "abcdef".to_string(),
            },
            4,
        )
        .expect("selection input should build");

        assert_eq!(input.selection_text, "abcd");
    }
}
