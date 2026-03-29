//! # IronRDP Runtime
//!
//! `ironrdp_runtime` 模块实现了基于 `IronRDP` 协议栈的真实 RDP 会话逻辑。
//!
//! 它负责：
//! 1. 建立 TCP 和 TLS 连接。
//! 2. 执行 RDP 激活序列。
//! 3. 运行事件循环，处理网络数据包、解码图像帧并转发用户输入。
//! 4. 将解码后的 RGBA 画面通过 WebSocket 桥接推送到前端。

use axum::extract::ws::Message;
use base64::Engine as _;
use hostname::get as get_hostname;
use ironrdp::connector::connection_activation::{
    ConnectionActivationSequence, ConnectionActivationState,
};
use ironrdp::connector::credssp::KerberosConfig;
use ironrdp::connector::{self, ConnectionResult, Credentials, Sequence};
use ironrdp::displaycontrol::client::DisplayControlClient;
use ironrdp::displaycontrol::pdu::MonitorLayoutEntry;
use ironrdp::dvc::DrdynvcClient;
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::input::{
    Database as InputDatabase, MouseButton, MousePosition, Operation, WheelRotations,
};
use ironrdp::pdu::geometry::{InclusiveRectangle, Rectangle as _};
use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp::pdu::rdp::client_info::{PerformanceFlags, TimezoneInfo};
use ironrdp::pdu::rdp::multitransport::MultitransportResponsePdu;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::{ActiveStage, ActiveStageOutput};
use ironrdp_tls::extract_tls_server_public_key;
use ironrdp_tokio::reqwest::ReqwestNetworkClient;
use ironrdp_tokio::{FramedWrite, TokioFramed, split_tokio_framed};
use tokio::net::TcpStream;
use tokio::sync::{broadcast, mpsc};
use tracing::{error, info, warn};

use crate::keyboard::code_to_scancode;
use crate::protocol::{RuntimeConnectRequest, RuntimeInputEvent, RuntimePerformanceFlags};
use crate::session_manager::SessionManager;
use crate::session_manager::{
    RuntimeCommand, build_rgba_frame_batch_message, build_rgba_frame_message, json_message,
};

/// 启动并运行单个 RDP 会话的主异步任务。
///
/// 该函数会持续运行直到会话断开或发生错误。
///
/// # 参数
///
/// * `sender` - 用于向桥接客户端广播画面帧和状态消息的频道。
/// * `session_id` - 会话的唯一标识符。
/// * `profile` - 连接配置参数（主机、凭据等）。
/// * `command_rx` - 接收来自前端控制命令（如输入、调整分辨率）的频道。
pub async fn run_ironrdp_session(
    sessions: SessionManager,
    sender: broadcast::Sender<Message>,
    session_id: String,
    profile: RuntimeConnectRequest,
    mut command_rx: mpsc::UnboundedReceiver<RuntimeCommand>,
) {
    info!(
        event = "rdp.runtime.start",
        session_id = %session_id,
        host = %profile.host,
        port = profile.port,
        username = %profile.username,
        "runtime start"
    );
    let result = connect_and_run(&sessions, &sender, &session_id, &profile, &mut command_rx).await;
    match result {
        Ok(()) => {
            info!(event = "rdp.runtime.closed", session_id = %session_id, "runtime closed");
            let _ = sessions.publish_runtime_state(
                &session_id,
                "disconnected",
                format!("session {session_id} closed"),
            );
        }
        Err(error) => {
            error!(
                event = "rdp.runtime.failed",
                session_id = %session_id,
                error = %error,
                "runtime error"
            );
            let _ = sender.send(json_message(
                "error",
                serde_json::json!({
                    "code": "rdp_runtime_error",
                    "message": error,
                }),
            ));
            let _ = sessions.publish_runtime_state(&session_id, "error", "RDP runtime failed");
        }
    }
}

