//! RDP profile、会话与进程内运行时编排。
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use engine::EngineError;
use rdp_runtime::{
    ConnectSessionRequest as RuntimeConnectSessionRequest, InputEventPayload as RuntimeInputEvent,
    RdpRuntime, RuntimeError as RdpRuntimeError, SessionSnapshot as RuntimeSessionSnapshot,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// RDP 显示模式。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RdpDisplayMode {
    #[serde(rename = "fixed", alias = "Fixed")]
    Fixed,
    #[serde(rename = "window_sync", alias = "windowSync", alias = "WindowSync")]
    WindowSync,
}

/// RDP 剪贴板模式。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RdpClipboardMode {
    Disabled,
    Text,
}

/// RDP 自动重连策略。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpReconnectPolicy {
    pub enabled: bool,
    pub max_attempts: u8,
}

/// RDP Profile。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub tags: Option<Vec<String>>,
    pub password_ref: Option<String>,
    pub domain: Option<String>,
    pub ignore_certificate: bool,
    pub resolution_mode: RdpDisplayMode,
    pub width: u32,
    pub height: u32,
    pub clipboard_mode: RdpClipboardMode,
    pub reconnect_policy: RdpReconnectPolicy,
}

/// RDP 会话状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RdpSessionState {
    Idle,
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
    Error,
    CertificatePrompt,
}

/// RDP 证书确认信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpCertificatePrompt {
    pub fingerprint: String,
    pub subject: String,
    pub issuer: String,
}

/// RDP 运行时快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpSessionSnapshot {
    pub session_id: String,
    pub profile_id: String,
    pub state: RdpSessionState,
    pub created_at: u64,
    pub width: u32,
    pub height: u32,
    pub ws_url: Option<String>,
    pub last_error: Option<EngineError>,
    pub certificate_prompt: Option<RdpCertificatePrompt>,
}

/// RDP 输入事件。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpInputEvent {
    pub kind: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub button: Option<u8>,
    pub delta_x: Option<f64>,
    pub delta_y: Option<f64>,
    pub text: Option<String>,
    pub code: Option<String>,
    pub ctrl_key: Option<bool>,
    pub shift_key: Option<bool>,
    pub alt_key: Option<bool>,
    pub meta_key: Option<bool>,
}

#[derive(Debug, Clone)]
struct LocalSessionRuntime {
    snapshot: RdpSessionSnapshot,
    profile: RdpProfile,
}

/// RDP 运行时状态。
#[derive(Debug, Clone, Default)]
pub struct RdpState {
    sessions: Arc<Mutex<HashMap<String, LocalSessionRuntime>>>,
    runtime: RdpRuntime,
}

impl RdpState {
    /// 创建会话。
    pub async fn create_session(
        &self,
        profile: &RdpProfile,
    ) -> Result<RdpSessionSnapshot, EngineError> {
        let snapshot = RdpSessionSnapshot {
            session_id: Uuid::new_v4().to_string(),
            profile_id: profile.id.clone(),
            state: RdpSessionState::Idle,
            created_at: now_epoch(),
            width: profile.width.max(320),
            height: profile.height.max(200),
            ws_url: None,
            last_error: None,
            certificate_prompt: None,
        };
        let runtime_snapshot = self
            .runtime
            .create_session(snapshot.session_id.clone(), snapshot.profile_id.clone())
            .await
            .map_err(runtime_error)?;
        let snapshot = merge_runtime_snapshot_preserving_dimensions(snapshot, runtime_snapshot);
        let mut sessions = self.sessions.lock().map_err(lock_error)?;
        sessions.insert(
            snapshot.session_id.clone(),
            LocalSessionRuntime {
                snapshot: snapshot.clone(),
                profile: profile.clone(),
            },
        );
        Ok(snapshot)
    }

    /// 建立会话连接。
    pub async fn connect_session(
        &self,
        session_id: &str,
    ) -> Result<RdpSessionSnapshot, EngineError> {
        let (current, profile) = self.get_session_with_profile(session_id)?;
        let runtime_snapshot = self
            .runtime
            .connect_session(
                session_id,
                RuntimeConnectSessionRequest {
                    session_id: session_id.to_string(),
                    host: profile.host.clone(),
                    port: profile.port,
                    username: profile.username.clone(),
                    password: profile.password_ref.clone().unwrap_or_default(),
                    domain: profile.domain.clone(),
                    ignore_certificate: profile.ignore_certificate,
                    width: current.width,
                    height: current.height,
                },
            )
            .await
            .map_err(runtime_error)?;
        self.update_session_snapshot(session_id, |snapshot| {
            *snapshot = merge_runtime_snapshot(snapshot.clone(), runtime_snapshot);
        })
    }

    /// 断开会话。
    pub async fn disconnect_session(
        &self,
        session_id: &str,
    ) -> Result<RdpSessionSnapshot, EngineError> {
        let runtime_snapshot = self
            .runtime
            .disconnect_session(session_id)
            .map_err(runtime_error)?;
        let snapshot = self.update_session_snapshot(session_id, |snapshot| {
            *snapshot = merge_runtime_snapshot(snapshot.clone(), runtime_snapshot);
        })?;
        let mut sessions = self.sessions.lock().map_err(lock_error)?;
        sessions.remove(session_id);
        Ok(snapshot)
    }

