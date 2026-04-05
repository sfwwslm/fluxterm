//! 串口相关命令。

use engine::{EngineError, Session, TerminalSize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::ai::AiRuntimeState;
use crate::commands::profile::{
    dedupe_groups, normalize_profile_tags, validate_and_dedupe_groups, validate_profile_name,
};
use crate::resource_monitor::ResourceMonitorState;
use crate::serial::{
    SerialPortDescriptor, SerialProfile, SerialState, list_serial_ports, resize_serial_session,
    start_serial_session, stop_serial_session, write_serial_binary, write_serial_text,
};
use crate::serial_profile_store::{
    read_serial_groups, read_serial_profiles, write_serial_groups, write_serial_profiles,
};

#[tauri::command]
/// 读取串口 Profile 列表。
pub fn serial_profile_list(app: AppHandle) -> Result<Vec<SerialProfile>, EngineError> {
    Ok(read_serial_profiles(&app)?.profiles)
}

#[tauri::command]
/// 读取串口分组列表。
pub fn serial_profile_groups_list(app: AppHandle) -> Result<Vec<String>, EngineError> {
    Ok(dedupe_groups(read_serial_groups(&app)?))
}

#[tauri::command]
/// 写入串口分组列表。
pub fn serial_profile_groups_save(
    app: AppHandle,
    groups: Vec<String>,
) -> Result<Vec<String>, EngineError> {
    let next = validate_and_dedupe_groups(groups)?;
    write_serial_groups(&app, &next)?;
    Ok(next)
}

#[tauri::command]
/// 新增或更新串口 Profile。
pub fn serial_profile_save(
    app: AppHandle,
    mut profile: SerialProfile,
) -> Result<SerialProfile, EngineError> {
    let mut store = read_serial_profiles(&app)?;
    profile.name = validate_profile_name(profile.name)?;
    profile.tags = normalize_profile_tags(profile.tags)?;
    profile.port_path = profile.port_path.trim().to_string();
    if profile.port_path.is_empty() {
        return Err(EngineError::new("serial_port_required", "串口路径不能为空"));
    }
    if profile.baud_rate == 0 {
        return Err(EngineError::new(
            "serial_baud_rate_invalid",
            "波特率必须大于 0",
        ));
    }
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }
    let existing = store.profiles.iter_mut().find(|item| item.id == profile.id);
    if let Some(item) = existing {
        *item = profile.clone();
    } else {
        store.profiles.push(profile.clone());
    }
    store.updated_at = now_epoch();
    write_serial_profiles(&app, &store)?;
    Ok(profile)
}

#[tauri::command]
/// 删除指定串口 Profile。
pub fn serial_profile_delete(app: AppHandle, profile_id: String) -> Result<bool, EngineError> {
    let mut store = read_serial_profiles(&app)?;
    let before = store.profiles.len();
    store.profiles.retain(|item| item.id != profile_id);
    store.updated_at = now_epoch();
    write_serial_profiles(&app, &store)?;
    Ok(before != store.profiles.len())
}

#[tauri::command]
/// 枚举本机串口设备。
pub fn serial_port_list() -> Result<Vec<SerialPortDescriptor>, EngineError> {
    list_serial_ports()
}

#[tauri::command]
/// 建立串口会话。
pub fn serial_connect(
    app: AppHandle,
    state: State<'_, SerialState>,
    ai_state: State<'_, AiRuntimeState>,
    profile: SerialProfile,
    size: TerminalSize,
) -> Result<Session, EngineError> {
    start_serial_session(app, &state, &ai_state, profile, size)
}

#[tauri::command]
/// 发送串口文本输入。
pub async fn serial_write(
    state: State<'_, SerialState>,
    session_id: String,
    data: String,
) -> Result<(), EngineError> {
    write_serial_text(&state, &session_id, data).await
}

#[tauri::command]
/// 发送串口二进制输入。
pub async fn serial_write_binary(
    state: State<'_, SerialState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), EngineError> {
    write_serial_binary(&state, &session_id, data).await
}

#[tauri::command]
/// 调整串口会话尺寸。
pub fn serial_resize(
    state: State<'_, SerialState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), EngineError> {
    resize_serial_session(&state, &session_id, cols, rows)
}

#[tauri::command]
/// 关闭串口会话。
pub async fn serial_disconnect(
    state: State<'_, SerialState>,
    monitor_state: State<'_, ResourceMonitorState>,
    session_id: String,
) -> Result<(), EngineError> {
    monitor_state.stop(&session_id);
    stop_serial_session(&state, &session_id).await
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