/// 执行 RDP 建立连接的全过程。
///
/// 包括：
/// 1. 建立 TCP 连接并设置参数。
/// 2. 进行 RDP 握手并升级到 TLS。
/// 3. 提取服务器公钥并执行 CredSSP/Kerberos 认证。
/// 4. 完成激活序列并进入活动阶段。
async fn connect_and_run(
    sessions: &SessionManager,
    sender: &broadcast::Sender<Message>,
    session_id: &str,
    profile: &RuntimeConnectRequest,
    command_rx: &mut mpsc::UnboundedReceiver<RuntimeCommand>,
) -> Result<(), String> {
    let prepared_connection = PreparedConnection::from_request(profile)?;
    let socket = TcpStream::connect((prepared_connection.host.as_str(), prepared_connection.port))
        .await
        .map_err(|error| format!("tcp connect failed: {error}"))?;
    info!(
        event = "rdp.runtime.tcp.connected",
        session_id = %session_id,
        host = %prepared_connection.host,
        port = prepared_connection.port,
        username = %prepared_connection.username,
        domain = prepared_connection.domain.as_deref().unwrap_or(""),
        server_name = %prepared_connection.server_name,
        client_hostname = prepared_connection.client_hostname.as_deref().unwrap_or(""),
        "tcp connected"
    );
    socket
        .set_nodelay(true)
        .map_err(|error| format!("set TCP_NODELAY failed: {error}"))?;
    let client_addr = socket
        .local_addr()
        .map_err(|error| format!("get local addr failed: {error}"))?;

    let mut framed = TokioFramed::new(socket);
    let drdynvc =
        DrdynvcClient::new().with_dynamic_channel(DisplayControlClient::new(|_| Ok(Vec::new())));
    let mut connector =
        connector::ClientConnector::new(build_connector_config(&prepared_connection), client_addr)
            .with_static_channel(drdynvc);

    let should_upgrade = ironrdp_tokio::connect_begin(&mut framed, &mut connector)
        .await
        .map_err(|error| format!("connect_begin failed: {error}"))?;

    let (initial_stream, leftover_bytes) = framed.into_inner();
    let (upgraded_stream, tls_cert) =
        ironrdp_tls::upgrade(initial_stream, &prepared_connection.host)
            .await
            .map_err(|error| format!("tls upgrade failed: {error}"))?;
    info!(
        event = "rdp.runtime.tls.upgraded",
        session_id = %session_id,
        host = %prepared_connection.host,
        "tls upgraded"
    );

    if !prepared_connection.ignore_certificate {
        warn!(
            event = "rdp.runtime.certificate.interactive_unsupported",
            session_id = %session_id,
            "interactive certificate validation is not implemented yet"
        );
        let _ = sessions.publish_runtime_state(
            session_id,
            "connecting",
            "certificate validation is not interactive yet; continuing with runtime",
        );
    }

    let server_public_key = extract_tls_server_public_key(&tls_cert)
        .ok_or_else(|| "unable to extract tls server public key".to_string())?
        .to_vec();

    let upgraded = ironrdp_tokio::mark_as_upgraded(should_upgrade, &mut connector);
    let mut upgraded_framed = TokioFramed::new_with_leftover(upgraded_stream, leftover_bytes);
    let connection_result = ironrdp_tokio::connect_finalize(
        upgraded,
        connector,
        &mut upgraded_framed,
        &mut ReqwestNetworkClient::new(),
        connector::ServerName::from(prepared_connection.server_name.as_str()),
        server_public_key,
        prepared_connection.kerberos_config.clone(),
    )
    .await
    .map_err(|error| {
        format!(
            "connect_finalize failed for principal {} on {}:{}: {error:?}",
            prepared_connection.principal(),
            prepared_connection.host,
            prepared_connection.port,
        )
    })?;

    let _ = sessions.publish_runtime_state(
        session_id,
        "connected",
        format!(
            "Connected to {}:{}",
            prepared_connection.host, prepared_connection.port
        ),
    );
    info!(
        event = "rdp.runtime.connected",
        session_id = %session_id,
        host = %prepared_connection.host,
        port = prepared_connection.port,
        width = connection_result.desktop_size.width,
        height = connection_result.desktop_size.height,
        "rdp activated"
    );

    run_active_stage(
        sessions,
        sender,
        session_id,
        command_rx,
        upgraded_framed,
        connection_result,
    )
    .await
}

