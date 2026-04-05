//! 串口 runtime 与枚举能力。
//!
//! 首版职责：
//! - 管理串口 Profile DTO
//! - 枚举本机可用串口
//! - 启动/写入/关闭串口会话
//! - 通过既有 `terminal:*` 事件把字节流接入终端 UI

use std::collections::HashMap;
use std::sync::Mutex;

use engine::{EngineError, Session, SessionState, TerminalSize, util::now_epoch};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};
use tokio_serial::{
    DataBits, FlowControl, Parity, SerialPortBuilderExt, SerialPortInfo, SerialStream, StopBits,
};
use uuid::Uuid;

use crate::ai::{AiRuntimeState, register_serial_session};

/// 串口数据位。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialDataBits {
    Five,
    Six,
    Seven,
    #[default]
    Eight,
}

/// 串口停止位。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialStopBits {
    #[default]
    One,
    Two,
}

/// 串口校验位。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialParity {
    #[default]
    None,
    Odd,
    Even,
}

/// 串口流控。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialFlowControl {
    #[default]
    None,
    Software,
    Hardware,
}

/// 串口发送换行策略。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialLineEnding {
    None,
    #[default]
    Lf,
    Cr,
    CrLf,
}

/// 串口 Profile。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialProfile {
    pub id: String,
    pub name: String,
    pub port_path: String,
    pub baud_rate: u32,
    pub data_bits: Option<SerialDataBits>,
    pub stop_bits: Option<SerialStopBits>,
    pub parity: Option<SerialParity>,
    pub flow_control: Option<SerialFlowControl>,
    pub charset: Option<String>,
    pub word_separators: Option<String>,
    pub bell_mode: Option<String>,
    pub bell_cooldown_ms: Option<u32>,
    pub local_echo: Option<bool>,
    pub line_ending: Option<SerialLineEnding>,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
}

/// 串口枚举结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortDescriptor {
    pub path: String,
    pub port_name: String,
    pub port_type: String,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    session_id: String,
}

enum SerialCommand {
    Write {
        data: Vec<u8>,
        echo: Option<String>,
        respond_to: oneshot::Sender<Result<(), EngineError>>,
    },
    Disconnect {
        respond_to: oneshot::Sender<Result<(), EngineError>>,
    },
}

struct SerialSessionHandle {
    tx: mpsc::UnboundedSender<SerialCommand>,
    profile: SerialProfile,
}

/// 串口共享状态。
pub struct SerialState {
    sessions: Mutex<HashMap<String, SerialSessionHandle>>,
}

impl Default for SerialState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

/// 枚举可用串口设备。
pub fn list_serial_ports() -> Result<Vec<SerialPortDescriptor>, EngineError> {
    let ports = tokio_serial::available_ports().map_err(|err| {
        EngineError::with_detail(
            "serial_ports_list_failed",
            "无法枚举串口设备",
            err.to_string(),
        )
    })?;
    let mut items = ports
        .into_iter()
        .map(map_serial_port_info)
        .collect::<Vec<_>>();
    items.sort_by(|a, b| a.port_name.to_lowercase().cmp(&b.port_name.to_lowercase()));
    Ok(items)
}

