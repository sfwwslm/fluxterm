//! 引擎事件到前端事件的桥接。
use std::sync::Arc;

use engine::{EngineError, EngineEvent, SessionState};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatusPayload {
    session_id: String,
    state: SessionState,
    error: Option<EngineError>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    session_id: String,
}

/// 构建引擎事件到前端事件的桥接器。
pub fn build_event_bridge(app: AppHandle) -> Arc<dyn Fn(EngineEvent) + Send + Sync> {
    Arc::new(move |event| match event {
        EngineEvent::TerminalOutput { session_id, data } => {
            let _ = app.emit(
                "terminal:output",
                TerminalOutputPayload { session_id, data },
            );
        }
        EngineEvent::TerminalExit { session_id } => {
            let _ = app.emit("terminal:exit", TerminalExitPayload { session_id });
        }
        EngineEvent::SftpProgress(progress) => {
            let _ = app.emit("sftp:progress", progress);
        }
        EngineEvent::SessionResource(resource) => {
            let _ = app.emit("session:resource", resource);
        }
        EngineEvent::SessionStatus {
            session_id,
            state,
            error,
        } => {
            let _ = app.emit(
                "session:status",
                SessionStatusPayload {
                    session_id,
                    state,
                    error,
                },
            );
        }
    })
}