/// 运行 RDP 活动阶段的主事件循环。
///
/// 负责：
/// 1. 并行监听网络数据包和本地控制命令。
/// 2. 解码图像数据并将其存储在 `image` 缓冲区中。
/// 3. 将图像更新打包并通过 WebSocket 发送给前端。
/// 4. 监听前端输入并将其转发给 RDP 服务器。
/// 5. 处理动态调整窗口大小和会话重连/去激活序列。
async fn run_active_stage<S>(
    sessions: &SessionManager,
    sender: &broadcast::Sender<Message>,
    session_id: &str,
    command_rx: &mut mpsc::UnboundedReceiver<RuntimeCommand>,
    framed: TokioFramed<S>,
    connection_result: ConnectionResult,
) -> Result<(), String>
where
    S: Send + Sync + Unpin + tokio::io::AsyncRead + tokio::io::AsyncWrite,
{
    let (mut reader, mut writer) = split_tokio_framed(framed);
    let user_channel_id = connection_result.user_channel_id;
    let io_channel_id = connection_result.io_channel_id;
    let mut image = DecodedImage::new(
        PixelFormat::RgbA32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );
    let mut active_stage = ActiveStage::new(connection_result);
    let mut input_db = InputDatabase::new();
    let mut logged_first_frame = false;

    loop {
        let outputs = tokio::select! {
            frame = reader.read_pdu() => {
                let (action, payload) = frame.map_err(|error| format!("read_pdu failed: {error}"))?;
                active_stage
                    .process(&mut image, action, &payload)
                    .map_err(|error| format!("active stage process failed: {error}"))?
            }
            command = command_rx.recv() => {
                let Some(command) = command else {
                    return Ok(());
                };
                match command {
                    RuntimeCommand::Input(input) => {
                        let events = translate_input_event(&mut input_db, input);
                        if events.is_empty() {
                            Vec::new()
                        } else {
                            active_stage
                                .process_fastpath_input(&mut image, &events)
                                .map_err(|error| format!("fastpath input failed: {error}"))?
                        }
                    }
                    RuntimeCommand::Resize { width, height } => {
                        let (width, height) = MonitorLayoutEntry::adjust_display_size(width.max(320), height.max(200));
                        info!(
                            event = "rdp.runtime.resize.encoded",
                            session_id = %session_id,
                            width,
                            height,
                            "encode resize"
                        );
                        if let Some(response_frame) = active_stage.encode_resize(width, height, Some(100), None) {
                            vec![ActiveStageOutput::ResponseFrame(
                                response_frame.map_err(|error| format!("encode resize failed: {error}"))?,
                            )]
                        } else {
                            Vec::new()
                        }
                    }
                    RuntimeCommand::Clipboard(text) => {
                        let _ = sender.send(json_message(
                            "clipboard",
                            serde_json::json!({
                                "direction": "local-to-remote",
                                "text": text,
                                "supported": false,
                            }),
                        ));
                        Vec::new()
                    }
                    RuntimeCommand::Disconnect => {
                        info!(
                            event = "rdp.runtime.disconnect.requested",
                            session_id = %session_id,
                            "runtime disconnect requested"
                        );
                        for output in active_stage
                            .graceful_shutdown()
                            .map_err(|error| format!("graceful shutdown failed: {error}"))?
                        {
                            if let ActiveStageOutput::ResponseFrame(frame) = output {
                                writer
                                    .write_all(&frame)
                                    .await
                                    .map_err(|error| format!("write shutdown frame failed: {error}"))?;
                            }
                        }
                        return Ok(());
                    }
                    RuntimeCommand::CertificateDecision => Vec::new(),
                }
            }
        };

        let mut graphics_rects = Vec::new();
        for output in outputs {
            match output {
                ActiveStageOutput::ResponseFrame(frame) => writer
                    .write_all(&frame)
                    .await
                    .map_err(|error| format!("write response failed: {error}"))?,
                ActiveStageOutput::GraphicsUpdate(_) => {
                    if !logged_first_frame {
                        logged_first_frame = true;
                        info!(
                            event = "rdp.runtime.first_frame",
                            session_id = %session_id,
                            width = u32::from(image.width()),
                            height = u32::from(image.height()),
                            "first graphics frame"
                        );
                    }
                    graphics_rects.push(extract_update_rect(&output));
                }
                ActiveStageOutput::PointerDefault => {
                    let _ = sender.send(json_message(
                        "cursor",
                        serde_json::json!({ "cursor": "default" }),
                    ));
                }
                ActiveStageOutput::PointerHidden => {
                    let _ = sender.send(json_message(
                        "cursor",
                        serde_json::json!({ "cursor": "none" }),
                    ));
                }
                ActiveStageOutput::PointerPosition { x, y } => {
                    let _ = sender.send(json_message(
                        "cursor",
                        serde_json::json!({
                            "cursor": "default",
                            "x": x,
                            "y": y,
                        }),
                    ));
                }
                ActiveStageOutput::PointerBitmap(pointer) => {
                    let cursor = pointer_bitmap_to_css_cursor(&pointer);
                    let _ = sender.send(json_message(
                        "cursor",
                        serde_json::json!({ "cursor": cursor }),
                    ));
                }
                ActiveStageOutput::DeactivateAll(sequence) => {
                    let Some((width, height)) =
                        complete_deactivation_reactivation(&mut reader, &mut writer, sequence)
                            .await?
                    else {
                        return Err("deactivation-reactivation did not finalize".to_string());
                    };
                    info!(
                        event = "rdp.runtime.reactivated",
                        session_id = %session_id,
                        width,
                        height,
                        "rdp reactivated"
                    );
                    image = DecodedImage::new(PixelFormat::RgbA32, width, height);
                    logged_first_frame = false;
                }
                ActiveStageOutput::MultitransportRequest(pdu) => {
                    // 上游 IronRDP 当前仍未提供可直接复用的客户端 UDP multitransport
                    // 完整实现。这里先按协议显式回 E_ABORT，避免静默忽略导致服务端
                    // 长时间等待；后续待上游实现成熟后再切换为真正的 sideband UDP。
                    warn!(
                        event = "rdp.runtime.multitransport.declined",
                        session_id = %session_id,
                        request_id = pdu.request_id,
                        requested_protocol = ?pdu.requested_protocol,
                        "multitransport request received; responding with E_ABORT because UDP transport is not implemented"
                    );
                    let response = encode_multitransport_abort_response(
                        user_channel_id,
                        io_channel_id,
                        pdu.request_id,
                    )?;
                    writer.write_all(&response).await.map_err(|error| {
                        format!("write multitransport abort response failed: {error}")
                    })?;
                    let _ = sessions.publish_runtime_state(
                        session_id,
                        "connected",
                        "Server requested RDP multitransport, but UDP sideband is not implemented; declined request.",
                    );
                }
                ActiveStageOutput::Terminate(_) => return Ok(()),
            }
        }

        let merged_rects = merge_update_rects(graphics_rects);
        if merged_rects.len() == 1 {
            let rect = &merged_rects[0];
            let _ = sender.send(build_rgba_frame_message(
                u32::from(rect.left),
                u32::from(rect.top),
                u32::from(rect.width()),
                u32::from(rect.height()),
                u32::from(image.width()),
                u32::from(image.height()),
                |dest| copy_rect_to_vec(&image, rect, dest),
            ));
        } else if !merged_rects.is_empty() {
            let rects_info = merged_rects
                .iter()
                .map(|rect| {
                    (
                        u32::from(rect.left),
                        u32::from(rect.top),
                        u32::from(rect.width()),
                        u32::from(rect.height()),
                    )
                })
                .collect::<Vec<_>>();

            let _ = sender.send(build_rgba_frame_batch_message(
                u32::from(image.width()),
                u32::from(image.height()),
                &rects_info,
                |i, dest| copy_rect_to_vec(&image, &merged_rects[i], dest),
            ));
        }
    }
}