/// 启动串口会话。
pub fn start_serial_session(
    app: AppHandle,
    state: &SerialState,
    ai_state: &AiRuntimeState,
    profile: SerialProfile,
    _size: TerminalSize,
) -> Result<Session, EngineError> {
    let session_id = Uuid::new_v4().to_string();
    let stream = open_serial_stream(&profile)?;
    let (reader, mut writer) = tokio::io::split(stream);
    let (tx, mut rx) = mpsc::unbounded_channel::<SerialCommand>();
    let reader_session_id = session_id.clone();
    let reader_app = app.clone();
    let read_charset = normalize_charset(profile.charset.as_deref());

    tauri::async_runtime::spawn(async move {
        let mut reader = reader;
        let mut read_buffer = [0u8; 8192];
        loop {
            tokio::select! {
                biased;
                command = rx.recv() => {
                    match command {
                        Some(SerialCommand::Write { data, echo, respond_to }) => {
                            let result = async {
                                writer.write_all(&data).await.map_err(|err| {
                                    EngineError::with_detail(
                                        "serial_write_failed",
                                        "无法写入串口设备",
                                        err.to_string(),
                                    )
                                })?;
                                writer.flush().await.map_err(|err| {
                                    EngineError::with_detail(
                                        "serial_write_failed",
                                        "无法刷新串口设备写入缓冲区",
                                        err.to_string(),
                                    )
                                })?;
                                Ok(())
                            }.await;
                            if result.is_ok() && let Some(data) = echo {
                                let _ = reader_app.emit(
                                    "terminal:output",
                                    TerminalOutputPayload {
                                        session_id: reader_session_id.clone(),
                                        data,
                                    },
                                );
                            }
                            let _ = respond_to.send(result);
                        }
                        Some(SerialCommand::Disconnect { respond_to }) => {
                            let _ = writer.shutdown().await;
                            let _ = respond_to.send(Ok(()));
                            break;
                        }
                        None => break,
                    }
                }
                read_result = reader.read(&mut read_buffer) => {
                    match read_result {
                        Ok(0) => break,
                        Ok(size) => {
                            let decoded = decode_serial_bytes(&read_buffer[..size], read_charset);
                            let _ = reader_app.emit(
                                "terminal:output",
                                TerminalOutputPayload {
                                    session_id: reader_session_id.clone(),
                                    data: decoded,
                                },
                            );
                        }
                        Err(_) => break,
                    }
                }
            }
        }

        let _ = reader_app.emit(
            "terminal:exit",
            TerminalExitPayload {
                session_id: reader_session_id,
            },
        );
    });

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| EngineError::new("serial_lock_failed", "无法访问串口会话状态"))?;
    sessions.insert(
        session_id.clone(),
        SerialSessionHandle {
            tx,
            profile: profile.clone(),
        },
    );
    drop(sessions);

    let session = Session {
        session_id,
        profile_id: profile.id.clone(),
        state: SessionState::Connected,
        created_at: now_epoch(),
        last_error: None,
    };
    register_serial_session(ai_state, &session, &profile)?;
    Ok(session)
}

/// 发送串口文本输入。
pub async fn write_serial_text(
    state: &SerialState,
    session_id: &str,
    data: String,
) -> Result<(), EngineError> {
    let profile = get_serial_session_profile(state, session_id)?;
    let echo_payload = if profile.local_echo.unwrap_or(false) {
        Some(apply_line_ending(&data, profile.line_ending))
    } else {
        None
    };
    let payload = apply_line_ending(&data, profile.line_ending).into_bytes();
    send_serial_command(
        state,
        session_id,
        SerialCommand::Write {
            data: payload,
            echo: echo_payload,
            respond_to: oneshot::channel().0,
        },
    )
    .await
}

/// 发送串口二进制输入。
pub async fn write_serial_binary(
    state: &SerialState,
    session_id: &str,
    data: Vec<u8>,
) -> Result<(), EngineError> {
    send_serial_command(
        state,
        session_id,
        SerialCommand::Write {
            data,
            echo: None,
            respond_to: oneshot::channel().0,
        },
    )
    .await
}

/// 读取串口会话绑定的 Profile 快照。
pub fn get_serial_session_profile(
    state: &SerialState,
    session_id: &str,
) -> Result<SerialProfile, EngineError> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| EngineError::new("serial_lock_failed", "无法访问串口会话状态"))?;
    sessions
        .get(session_id)
        .map(|handle| handle.profile.clone())
        .ok_or_else(|| EngineError::new("serial_missing", "串口会话不存在"))
}

/// 调整串口会话尺寸。
pub fn resize_serial_session(
    state: &SerialState,
    session_id: &str,
    _cols: u16,
    _rows: u16,
) -> Result<(), EngineError> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| EngineError::new("serial_lock_failed", "无法访问串口会话状态"))?;
    if !sessions.contains_key(session_id) {
        return Err(EngineError::new("serial_missing", "串口会话不存在"));
    }
    Ok(())
}

/// 关闭串口会话。
pub async fn stop_serial_session(state: &SerialState, session_id: &str) -> Result<(), EngineError> {
    let tx = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| EngineError::new("serial_lock_failed", "无法访问串口会话状态"))?;
        sessions
            .remove(session_id)
            .ok_or_else(|| EngineError::new("serial_missing", "串口会话不存在"))?
            .tx
    };
    let (respond_to, rx) = oneshot::channel();
    tx.send(SerialCommand::Disconnect { respond_to })
        .map_err(|_| EngineError::new("serial_missing", "串口会话不存在"))?;
    rx.await
        .map_err(|_| EngineError::new("serial_disconnect_failed", "无法关闭串口会话"))?
}

async fn send_serial_command(
    state: &SerialState,
    session_id: &str,
    command: SerialCommand,
) -> Result<(), EngineError> {
    let tx = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| EngineError::new("serial_lock_failed", "无法访问串口会话状态"))?;
        sessions
            .get(session_id)
            .ok_or_else(|| EngineError::new("serial_missing", "串口会话不存在"))?
            .tx
            .clone()
    };

    match command {
        SerialCommand::Write { data, echo, .. } => {
            let (respond_to, rx) = oneshot::channel();
            tx.send(SerialCommand::Write {
                data,
                echo,
                respond_to,
            })
            .map_err(|_| EngineError::new("serial_missing", "串口会话不存在"))?;
            rx.await
                .map_err(|_| EngineError::new("serial_write_failed", "串口写入命令已中断"))?
        }
        SerialCommand::Disconnect { .. } => unreachable!(),
    }
}

