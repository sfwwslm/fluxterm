//! AI 能力命令。

use engine::EngineError;
use openai::OpenAiSessionChatResponse;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::{
    AiRuntimeState, cancel_chat_stream, context, finish_chat_stream, read_openai_config,
    register_chat_stream,
};
use crate::ai_settings::read_ai_settings;

/// 基于当前会话上下文执行问答。
#[tauri::command]
pub async fn ai_session_chat(
    state: State<'_, AiRuntimeState>,
    request: context::AiSessionChatRequest,
) -> Result<OpenAiSessionChatResponse, EngineError> {
    let config = read_openai_config()?;
    let input = context::build_session_chat_input(&state, request)?;
    openai::chat_session(&config, input)
        .await
        .map_err(map_openai_error)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiChatChunkPayload {
    request_id: String,
    session_id: String,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiChatDonePayload {
    request_id: String,
    session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiChatErrorPayload {
    request_id: String,
    session_id: String,
    error: EngineError,
}

/// 启动会话上下文问答流式输出。
#[tauri::command]
pub async fn ai_session_chat_stream_start(
    app: AppHandle,
    state: State<'_, AiRuntimeState>,
    request: context::AiSessionChatStreamRequest,
) -> Result<(), EngineError> {
    let config = read_openai_config()?;
    let stream_request_id = request.request_id.clone();
    let input = context::build_session_chat_stream_input(&state, request)?;
    let cancelled = register_chat_stream(&state, &stream_request_id)?;
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // 后端负责把模型增量文本转成前端事件，前端只按 requestId 追加当前 assistant 消息。
        let request_id = input.request_id.clone();
        let session_id = input.context.session_id.clone();
        let emit_handle = app_handle.clone();
        let result = openai::chat_session_stream(
            &config,
            input,
            |content: &str| {
                emit_handle
                    .emit(
                        "ai:chat-chunk",
                        AiChatChunkPayload {
                            request_id: request_id.clone(),
                            session_id: session_id.clone(),
                            content: content.to_string(),
                        },
                    )
                    .map_err(|err| OpenAiToEngineError::from_emit(err).into_openai())?;
                Ok(())
            },
            || cancelled.load(std::sync::atomic::Ordering::SeqCst),
        )
        .await;

        let state_handle = app_handle.state::<AiRuntimeState>();
        let _ = finish_chat_stream(&state_handle, &request_id);
        match result {
            Ok(()) => {
                let _ = app_handle.emit(
                    "ai:chat-done",
                    AiChatDonePayload {
                        request_id,
                        session_id,
                    },
                );
            }
            Err(error) => {
                let _ = app_handle.emit(
                    "ai:chat-error",
                    AiChatErrorPayload {
                        request_id,
                        session_id,
                        error: map_openai_error(error),
                    },
                );
            }
        }
    });
    Ok(())
}

/// 取消会话上下文问答流式输出。
#[tauri::command]
pub fn ai_session_chat_stream_cancel(
    state: State<'_, AiRuntimeState>,
    request_id: String,
) -> Result<bool, EngineError> {
    cancel_chat_stream(&state, &request_id)
}

/// 基于当前会话与选中文本执行解释。
#[tauri::command]
pub async fn ai_explain_selection(
    app: AppHandle,
    state: State<'_, AiRuntimeState>,
    request: context::AiExplainSelectionRequest,
) -> Result<OpenAiSessionChatResponse, EngineError> {
    let config = read_openai_config()?;
    let settings = read_ai_settings(&app)?;
    let input =
        context::build_selection_explain_input(&state, request, settings.selection_max_chars)?;
    openai::explain_selection(&config, input)
        .await
        .map_err(map_openai_error)
}

fn map_openai_error(error: openai::OpenAiError) -> EngineError {
    match error {
        openai::OpenAiError::Config(message) => EngineError::new("ai_unavailable", message),
        openai::OpenAiError::Timeout(message) => EngineError::new("ai_timeout", message),
        openai::OpenAiError::RateLimited(message) => EngineError::new("ai_rate_limited", message),
        openai::OpenAiError::ResponseInvalid(message) => {
            EngineError::new("ai_response_invalid", message)
        }
        openai::OpenAiError::Request(message) => EngineError::new("ai_request_failed", message),
        openai::OpenAiError::Http(_, message) => EngineError::new("ai_request_failed", message),
    }
}

struct OpenAiToEngineError(EngineError);

impl OpenAiToEngineError {
    fn from_emit(error: tauri::Error) -> Self {
        Self(EngineError::with_detail(
            "ai_event_emit_failed",
            "无法发送 AI 流式事件",
            error.to_string(),
        ))
    }

    fn into_openai(self) -> openai::OpenAiError {
        openai::OpenAiError::Request(self.0.message)
    }
}