/// 完整处理 RDP 去激活-重激活序列。
///
/// 当 RDP 服务器需要重置桌面环境（例如更改分辨率或发生严重网络波动）时调用。
/// 此函数会阻塞当前会话循环，直到重新建立完整的激活上下文。
async fn complete_deactivation_reactivation<S>(
    reader: &mut TokioFramed<tokio::io::ReadHalf<S>>,
    writer: &mut TokioFramed<tokio::io::WriteHalf<S>>,
    mut sequence: Box<ConnectionActivationSequence>,
) -> Result<Option<(u16, u16)>, String>
where
    S: Send + Sync + Unpin + tokio::io::AsyncRead + tokio::io::AsyncWrite,
{
    let mut buffer = ironrdp::core::WriteBuf::new();
    loop {
        match sequence.connection_activation_state() {
            ConnectionActivationState::Finalized { desktop_size, .. } => {
                return Ok(Some((desktop_size.width, desktop_size.height)));
            }
            ConnectionActivationState::Consumed => {
                return Ok(None);
            }
            _ => {}
        }

        buffer.clear();
        let written = if let Some(next_pdu_hint) = sequence.next_pdu_hint() {
            let pdu = reader
                .read_by_hint(next_pdu_hint)
                .await
                .map_err(|error| format!("read reactivation pdu failed: {error}"))?;
            sequence
                .step(&pdu, &mut buffer)
                .map_err(|error| format!("reactivation step failed: {error}"))?
        } else {
            sequence
                .step_no_input(&mut buffer)
                .map_err(|error| format!("reactivation step without input failed: {error}"))?
        };

        if written.size().is_some() {
            writer
                .write_all(buffer.filled())
                .await
                .map_err(|error| format!("write reactivation response failed: {error}"))?;
        }
    }
}

/// 从活动阶段的输出中提取更新矩形范围。
fn extract_update_rect(output: &ActiveStageOutput) -> InclusiveRectangle {
    match output {
        ActiveStageOutput::GraphicsUpdate(rect) => rect.clone(),
        _ => InclusiveRectangle::empty(),
    }
}

/// 将脏矩形范围内的像素直接拷贝到目标 Vec 中（无中间分配）。
fn copy_rect_to_vec(
    image: &ironrdp::session::image::DecodedImage,
    rect: &InclusiveRectangle,
    dest: &mut Vec<u8>,
) {
    let bytes_per_pixel = image.bytes_per_pixel();
    let rect_width = usize::from(rect.width());
    let rect_height = usize::from(rect.height());
    let stride = image.stride();
    let row_bytes = rect_width * bytes_per_pixel;
    let data = image.data();

    for row in 0..rect_height {
        let start =
            (usize::from(rect.top) + row) * stride + usize::from(rect.left) * bytes_per_pixel;
        let end = start + row_bytes;
        dest.extend_from_slice(&data[start..end]);
    }
}

