//! SSH 会话相关命令。
use engine::{EngineError, ExpectedHostKey, HostProfile, Session, TerminalSize, probe_host_key};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::ai::{AiRuntimeState, register_remote_session};
use crate::events::build_event_bridge;
use crate::resource_monitor::ResourceMonitorState;
use crate::session_settings::{HostKeyPolicy, read_session_settings};
use crate::ssh_host_keys::{HostKeyMatchStatus, match_host_key, trust_host_key};
use crate::state::EngineState;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// 前端弹窗确认 Host Key 所需的最小载荷。
struct HostKeyVerificationRequiredPayload {
    profile_id: String,
    host: String,
    port: u16,
    key_algorithm: String,
    public_key_base64: String,
    fingerprint_sha256: String,
    previous_fingerprint_sha256: Option<String>,
    policy: String,
}

#[tauri::command]
/// 建立 SSH 会话连接。
pub fn ssh_connect(
    app: AppHandle,
    state: State<EngineState>,
    ai_state: State<AiRuntimeState>,
    profile: HostProfile,
    size: TerminalSize,
) -> Result<Session, EngineError> {
    let expected_host_key = enforce_host_key_policy(&app, &profile)?;
    let on_event = build_event_bridge(app.clone());
    let session = state
        .engine
        .connect(profile.clone(), expected_host_key, size, on_event)?;
    register_remote_session(&ai_state, &session, &profile)?;
    Ok(session)
}

#[tauri::command]
/// 断开 SSH 会话连接。
pub fn ssh_disconnect(
    state: State<EngineState>,
    monitor_state: State<ResourceMonitorState>,
    session_id: String,
) -> Result<(), EngineError> {
    monitor_state.stop(&session_id);
    state.engine.disconnect(&session_id)
}

#[tauri::command]
/// 调整会话终端尺寸。
pub fn ssh_resize(
    state: State<EngineState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), EngineError> {
    state.engine.resize(&session_id, cols, rows)
}

#[tauri::command]
/// 发送终端输入数据。
pub fn ssh_write(
    state: State<EngineState>,
    session_id: String,
    data: String,
) -> Result<(), EngineError> {
    state.engine.write(&session_id, data.into_bytes())
}

#[tauri::command]
/// 显式确认并写入 Host Key 信任记录。
pub fn ssh_host_key_confirm(
    app: AppHandle,
    host: String,
    port: u16,
    key_algorithm: String,
    public_key_base64: String,
) -> Result<(), EngineError> {
    trust_host_key(&app, &host, port, &key_algorithm, &public_key_base64)
}

fn enforce_host_key_policy(
    app: &AppHandle,
    profile: &HostProfile,
) -> Result<Option<ExpectedHostKey>, EngineError> {
    let settings = read_session_settings(app)?;
    if settings.host_key_policy == HostKeyPolicy::Off {
        return Ok(None);
    }

    // 连接建立前先做一次 Host Key 预检。
    // ask / strict 的分流都在这里完成，正式握手阶段只负责校验“当前连接拿到的公钥”
    // 是否与本次预检允许通过的公钥一致。
    let probe = tauri::async_runtime::block_on(probe_host_key(profile))?;
    let matched = match_host_key(
        app,
        &profile.host,
        profile.port,
        &probe.key_algorithm,
        &probe.public_key_base64,
    )?;

    match (settings.host_key_policy, matched.status) {
        (_, HostKeyMatchStatus::Trusted) => Ok(Some(ExpectedHostKey {
            public_key_base64: probe.public_key_base64,
            fingerprint_sha256: probe.fingerprint_sha256,
        })),
        (HostKeyPolicy::Strict, HostKeyMatchStatus::Unknown) => Err(EngineError::new(
            "ssh_host_key_unknown",
            "目标主机尚未被信任，当前 Host Key 策略禁止直接连接",
        )),
        (HostKeyPolicy::Strict, HostKeyMatchStatus::Mismatch) => Err(EngineError::new(
            "ssh_host_key_mismatch",
            "目标主机指纹与本地记录不一致，连接已被阻断",
        )),
        (HostKeyPolicy::Ask, HostKeyMatchStatus::Unknown) => {
            emit_host_key_required(app, profile, &probe, None, "ask")?;
            Err(EngineError::new(
                "ssh_host_key_unknown",
                "首次连接该主机，等待用户确认 Host Key",
            ))
        }
        (HostKeyPolicy::Ask, HostKeyMatchStatus::Mismatch) => {
            emit_host_key_required(
                app,
                profile,
                &probe,
                matched.previous_fingerprint_sha256,
                "ask",
            )?;
            Err(EngineError::new(
                "ssh_host_key_mismatch",
                "目标主机指纹与本地记录不一致，等待用户确认",
            ))
        }
        (HostKeyPolicy::Off, _) => Ok(None),
    }
}

fn emit_host_key_required(
    app: &AppHandle,
    profile: &HostProfile,
    probe: &engine::HostKeyProbe,
    previous_fingerprint_sha256: Option<String>,
    policy: &str,
) -> Result<(), EngineError> {
    // 这里不携带 sessionId。
    // ask 模式下本次连接已经被中断，前端收到事件后要么新建连接，要么继续某条既有重连链路。
    app.emit(
        "ssh:host-key-verification-required",
        HostKeyVerificationRequiredPayload {
            profile_id: profile.id.clone(),
            host: profile.host.clone(),
            port: profile.port,
            key_algorithm: probe.key_algorithm.clone(),
            public_key_base64: probe.public_key_base64.clone(),
            fingerprint_sha256: probe.fingerprint_sha256.clone(),
            previous_fingerprint_sha256,
            policy: policy.to_string(),
        },
    )
    .map_err(|err| {
        EngineError::with_detail(
            "ssh_host_key_event_failed",
            "无法发送 Host Key 确认事件",
            err.to_string(),
        )
    })
}