fn open_serial_stream(profile: &SerialProfile) -> Result<SerialStream, EngineError> {
    let path = profile.port_path.trim();
    if path.is_empty() {
        return Err(EngineError::new("serial_port_required", "串口路径不能为空"));
    }
    let baud_rate = normalize_baud_rate(profile.baud_rate)?;
    tokio_serial::new(path, baud_rate)
        .data_bits(map_data_bits(profile.data_bits.unwrap_or_default()))
        .stop_bits(map_stop_bits(profile.stop_bits.unwrap_or_default()))
        .parity(map_parity(profile.parity.unwrap_or_default()))
        .flow_control(map_flow_control(profile.flow_control.unwrap_or_default()))
        .open_native_async()
        .map_err(|err| {
            EngineError::with_detail("serial_connect_failed", "无法打开串口设备", err.to_string())
        })
}

fn normalize_baud_rate(value: u32) -> Result<u32, EngineError> {
    if value == 0 {
        return Err(EngineError::new(
            "serial_baud_rate_invalid",
            "波特率必须大于 0",
        ));
    }
    Ok(value)
}

fn map_serial_port_info(info: SerialPortInfo) -> SerialPortDescriptor {
    match info.port_type {
        tokio_serial::SerialPortType::UsbPort(usb) => SerialPortDescriptor {
            path: info.port_name.clone(),
            port_name: info.port_name,
            port_type: "usb".to_string(),
            manufacturer: usb.manufacturer,
            product: usb.product,
            serial_number: usb.serial_number,
        },
        tokio_serial::SerialPortType::PciPort => SerialPortDescriptor {
            path: info.port_name.clone(),
            port_name: info.port_name,
            port_type: "pci".to_string(),
            manufacturer: None,
            product: None,
            serial_number: None,
        },
        tokio_serial::SerialPortType::BluetoothPort => SerialPortDescriptor {
            path: info.port_name.clone(),
            port_name: info.port_name,
            port_type: "bluetooth".to_string(),
            manufacturer: None,
            product: None,
            serial_number: None,
        },
        tokio_serial::SerialPortType::Unknown => SerialPortDescriptor {
            path: info.port_name.clone(),
            port_name: info.port_name,
            port_type: "unknown".to_string(),
            manufacturer: None,
            product: None,
            serial_number: None,
        },
    }
}

fn map_data_bits(value: SerialDataBits) -> DataBits {
    match value {
        SerialDataBits::Five => DataBits::Five,
        SerialDataBits::Six => DataBits::Six,
        SerialDataBits::Seven => DataBits::Seven,
        SerialDataBits::Eight => DataBits::Eight,
    }
}

fn map_stop_bits(value: SerialStopBits) -> StopBits {
    match value {
        SerialStopBits::One => StopBits::One,
        SerialStopBits::Two => StopBits::Two,
    }
}

fn map_parity(value: SerialParity) -> Parity {
    match value {
        SerialParity::None => Parity::None,
        SerialParity::Odd => Parity::Odd,
        SerialParity::Even => Parity::Even,
    }
}

fn map_flow_control(value: SerialFlowControl) -> FlowControl {
    match value {
        SerialFlowControl::None => FlowControl::None,
        SerialFlowControl::Software => FlowControl::Software,
        SerialFlowControl::Hardware => FlowControl::Hardware,
    }
}

fn normalize_charset(value: Option<&str>) -> &'static str {
    match value
        .unwrap_or("utf-8")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "gbk" => "gbk",
        "gb18030" => "gb18030",
        _ => "utf-8",
    }
}

fn decode_serial_bytes(bytes: &[u8], charset: &str) -> String {
    match charset {
        "gbk" | "gb18030" => bytes.iter().map(|byte| *byte as char).collect(),
        _ => String::from_utf8_lossy(bytes).to_string(),
    }
}

fn apply_line_ending(data: &str, line_ending: Option<SerialLineEnding>) -> String {
    match line_ending.unwrap_or_default() {
        SerialLineEnding::None => data.to_string(),
        SerialLineEnding::Lf => data.replace('\r', ""),
        SerialLineEnding::Cr => data.replace("\r\n", "\r").replace('\n', "\r"),
        SerialLineEnding::CrLf => data
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\n', "\r\n"),
    }
}