/// 合并相交或相邻的脏矩形，减少高频拖动时的小块绘制数量。
fn merge_update_rects(rects: Vec<InclusiveRectangle>) -> Vec<InclusiveRectangle> {
    let mut pending = rects
        .into_iter()
        .filter(|rect| rect.width() > 0 && rect.height() > 0)
        .collect::<Vec<_>>();
    if pending.len() < 2 {
        return pending;
    }

    let mut merged = Vec::with_capacity(pending.len());
    while let Some(mut current) = pending.pop() {
        let mut index = 0;
        while index < pending.len() {
            if rects_touch_or_overlap(&current, &pending[index]) {
                current = union_rect(&current, &pending[index]);
                pending.swap_remove(index);
                index = 0;
            } else {
                index += 1;
            }
        }
        merged.push(current);
    }
    merged
}

/// 判断两个脏矩形是否相交或边缘相邻。
fn rects_touch_or_overlap(left: &InclusiveRectangle, right: &InclusiveRectangle) -> bool {
    let left_left = i32::from(left.left);
    let left_top = i32::from(left.top);
    let left_right = i32::from(left.right);
    let left_bottom = i32::from(left.bottom);
    let right_left = i32::from(right.left);
    let right_top = i32::from(right.top);
    let right_right = i32::from(right.right);
    let right_bottom = i32::from(right.bottom);

    left_left <= right_right + 1
        && left_right + 1 >= right_left
        && left_top <= right_bottom + 1
        && left_bottom + 1 >= right_top
}

/// 计算两个脏矩形的并集。
fn union_rect(left: &InclusiveRectangle, right: &InclusiveRectangle) -> InclusiveRectangle {
    InclusiveRectangle {
        left: left.left.min(right.left),
        top: left.top.min(right.top),
        right: left.right.max(right.right),
        bottom: left.bottom.max(right.bottom),
    }
}

/// 构造用于 IronRDP 建立连接的初始化配置。
///
/// 该配置定义了客户端名称、平台类型、桌面大小以及性能标志等关键参数。
fn build_connector_config(connection: &PreparedConnection) -> connector::Config {
    connector::Config {
        credentials: Credentials::UsernamePassword {
            username: connection.username.clone(),
            password: connection.password.clone(),
        },
        domain: connection.domain.clone(),
        enable_tls: true,
        enable_credssp: true,
        keyboard_type: ironrdp::pdu::gcc::KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: "FluxTerm-RDP".to_string(),
        desktop_size: connector::DesktopSize {
            width: u16::try_from(connection.width.clamp(320, 4096)).unwrap_or(1280),
            height: u16::try_from(connection.height.clamp(200, 4096)).unwrap_or(720),
        },
        desktop_scale_factor: 100,
        bitmap: None,
        client_build: 1000,
        client_name: "fluxterm-rdp-runtime".to_string(),
        client_dir: "C:\\Windows\\System32\\mstscax.dll".to_string(),
        alternate_shell: String::new(),
        work_dir: String::new(),
        platform: detect_platform(),
        hardware_id: None,
        enable_server_pointer: true,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        pointer_software_rendering: false,
        // 体验标志由前端 Profile 驱动，这里只做协议位映射。
        performance_flags: build_performance_flags(&connection.performance_flags),
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
        compression_type: None,
        multitransport_flags: None,
    }
}

/// 将产品层的远端体验配置映射为 RDP 协议性能标志。
fn build_performance_flags(config: &RuntimePerformanceFlags) -> PerformanceFlags {
    let mut flags = PerformanceFlags::empty();
    if !config.wallpaper {
        flags |= PerformanceFlags::DISABLE_WALLPAPER;
    }
    if !config.full_window_drag {
        flags |= PerformanceFlags::DISABLE_FULLWINDOWDRAG;
    }
    if !config.menu_animations {
        flags |= PerformanceFlags::DISABLE_MENUANIMATIONS;
    }
    if !config.theming {
        flags |= PerformanceFlags::DISABLE_THEMING;
    }
    if !config.cursor_shadow {
        flags |= PerformanceFlags::DISABLE_CURSOR_SHADOW;
    }
    if !config.cursor_settings {
        flags |= PerformanceFlags::DISABLE_CURSORSETTINGS;
    }
    if config.font_smoothing {
        flags |= PerformanceFlags::ENABLE_FONT_SMOOTHING;
    }
    if config.desktop_composition {
        flags |= PerformanceFlags::ENABLE_DESKTOP_COMPOSITION;
    }
    flags
}