    /// 更新会话分辨率。
    pub async fn resize_session(
        &self,
        session_id: &str,
        width: u32,
        height: u32,
    ) -> Result<RdpSessionSnapshot, EngineError> {
        let runtime_snapshot = self
            .runtime
            .resize_session(session_id, width, height)
            .map_err(runtime_error)?;
        self.update_session_snapshot(session_id, |snapshot| {
            *snapshot = merge_runtime_snapshot(snapshot.clone(), runtime_snapshot);
        })
    }

    /// 发送输入事件。
    pub async fn send_input(
        &self,
        session_id: &str,
        input: RdpInputEvent,
    ) -> Result<(), EngineError> {
        self.runtime
            .send_input(session_id, convert_input(input))
            .map_err(runtime_error)
    }

    /// 更新剪贴板内容。
    pub async fn set_clipboard(&self, session_id: &str, text: String) -> Result<(), EngineError> {
        self.runtime
            .set_clipboard(session_id, text)
            .map_err(runtime_error)
    }

    /// 处理证书确认。
    pub async fn decide_certificate(
        &self,
        session_id: &str,
        accept: bool,
    ) -> Result<RdpSessionSnapshot, EngineError> {
        let runtime_snapshot = self
            .runtime
            .decide_certificate(session_id, accept)
            .map_err(runtime_error)?;
        self.update_session_snapshot(session_id, |snapshot| {
            *snapshot = merge_runtime_snapshot(snapshot.clone(), runtime_snapshot);
        })
    }

    /// 关闭并回收当前运行时。
    pub fn shutdown_runtime(&self) -> Result<(), EngineError> {
        self.runtime.shutdown().map_err(runtime_error)?;
        let mut sessions = self.sessions.lock().map_err(lock_error)?;
        sessions.clear();
        Ok(())
    }

    fn get_session_with_profile(
        &self,
        session_id: &str,
    ) -> Result<(RdpSessionSnapshot, RdpProfile), EngineError> {
        let sessions = self.sessions.lock().map_err(lock_error)?;
        sessions
            .get(session_id)
            .map(|runtime| (runtime.snapshot.clone(), runtime.profile.clone()))
            .ok_or_else(|| EngineError::new("rdp_session_not_found", "RDP 会话不存在"))
    }

    fn update_session_snapshot(
        &self,
        session_id: &str,
        update: impl FnOnce(&mut RdpSessionSnapshot),
    ) -> Result<RdpSessionSnapshot, EngineError> {
        let mut sessions = self.sessions.lock().map_err(lock_error)?;
        let runtime = sessions
            .get_mut(session_id)
            .ok_or_else(|| EngineError::new("rdp_session_not_found", "RDP 会话不存在"))?;
        update(&mut runtime.snapshot);
        Ok(runtime.snapshot.clone())
    }
}

fn merge_runtime_snapshot(
    current: RdpSessionSnapshot,
    runtime: RuntimeSessionSnapshot,
) -> RdpSessionSnapshot {
    RdpSessionSnapshot {
        session_id: current.session_id,
        profile_id: current.profile_id,
        state: parse_state(&runtime.state),
        created_at: current.created_at,
        width: runtime.width.max(320),
        height: runtime.height.max(200),
        ws_url: runtime.ws_url,
        last_error: current.last_error,
        certificate_prompt: current.certificate_prompt,
    }
}

fn merge_runtime_snapshot_preserving_dimensions(
    current: RdpSessionSnapshot,
    runtime: RuntimeSessionSnapshot,
) -> RdpSessionSnapshot {
    RdpSessionSnapshot {
        session_id: current.session_id,
        profile_id: current.profile_id,
        state: parse_state(&runtime.state),
        created_at: current.created_at,
        width: current.width.max(320),
        height: current.height.max(200),
        ws_url: runtime.ws_url,
        last_error: current.last_error,
        certificate_prompt: current.certificate_prompt,
    }
}

fn parse_state(value: &str) -> RdpSessionState {
    match value {
        "connecting" => RdpSessionState::Connecting,
        "connected" => RdpSessionState::Connected,
        "reconnecting" => RdpSessionState::Reconnecting,
        "disconnected" => RdpSessionState::Disconnected,
        "error" => RdpSessionState::Error,
        "certificate_prompt" => RdpSessionState::CertificatePrompt,
        _ => RdpSessionState::Idle,
    }
}

fn convert_input(input: RdpInputEvent) -> RuntimeInputEvent {
    RuntimeInputEvent {
        kind: input.kind,
        x: input.x,
        y: input.y,
        button: input.button,
        delta_x: input.delta_x,
        delta_y: input.delta_y,
        text: input.text,
        code: input.code,
        ctrl_key: input.ctrl_key,
        shift_key: input.shift_key,
        alt_key: input.alt_key,
        meta_key: input.meta_key,
    }
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn runtime_error(err: RdpRuntimeError) -> EngineError {
    if let Some(detail) = err.detail {
        EngineError::with_detail(&err.code, &err.message, detail)
    } else {
        EngineError::new(&err.code, &err.message)
    }
}

fn lock_error(
    _: std::sync::PoisonError<std::sync::MutexGuard<'_, HashMap<String, LocalSessionRuntime>>>,
) -> EngineError {
    EngineError::new("rdp_runtime_poisoned", "RDP 运行时状态损坏")
}
