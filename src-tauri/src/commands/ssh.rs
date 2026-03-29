//! SSH 会话相关命令。
use engine::{EngineError, ExpectedHostKey, HostProfile, Session, TerminalSize, probe_host_key};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::ai::{AiRuntimeState, register_remote_session};
use crate::events::build_event_bridge;
use crate::profile_secrets::decrypt_profile_secrets;
use crate::resource_monitor::ResourceMonitorState;
use crate::security::{CryptoService, SecretStore};
use crate::security_store::read_security_config;
use crate::session_settings::{HostKeyPolicy, read_session_settings};
use crate::ssh_host_keys::{HostKeyMatchStatus, match_host_key, trust_host_key};
use crate::ssh_profile_store::read_ssh_profiles;
use crate::state::{EngineState, SecurityState};

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
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, EngineState>,
    security: State<'_, SecurityState>,
    ai_state: State<'_, AiRuntimeState>,
    profile: HostProfile,
    size: TerminalSize,
) -> Result<Session, EngineError> {
    let resolved_profile = resolve_connect_profile(&app, &security, &profile)?;
    let expected_host_key = enforce_host_key_policy(&app, &resolved_profile).await?;
    let on_event = build_event_bridge(app.clone());
    let session =
        state
            .engine
            .connect(resolved_profile.clone(), expected_host_key, size, on_event)?;
    register_remote_session(&ai_state, &session, &resolved_profile)?;
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
/// 发送终端二进制输入数据。
pub fn ssh_write_binary(
    state: State<EngineState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), EngineError> {
    state.engine.write(&session_id, data)
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

async fn enforce_host_key_policy(
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
    let probe = probe_host_key(profile).await?;
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

fn resolve_connect_profile(
    app: &AppHandle,
    security: &State<'_, SecurityState>,
    requested_profile: &HostProfile,
) -> Result<HostProfile, EngineError> {
    // 连接时必须回读磁盘中的 profile，再按当前安全状态解保护。
    // 这样在用户锁定后，即使前端仍保留旧的明文副本，也不能继续建立 SSH 连接。
    if requested_profile.id.trim().is_empty() {
        return Err(EngineError::new("profile_not_found", "会话配置不存在"));
    }
    let store = read_ssh_profiles(app)?;
    let encrypted_profile = store
        .profiles
        .into_iter()
        .find(|item| item.id == requested_profile.id)
        .ok_or_else(|| EngineError::new("profile_not_found", "会话配置不存在"))?;
    let security_config = read_security_config(app)?;
    let session = security.current_session();
    let crypto = CryptoService::new(security_config.as_ref(), session.as_ref())?;
    let secret_store = SecretStore::new(&crypto);
    decrypt_profile_secrets(encrypted_profile, &secret_store)
}