/// 运行前收敛的连接参数。
#[derive(Debug, Clone)]
struct PreparedConnection {
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    ignore_certificate: bool,
    width: u32,
    height: u32,
    performance_flags: RuntimePerformanceFlags,
    server_name: String,
    client_hostname: Option<String>,
    kerberos_config: Option<KerberosConfig>,
}

impl PreparedConnection {
    /// 从前端连接请求构造干净的认证与连接参数。
    fn from_request(request: &RuntimeConnectRequest) -> Result<Self, String> {
        let host = normalize_required_string(request.host.clone(), "host")?;
        let port = request.port;
        let password = request.password.clone();
        let width = request.width;
        let height = request.height;
        let ignore_certificate = request.ignore_certificate;
        let explicit_domain = normalize_optional_string(request.domain.clone());
        let (username, domain) = normalize_credentials(request.username.clone(), explicit_domain)?;
        let client_hostname = resolve_client_hostname();
        let kerberos_config = client_hostname.clone().map(|hostname| KerberosConfig {
            kdc_proxy_url: None,
            hostname: Some(hostname),
        });

        Ok(Self {
            server_name: derive_server_name(&host),
            host,
            port,
            username,
            password,
            domain,
            ignore_certificate,
            width,
            height,
            performance_flags: request.performance_flags.clone(),
            client_hostname,
            kerberos_config,
        })
    }

    /// 用于日志的认证主体描述。
    fn principal(&self) -> String {
        self.domain
            .as_deref()
            .filter(|domain| !domain.is_empty())
            .map(|domain| format!("{domain}\\{}", self.username))
            .unwrap_or_else(|| self.username.clone())
    }
}

/// 根据编译时的目标操作系统探测 RDP 协议所需的平台类型。
fn detect_platform() -> MajorPlatformType {
    if cfg!(target_os = "windows") {
        MajorPlatformType::WINDOWS
    } else if cfg!(target_os = "macos") {
        MajorPlatformType::MACINTOSH
    } else if cfg!(target_os = "linux") {
        MajorPlatformType::UNIX
    } else {
        MajorPlatformType::UNSPECIFIED
    }
}

/// 规范化可选字符串，去除两端空白并将空字符串处理为 `None`。
fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

/// 规范化必填字符串，避免认证链路吞掉前后空白和空值。
fn normalize_required_string(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(trimmed)
    }
}

/// 统一解析用户名与域，避免调用点散落处理 `domain\\user`、空域和值污染。
fn normalize_credentials(
    username: String,
    explicit_domain: Option<String>,
) -> Result<(String, Option<String>), String> {
    let username = normalize_required_string(username, "username")?;
    let mut domain = explicit_domain;

    if let Some((embedded_domain, embedded_username)) = split_domain_qualified_username(&username) {
        if domain.is_none() {
            domain = Some(embedded_domain);
        }
        return Ok((embedded_username, domain));
    }

    Ok((username, domain))
}

/// 解析 `DOMAIN\\user` 风格的用户名。
fn split_domain_qualified_username(value: &str) -> Option<(String, String)> {
    let (domain, username) = value.split_once('\\')?;
    let domain = domain.trim();
    let username = username.trim();
    if domain.is_empty() || username.is_empty() {
        None
    } else {
        Some((domain.to_string(), username.to_string()))
    }
}

/// 为 CredSSP 构造目标服务器名。
fn derive_server_name(host: &str) -> String {
    host.trim().trim_matches('.').to_string()
}

/// 读取本机主机名，作为 Kerberos/NTLM 客户端标识。
fn resolve_client_hostname() -> Option<String> {
    get_hostname().ok().and_then(|value| {
        let trimmed = value.to_string_lossy().trim().trim_matches('.').to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

/// 将前端传来的通用输入事件负载转换为 IronRDP 可识别的 FastPath 输入事件列表。
///
/// 负责处理：
/// 1. 鼠标坐标转换与按键状态映射。
/// 2. 滚轮增量转换。
/// 3. 键盘扫描码映射与 Unicode 字符输入。
///
/// 键盘路径约束：
/// 1. 可打印单字符且未按下 Ctrl / Alt / Meta 时优先走 Unicode。
/// 2. 其他键统一尝试走 `KeyboardEvent.code -> scancode` 映射。
/// 3. 前端需要保证 `key_down` / `key_up` 成对发送，并在失焦时补发释放事件。
fn translate_input_event(
    database: &mut InputDatabase,
    input: RuntimeInputEvent,
) -> Vec<FastPathInputEvent> {
    let mut operations = Vec::new();
    match input.kind.as_str() {
        "mouse_move" => {
            operations.push(Operation::MouseMove(MousePosition {
                x: clamp_coordinate(input.x.unwrap_or(0.0)),
                y: clamp_coordinate(input.y.unwrap_or(0.0)),
            }));
        }
        "mouse_down" => {
            operations.push(Operation::MouseMove(MousePosition {
                x: clamp_coordinate(input.x.unwrap_or(0.0)),
                y: clamp_coordinate(input.y.unwrap_or(0.0)),
            }));
            if let Some(button) = input.button.and_then(MouseButton::from_web_button) {
                operations.push(Operation::MouseButtonPressed(button));
            }
        }
        "mouse_up" => {
            operations.push(Operation::MouseMove(MousePosition {
                x: clamp_coordinate(input.x.unwrap_or(0.0)),
                y: clamp_coordinate(input.y.unwrap_or(0.0)),
            }));
            if let Some(button) = input.button.and_then(MouseButton::from_web_button) {
                operations.push(Operation::MouseButtonReleased(button));
            }
        }
        "wheel" => {
            operations.push(Operation::MouseMove(MousePosition {
                x: clamp_coordinate(input.x.unwrap_or(0.0)),
                y: clamp_coordinate(input.y.unwrap_or(0.0)),
            }));
            let delta = -input.delta_y.unwrap_or(0.0);
            if delta != 0.0 {
                operations.push(Operation::WheelRotations(WheelRotations {
                    is_vertical: true,
                    rotation_units: delta.round().clamp(-240.0, 240.0) as i16,
                }));
            }
        }
        "key_down" => {
            if let Some(character) = extract_unicode_char(&input) {
                operations.push(Operation::UnicodeKeyPressed(character));
            } else if let Some(scancode) = input.code.as_deref().and_then(code_to_scancode) {
                operations.push(Operation::KeyPressed(scancode));
            }
        }
        "key_up" => {
            if let Some(character) = extract_unicode_char(&input) {
                operations.push(Operation::UnicodeKeyReleased(character));
            } else if let Some(scancode) = input.code.as_deref().and_then(code_to_scancode) {
                operations.push(Operation::KeyReleased(scancode));
            }
        }
        _ => {}
    }
    database.apply(operations).into_vec()
}

/// 尝试从输入负载中提取有效的 Unicode 字符。
///
/// 只有“未按下 Ctrl / Alt / Meta 的单个可打印字符”才会走这条路径；
/// 其余情况一律回退到扫描码映射，保证控制键、导航键和组合键保持物理键位语义。
fn extract_unicode_char(input: &RuntimeInputEvent) -> Option<char> {
    if input.ctrl_key.unwrap_or(false)
        || input.alt_key.unwrap_or(false)
        || input.meta_key.unwrap_or(false)
    {
        return None;
    }
    let value = input.text.as_deref()?.trim();
    let mut chars = value.chars();
    let character = chars.next()?;
    if chars.next().is_some() || character.is_control() {
        return None;
    }
    Some(character)
}

/// 将浮点数坐标限制在 RDP 协议支持的 u16 范围内。
fn clamp_coordinate(value: f64) -> u16 {
    value.round().clamp(0.0, f64::from(u16::MAX)) as u16
}

/// 对服务器发起的 multitransport 请求回送 `E_ABORT`，显式声明当前客户端不支持 UDP sideband。
///
/// 这里是临时降级路径：当前依赖的 IronRDP 分支仍处于积极开发中，尚未提供
/// 可直接接入的客户端 multitransport 实现。待上游补齐后，应优先改为真正建立
/// UDP sideband 并回送 success，而不是长期保留 abort。
fn encode_multitransport_abort_response(
    user_channel_id: u16,
    io_channel_id: u16,
    request_id: u32,
) -> Result<Vec<u8>, String> {
    let mut buffer = ironrdp::core::WriteBuf::new();
    ironrdp::connector::encode_send_data_request(
        user_channel_id,
        io_channel_id,
        &MultitransportResponsePdu::abort(request_id),
        &mut buffer,
    )
    .map_err(|error| format!("encode multitransport abort response failed: {error}"))?;
    Ok(buffer.into_inner())
}

/// 将远端指针位图编码为浏览器可用的 CSS cursor 字符串。
///
/// 优先返回内联 PNG data URL，以保留远端真实光标形状与热点信息；
/// 如果编码失败，则回退到 `default`，避免前端拿到无效 cursor 值。
fn pointer_bitmap_to_css_cursor(pointer: &ironrdp::graphics::pointer::DecodedPointer) -> String {
    if pointer.width == 0 || pointer.height == 0 {
        return "none".to_string();
    }

    let expected_len = usize::from(pointer.width) * usize::from(pointer.height) * 4;
    if pointer.bitmap_data.len() != expected_len {
        return "default".to_string();
    }

    match encode_pointer_bitmap_png(pointer) {
        Ok(png_bytes) => {
            let encoded = base64::engine::general_purpose::STANDARD.encode(png_bytes);
            format!(
                "url(\"data:image/png;base64,{encoded}\") {} {}, default",
                pointer.hotspot_x, pointer.hotspot_y
            )
        }
        Err(_) => "default".to_string(),
    }
}

/// 将 IronRDP 解码后的 RGBA 指针位图封装为 PNG。
fn encode_pointer_bitmap_png(
    pointer: &ironrdp::graphics::pointer::DecodedPointer,
) -> Result<Vec<u8>, png::EncodingError> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(
        &mut out,
        u32::from(pointer.width),
        u32::from(pointer.height),
    );
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header()?;
    writer.write_image_data(&pointer.bitmap_data)?;
    drop(writer);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use ironrdp::pdu::geometry::InclusiveRectangle;
    use ironrdp::pdu::rdp::client_info::PerformanceFlags;

    use super::{
        build_performance_flags, encode_multitransport_abort_response, merge_update_rects,
        normalize_credentials, pointer_bitmap_to_css_cursor, resolve_client_hostname,
    };
    use crate::protocol::RuntimePerformanceFlags;

    #[test]
    fn normalizes_domain_qualified_username() {
        let (username, domain) =
            normalize_credentials("LAB\\alice".to_string(), None).expect("normalize");
        assert_eq!(username, "alice");
        assert_eq!(domain.as_deref(), Some("LAB"));
    }

    #[test]
    fn explicit_domain_overrides_embedded_domain() {
        let (username, domain) =
            normalize_credentials("LAB\\alice".to_string(), Some("CORP".to_string()))
                .expect("normalize");
        assert_eq!(username, "alice");
        assert_eq!(domain.as_deref(), Some("CORP"));
    }

    #[test]
    fn resolves_client_hostname_if_available() {
        let _ = resolve_client_hostname();
    }

    #[test]
    fn merges_touching_update_rects() {
        let merged = merge_update_rects(vec![
            InclusiveRectangle {
                left: 0,
                top: 0,
                right: 9,
                bottom: 9,
            },
            InclusiveRectangle {
                left: 10,
                top: 0,
                right: 19,
                bottom: 9,
            },
        ]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].left, 0);
        assert_eq!(merged[0].right, 19);
    }

    #[test]
    fn keeps_separated_update_rects() {
        let merged = merge_update_rects(vec![
            InclusiveRectangle {
                left: 0,
                top: 0,
                right: 9,
                bottom: 9,
            },
            InclusiveRectangle {
                left: 12,
                top: 0,
                right: 20,
                bottom: 9,
            },
        ]);

        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn encodes_pointer_bitmap_as_css_cursor() {
        let cursor = pointer_bitmap_to_css_cursor(&ironrdp::graphics::pointer::DecodedPointer {
            width: 2,
            height: 2,
            hotspot_x: 1,
            hotspot_y: 0,
            bitmap_data: vec![
                0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255,
            ],
        });

        assert!(cursor.starts_with("url(\"data:image/png;base64,"));
        assert!(cursor.ends_with("\") 1 0, default"));
    }

    #[test]
    fn falls_back_when_pointer_bitmap_is_invalid() {
        let cursor = pointer_bitmap_to_css_cursor(&ironrdp::graphics::pointer::DecodedPointer {
            width: 2,
            height: 2,
            hotspot_x: 0,
            hotspot_y: 0,
            bitmap_data: vec![0, 0, 0, 0],
        });

        assert_eq!(cursor, "default");
    }

    #[test]
    fn encodes_multitransport_abort_response() {
        let frame = encode_multitransport_abort_response(1001, 1003, 42).expect("encode abort");
        assert!(!frame.is_empty());
    }

    #[test]
    fn maps_fluid_profile_to_disabled_visual_flags() {
        let flags = build_performance_flags(&RuntimePerformanceFlags {
            wallpaper: false,
            full_window_drag: false,
            menu_animations: false,
            theming: false,
            cursor_shadow: false,
            cursor_settings: true,
            font_smoothing: false,
            desktop_composition: false,
        });

        assert!(flags.contains(PerformanceFlags::DISABLE_WALLPAPER));
        assert!(flags.contains(PerformanceFlags::DISABLE_FULLWINDOWDRAG));
        assert!(flags.contains(PerformanceFlags::DISABLE_MENUANIMATIONS));
        assert!(flags.contains(PerformanceFlags::DISABLE_THEMING));
        assert!(flags.contains(PerformanceFlags::DISABLE_CURSOR_SHADOW));
        assert!(!flags.contains(PerformanceFlags::DISABLE_CURSORSETTINGS));
        assert!(!flags.contains(PerformanceFlags::ENABLE_FONT_SMOOTHING));
        assert!(!flags.contains(PerformanceFlags::ENABLE_DESKTOP_COMPOSITION));
    }
}
