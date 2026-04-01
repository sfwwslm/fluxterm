//! # RDP 音频播放后端
//!
//! `audio` 模块负责在本地桌面端播放 `rdpsnd` 静态通道送来的远端音频。
//! 当前版本仅协商并播放 16-bit PCM 双声道输出，并提供会话级静音与音量控制。

use std::borrow::Cow;
use std::collections::VecDeque;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait as _, HostTrait as _, StreamTrait as _};
use cpal::{SampleFormat, Stream, StreamConfig};
use ironrdp::rdpsnd::client::RdpsndClientHandler;
use ironrdp::rdpsnd::pdu::{AudioFormat, PitchPdu, VolumePdu, WaveFormat};
use tokio::sync::mpsc as tokio_mpsc;
use tracing::{debug, error, info};

use crate::protocol::RuntimeAudioState;

static PCM_AUDIO_FORMATS: LazyLock<Vec<AudioFormat>> = LazyLock::new(|| {
    vec![
        pcm_audio_format(2, 48_000, 16),
        pcm_audio_format(2, 44_100, 16),
        pcm_audio_format(2, 22_050, 16),
        pcm_audio_format(2, 11_025, 16),
        pcm_audio_format(1, 48_000, 16),
        pcm_audio_format(1, 44_100, 16),
        pcm_audio_format(2, 44_100, 8),
        pcm_audio_format(1, 22_050, 8),
    ]
});

/// 音频后端向 RDP 主循环回传的代理事件。
#[derive(Debug, Clone)]
pub enum AudioProxyEvent {
    /// 本地播放状态发生变化。
    StateChanged {
        state: RuntimeAudioState,
        message: Option<String>,
    },
}

/// 可由外部命令驱动的会话级音频控制器。
#[derive(Debug, Clone)]
pub struct AudioPlaybackController {
    shared: Arc<AudioShared>,
}

impl AudioPlaybackController {
    /// 创建新的控制器与共享状态。
    pub fn new(proxy_tx: tokio_mpsc::UnboundedSender<AudioProxyEvent>) -> Self {
        Self {
            shared: Arc::new(AudioShared {
                muted: AtomicBool::new(false),
                volume: Mutex::new(1.0),
                diagnostics: Mutex::new(AudioDiagnostics::new()),
                proxy_tx,
            }),
        }
    }

    /// 生成供 `rdpsnd` 使用的本地播放后端。
    pub fn create_backend(&self) -> FluxRdpsndBackend {
        FluxRdpsndBackend::new(Arc::clone(&self.shared))
    }

    /// 设置当前会话是否静音。
    pub fn set_muted(&self, muted: bool) {
        self.shared.muted.store(muted, Ordering::Relaxed);
        if muted {
            self.shared.publish_state(RuntimeAudioState::Muted, None);
        }
    }

    /// 设置当前会话音量，结果会被限制在 `0.0..=1.0`。
    pub fn set_volume(&self, volume: f32) {
        let clamped = clamp_audio_volume(volume);
        if let Ok(mut current) = self.shared.volume.lock() {
            *current = clamped;
        }
    }
}

#[derive(Debug)]
struct AudioShared {
    muted: AtomicBool,
    volume: Mutex<f32>,
    diagnostics: Mutex<AudioDiagnostics>,
    proxy_tx: tokio_mpsc::UnboundedSender<AudioProxyEvent>,
}

impl AudioShared {
    const AUDIO_IDLE_TIMEOUT: Duration = Duration::from_millis(400);

    fn current_gain(&self) -> AudioGain {
        let volume = self.volume.lock().map(|value| *value).unwrap_or(1.0);
        AudioGain {
            muted: self.muted.load(Ordering::Relaxed),
            volume: clamp_audio_volume(volume),
        }
    }

    fn publish_state(&self, state: RuntimeAudioState, message: Option<String>) {
        let _ = self
            .proxy_tx
            .send(AudioProxyEvent::StateChanged { state, message });
    }

    /// 记录远端音频包进入本地缓冲后的状态。
    fn record_wave_received(&self, packet_len: usize, buffered_bytes: usize) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.record_wave(packet_len, buffered_bytes);
        }
    }

    /// 记录输出回调的消费情况。
    fn record_callback(&self, report: AudioFillReport) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.record_callback(report);
        }
    }

    /// 记录播放缓冲被吃空时的状态。
    fn record_starvation(&self, buffered_bytes: usize) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.record_starvation(buffered_bytes);
        }
    }

    /// 重置诊断窗口，避免跨音频流混叠。
    fn reset_diagnostics(&self) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.reset();
        }
    }

    /// 音频协商就绪但当前没有活动送流时，回退为 Idle/Muted。
    fn publish_ready_idle_state(&self) {
        let state = if self.muted.load(Ordering::Relaxed) {
            RuntimeAudioState::Muted
        } else {
            RuntimeAudioState::Idle
        };
        self.publish_state(state, None);
    }

    /// 判断当前缺包是否应视为远端静默，而不是播放异常。
    fn should_transition_to_idle(&self) -> bool {
        self.diagnostics
            .lock()
            .ok()
            .and_then(|diagnostics| diagnostics.since_last_wave())
            .is_some_and(|elapsed| elapsed >= Self::AUDIO_IDLE_TIMEOUT)
    }
}

#[derive(Debug, Clone, Copy)]
struct AudioGain {
    muted: bool,
    volume: f32,
}

/// 音频填充回调的一次消费结果。
#[derive(Debug, Clone, Copy)]
struct AudioFillReport {
    requested_bytes: usize,
    consumed_bytes: usize,
    buffered_after: usize,
    waiting_for_prebuffer: bool,
}

/// 聚合音频生产/消费链路的诊断指标。
#[derive(Debug)]
struct AudioDiagnostics {
    window_started_at: Instant,
    last_wave_at: Option<Instant>,
    last_callback_at: Option<Instant>,
    wave_count: u64,
    wave_bytes: u64,
    callback_count: u64,
    callback_requested_bytes: u64,
    callback_consumed_bytes: u64,
    starvation_count: u64,
    max_wave_gap: Duration,
    max_callback_gap: Duration,
}

impl AudioDiagnostics {
    const SUMMARY_INTERVAL: Duration = Duration::from_secs(2);

    /// 创建新的诊断窗口。
    fn new() -> Self {
        Self {
            window_started_at: Instant::now(),
            last_wave_at: None,
            last_callback_at: None,
            wave_count: 0,
            wave_bytes: 0,
            callback_count: 0,
            callback_requested_bytes: 0,
            callback_consumed_bytes: 0,
            starvation_count: 0,
            max_wave_gap: Duration::ZERO,
            max_callback_gap: Duration::ZERO,
        }
    }

    /// 重置统计窗口。
    fn reset(&mut self) {
        *self = Self::new();
    }

    /// 返回距最近一次音频包到达的时长。
    fn since_last_wave(&self) -> Option<Duration> {
        self.last_wave_at
            .map(|last| Instant::now().saturating_duration_since(last))
    }

    /// 记录一帧远端音频包进入本地缓冲。
    fn record_wave(&mut self, packet_len: usize, buffered_bytes: usize) {
        let now = Instant::now();
        if let Some(last) = self.last_wave_at {
            self.max_wave_gap = self.max_wave_gap.max(now.saturating_duration_since(last));
        }
        self.last_wave_at = Some(now);
        self.wave_count += 1;
        self.wave_bytes += packet_len as u64;

        self.log_summary_if_due(buffered_bytes);
    }

    /// 记录一次本地输出回调消费。
    fn record_callback(&mut self, report: AudioFillReport) {
        let now = Instant::now();
        if let Some(last) = self.last_callback_at {
            self.max_callback_gap = self
                .max_callback_gap
                .max(now.saturating_duration_since(last));
        }
        self.last_callback_at = Some(now);
        self.callback_count += 1;
        self.callback_requested_bytes += report.requested_bytes as u64;
        self.callback_consumed_bytes += report.consumed_bytes as u64;

        if report.waiting_for_prebuffer {
            self.log_summary_if_due(report.buffered_after);
            return;
        }

        self.log_summary_if_due(report.buffered_after);
    }

    /// 记录播放缓冲饥饿事件。
    fn record_starvation(&mut self, buffered_bytes: usize) {
        self.starvation_count += 1;
        error!(
            event = "rdp.audio.buffer.starved",
            starvation_count = self.starvation_count,
            buffered_bytes,
            since_last_wave_ms = self
                .last_wave_at
                .map(|last| Instant::now().saturating_duration_since(last).as_millis() as u64)
                .unwrap_or(0),
            "RDP audio playback buffer ran dry"
        );
    }

    /// 在固定时间窗输出摘要。
    fn log_summary_if_due(&mut self, buffered_bytes: usize) {
        let now = Instant::now();
        let elapsed = now.saturating_duration_since(self.window_started_at);
        if elapsed < Self::SUMMARY_INTERVAL {
            return;
        }

        error!(
            event = "rdp.audio.summary",
            window_ms = elapsed.as_millis() as u64,
            wave_count = self.wave_count,
            wave_bytes = self.wave_bytes,
            callback_count = self.callback_count,
            callback_requested_bytes = self.callback_requested_bytes,
            callback_consumed_bytes = self.callback_consumed_bytes,
            starvation_count = self.starvation_count,
            max_wave_gap_ms = self.max_wave_gap.as_millis() as u64,
            max_callback_gap_ms = self.max_callback_gap.as_millis() as u64,
            buffered_bytes,
            "RDP audio diagnostics summary"
        );

        self.reset();
    }
}

/// `rdpsnd` 的本地播放实现。
#[derive(Debug)]
pub struct FluxRdpsndBackend {
    shared: Arc<AudioShared>,
    stream_handle: Option<JoinHandle<()>>,
    stream_ended: Arc<AtomicBool>,
    pcm_buffer: Arc<Mutex<PcmBuffer>>,
    format: Option<AudioFormat>,
}

impl FluxRdpsndBackend {
    /// 创建新的本地播放后端。
    fn new(shared: Arc<AudioShared>) -> Self {
        Self {
            shared,
            format: None,
            stream_handle: None,
            stream_ended: Arc::new(AtomicBool::new(false)),
            pcm_buffer: Arc::new(Mutex::new(PcmBuffer::default())),
        }
    }

    fn ensure_stream(&mut self, format_no: usize, format: &AudioFormat) -> Result<(), String> {
        if self.format.as_ref() != Some(format) {
            self.close();
        }

        if self.stream_handle.is_some() {
            return Ok(());
        }
        let format = format.clone();
        info!(
            event = "rdp.audio.format.selected",
            format_no,
            channels = format.n_channels,
            sample_rate = format.n_samples_per_sec,
            bits_per_sample = format.bits_per_sample,
            "selected remote audio playback format"
        );

        self.format = Some(format.clone());
        self.stream_ended.store(false, Ordering::Relaxed);
        self.shared.reset_diagnostics();
        if let Ok(mut buffer) = self.pcm_buffer.lock() {
            buffer.configure_prebuffer(prebuffer_target_bytes(&format));
            buffer.reset();
        }

        let shared = Arc::clone(&self.shared);
        let stream_ended = Arc::clone(&self.stream_ended);
        let pcm_buffer = Arc::clone(&self.pcm_buffer);
        self.stream_handle = Some(thread::spawn(move || {
            let stream =
                match DecodeStream::new(&format, Arc::clone(&pcm_buffer), Arc::clone(&shared)) {
                    Ok(stream) => stream,
                    Err(error) => {
                        shared.publish_state(RuntimeAudioState::Error, Some(error));
                        return;
                    }
                };

            if let Err(error) = stream.play() {
                shared.publish_state(RuntimeAudioState::Error, Some(error));
                return;
            }

            let state = if shared.muted.load(Ordering::Relaxed) {
                RuntimeAudioState::Muted
            } else {
                RuntimeAudioState::Playing
            };
            shared.publish_state(state, None);
            debug!("rdp audio stream thread parking");
            while !stream_ended.load(Ordering::Relaxed) {
                thread::park();
            }
            debug!("rdp audio stream thread unparked");
            drop(stream);
        }));

        Ok(())
    }
}

impl Drop for FluxRdpsndBackend {
    fn drop(&mut self) {
        self.close();
    }
}

impl RdpsndClientHandler for FluxRdpsndBackend {
    fn get_formats(&self) -> &[AudioFormat] {
        PCM_AUDIO_FORMATS.as_slice()
    }

    fn ready(&mut self) {
        self.shared.publish_ready_idle_state();
    }

    fn wave(&mut self, format_no: usize, format: &AudioFormat, _ts: u32, data: Cow<'_, [u8]>) {
        if let Err(error) = self.ensure_stream(format_no, format) {
            self.shared
                .publish_state(RuntimeAudioState::Error, Some(error.clone()));
            error!(%error, "failed to initialize RDP audio playback stream");
            return;
        }

        let packet = data.into_owned();
        let packet_len = packet.len();

        match self.pcm_buffer.lock() {
            Ok(mut buffer) => {
                buffer.push(packet, &self.shared);
                self.shared.record_wave_received(packet_len, buffer.len());
            }
            Err(error) => {
                let detail = format!("failed to lock PCM buffer: {error}");
                self.shared
                    .publish_state(RuntimeAudioState::Error, Some(detail.clone()));
                error!(%detail, "failed to queue RDP audio packet");
            }
        }
    }

    fn set_volume(&mut self, volume: VolumePdu) {
        debug!(?volume, "server requested volume update");
    }

    fn set_pitch(&mut self, pitch: PitchPdu) {
        debug!(?pitch, "server requested pitch update");
    }

    fn close(&mut self) {
        self.format = None;
        if let Ok(mut buffer) = self.pcm_buffer.lock() {
            buffer.stop();
        }
        if let Some(stream) = self.stream_handle.take() {
            self.stream_ended.store(true, Ordering::Relaxed);
            stream.thread().unpark();
            if let Err(error) = stream.join() {
                error!(?error, "failed to join RDP audio stream thread");
            }
        }
        self.shared.publish_state(RuntimeAudioState::Idle, None);
    }
}

struct DecodeStream {
    stream: Stream,
}

impl DecodeStream {
    fn new(
        rx_format: &AudioFormat,
        pcm_buffer: Arc<Mutex<PcmBuffer>>,
        shared: Arc<AudioShared>,
    ) -> Result<Self, String> {
        if rx_format.format != WaveFormat::PCM {
            return Err("当前仅支持 PCM 远端音频格式".to_string());
        }
        if rx_format.bits_per_sample != 16 && rx_format.bits_per_sample != 8 {
            return Err("当前仅支持 8-bit/16-bit PCM 远端音频".to_string());
        }

        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "no default audio output device".to_string())?;
        let device_description = match device.description() {
            Ok(description) => format!("{description:?}"),
            Err(error) => format!("unknown-device({error})"),
        };
        let config = StreamConfig {
            channels: rx_format.n_channels,
            sample_rate: rx_format.n_samples_per_sec,
            buffer_size: cpal::BufferSize::Default,
        };
        error!(
            event = "rdp.audio.stream.config",
            device_description,
            channels = config.channels,
            sample_rate = config.sample_rate,
            bits_per_sample = rx_format.bits_per_sample,
            buffer_size = ?config.buffer_size,
            "creating local audio output stream"
        );
        let gain_source = Arc::clone(&shared);
        let buffer_source = Arc::clone(&pcm_buffer);
        let bits_per_sample = rx_format.bits_per_sample;
        let stream_created_at = Instant::now();

        let stream = device
            .build_output_stream_raw(
                &config,
                if bits_per_sample == 8 {
                    SampleFormat::U8
                } else {
                    SampleFormat::I16
                },
                move |data, _info: &cpal::OutputCallbackInfo| {
                    let mut buffer = match buffer_source.lock() {
                        Ok(buffer) => buffer,
                        Err(_) => {
                            fill_silence(data.bytes_mut(), bits_per_sample);
                            return;
                        }
                    };
                    let report = if bits_per_sample == 8 {
                        buffer.fill_u8(data.bytes_mut(), gain_source.current_gain(), &gain_source)
                    } else {
                        buffer.fill_i16(data.bytes_mut(), gain_source.current_gain(), &gain_source)
                    };
                    gain_source.record_callback(report);
                },
                |error| error!(%error, "cpal output callback failed"),
                None,
            )
            .map_err(|error| format!("failed to create output stream: {error}"))?;
        error!(
            event = "rdp.audio.stream.created",
            elapsed_ms = stream_created_at.elapsed().as_millis() as u64,
            "local audio output stream created"
        );

        Ok(Self { stream })
    }

    fn play(&self) -> Result<(), String> {
        let play_started_at = Instant::now();
        self.stream
            .play()
            .map_err(|error| format!("failed to start output stream: {error}"))?;
        error!(
            event = "rdp.audio.stream.started",
            elapsed_ms = play_started_at.elapsed().as_millis() as u64,
            "local audio output stream started"
        );
        Ok(())
    }
}

#[derive(Debug, Default)]
struct PcmBuffer {
    data: VecDeque<u8>,
    starving_logged: bool,
    prebuffer_target: usize,
    playback_started: bool,
    prebuffer_wait_logged: bool,
    stopped: bool,
    idle: bool,
}

impl PcmBuffer {
    fn reset(&mut self) {
        self.data.clear();
        self.starving_logged = false;
        self.playback_started = false;
        self.prebuffer_wait_logged = false;
        self.stopped = false;
        self.idle = false;
    }

    /// 配置播放前所需的最小缓冲量。
    fn configure_prebuffer(&mut self, prebuffer_target: usize) {
        self.prebuffer_target = prebuffer_target;
    }

    /// 标记播放流已停止，后续回调应静音退出而不是记录饥饿。
    fn stop(&mut self) {
        self.data.clear();
        self.starving_logged = false;
        self.playback_started = false;
        self.prebuffer_wait_logged = false;
        self.stopped = true;
        self.idle = false;
    }

    fn push(&mut self, packet: Vec<u8>, shared: &AudioShared) {
        if packet.is_empty() {
            return;
        }
        self.data.extend(packet);
        self.starving_logged = false;
        self.idle = false;
        if !self.playback_started && self.data.len() >= self.prebuffer_target {
            self.playback_started = true;
            self.prebuffer_wait_logged = false;
            let state = if shared.muted.load(Ordering::Relaxed) {
                RuntimeAudioState::Muted
            } else {
                RuntimeAudioState::Playing
            };
            shared.publish_state(state, None);
            error!(
                event = "rdp.audio.prebuffer.ready",
                buffered_bytes = self.data.len(),
                prebuffer_target = self.prebuffer_target,
                "audio prebuffer is ready, starting playback"
            );
        }
    }

    fn len(&self) -> usize {
        self.data.len()
    }

    fn fill_i16(
        &mut self,
        output: &mut [u8],
        gain: AudioGain,
        shared: &AudioShared,
    ) -> AudioFillReport {
        if self.stopped {
            output.fill(0);
            return AudioFillReport {
                requested_bytes: output.len(),
                consumed_bytes: 0,
                buffered_after: 0,
                waiting_for_prebuffer: false,
            };
        }
        if self.idle {
            output.fill(0);
            return AudioFillReport {
                requested_bytes: output.len(),
                consumed_bytes: 0,
                buffered_after: self.data.len(),
                waiting_for_prebuffer: false,
            };
        }
        if !self.playback_started {
            self.handle_prebuffer_wait(output, 0);
            return AudioFillReport {
                requested_bytes: output.len(),
                consumed_bytes: 0,
                buffered_after: self.data.len(),
                waiting_for_prebuffer: true,
            };
        }
        let mut filled = 0;

        while filled + 1 < output.len() {
            let Some(lo) = self.data.pop_front() else {
                if self.handle_idle_timeout(shared) {
                    output[filled..].fill(0);
                    return AudioFillReport {
                        requested_bytes: output.len(),
                        consumed_bytes: filled,
                        buffered_after: 0,
                        waiting_for_prebuffer: false,
                    };
                }
                self.handle_starvation(shared);
                output[filled..].fill(0);
                let buffered_after = self.data.len();
                return AudioFillReport {
                    requested_bytes: output.len(),
                    consumed_bytes: filled,
                    buffered_after,
                    waiting_for_prebuffer: false,
                };
            };
            let Some(hi) = self.data.pop_front() else {
                if self.handle_idle_timeout(shared) {
                    output[filled..].fill(0);
                    return AudioFillReport {
                        requested_bytes: output.len(),
                        consumed_bytes: filled,
                        buffered_after: 0,
                        waiting_for_prebuffer: false,
                    };
                }
                self.handle_starvation(shared);
                output[filled] = 0;
                if filled + 1 < output.len() {
                    output[filled + 1] = 0;
                }
                if filled + 2 < output.len() {
                    output[filled + 2..].fill(0);
                }
                let buffered_after = self.data.len();
                return AudioFillReport {
                    requested_bytes: output.len(),
                    consumed_bytes: filled,
                    buffered_after,
                    waiting_for_prebuffer: false,
                };
            };

            let sample = i16::from_le_bytes([lo, hi]);
            let adjusted = apply_gain_i16(sample, gain);
            let bytes = adjusted.to_le_bytes();
            output[filled] = bytes[0];
            output[filled + 1] = bytes[1];
            filled += 2;
        }

        if filled < output.len() {
            output[filled..].fill(0);
        }
        self.starving_logged = false;
        AudioFillReport {
            requested_bytes: output.len(),
            consumed_bytes: filled,
            buffered_after: self.data.len(),
            waiting_for_prebuffer: false,
        }
    }

    fn fill_u8(
        &mut self,
        output: &mut [u8],
        gain: AudioGain,
        shared: &AudioShared,
    ) -> AudioFillReport {
        if self.stopped {
            output.fill(128);
            return AudioFillReport {
                requested_bytes: output.len(),
                consumed_bytes: 0,
                buffered_after: 0,
                waiting_for_prebuffer: false,
            };
        }
        if self.idle {
            output.fill(128);
            return AudioFillReport {
                requested_bytes: output.len(),
                consumed_bytes: 0,
                buffered_after: self.data.len(),
                waiting_for_prebuffer: false,
            };
        }
        if !self.playback_started {
            self.handle_prebuffer_wait(output, 128);
            return AudioFillReport {
                requested_bytes: output.len(),
                consumed_bytes: 0,
                buffered_after: self.data.len(),
                waiting_for_prebuffer: true,
            };
        }
        let mut filled = 0;

        while filled < output.len() {
            let Some(sample) = self.data.pop_front() else {
                if self.handle_idle_timeout(shared) {
                    output[filled..].fill(128);
                    return AudioFillReport {
                        requested_bytes: output.len(),
                        consumed_bytes: filled,
                        buffered_after: 0,
                        waiting_for_prebuffer: false,
                    };
                }
                self.handle_starvation(shared);
                output[filled..].fill(128);
                let buffered_after = self.data.len();
                return AudioFillReport {
                    requested_bytes: output.len(),
                    consumed_bytes: filled,
                    buffered_after,
                    waiting_for_prebuffer: false,
                };
            };

            output[filled] = apply_gain_u8(sample, gain);
            filled += 1;
        }
        self.starving_logged = false;
        AudioFillReport {
            requested_bytes: output.len(),
            consumed_bytes: filled,
            buffered_after: self.data.len(),
            waiting_for_prebuffer: false,
        }
    }

    fn handle_prebuffer_wait(&mut self, output: &mut [u8], silence_value: u8) {
        output.fill(silence_value);
        if !self.prebuffer_wait_logged {
            error!(
                event = "rdp.audio.prebuffer.waiting",
                buffered_bytes = self.data.len(),
                prebuffer_target = self.prebuffer_target,
                "waiting for audio prebuffer before starting playback"
            );
            self.prebuffer_wait_logged = true;
        }
    }

    fn handle_starvation(&mut self, shared: &AudioShared) {
        if !self.starving_logged {
            shared.record_starvation(self.data.len());
            self.starving_logged = true;
        }
    }

    fn handle_idle_timeout(&mut self, shared: &AudioShared) -> bool {
        if !shared.should_transition_to_idle() {
            return false;
        }
        self.playback_started = false;
        self.prebuffer_wait_logged = false;
        self.starving_logged = false;
        self.idle = true;
        shared.publish_ready_idle_state();
        true
    }
}

fn fill_silence(output: &mut [u8], bits_per_sample: u16) {
    if bits_per_sample == 8 {
        output.fill(128);
    } else {
        output.fill(0);
    }
}

fn apply_gain_i16(sample: i16, gain: AudioGain) -> i16 {
    if gain.muted {
        return 0;
    }

    let scaled = sample as f32 * gain.volume;
    scaled.clamp(i16::MIN as f32, i16::MAX as f32) as i16
}

fn apply_gain_u8(sample: u8, gain: AudioGain) -> u8 {
    if gain.muted {
        return 128;
    }

    let centered = sample as f32 - 128.0;
    let scaled = centered * gain.volume + 128.0;
    scaled.clamp(u8::MIN as f32, u8::MAX as f32) as u8
}

/// 根据远端音频格式计算启动播放前的预缓冲量。
fn prebuffer_target_bytes(format: &AudioFormat) -> usize {
    let bytes_per_second = format.n_avg_bytes_per_sec as usize;
    let two_packets_floor = 64 * 1024;
    let jitter_budget = bytes_per_second / 5;
    two_packets_floor.max(jitter_budget)
}

fn pcm_audio_format(channels: u16, sample_rate: u32, bits_per_sample: u16) -> AudioFormat {
    let block_align = channels * (bits_per_sample / 8);
    AudioFormat {
        format: WaveFormat::PCM,
        n_channels: channels,
        n_samples_per_sec: sample_rate,
        n_avg_bytes_per_sec: sample_rate * block_align as u32,
        n_block_align: block_align,
        bits_per_sample,
        data: None,
    }
}

/// 将音量值收敛到 `0.0..=1.0`。
pub fn clamp_audio_volume(volume: f32) -> f32 {
    if volume.is_nan() {
        return 1.0;
    }
    volume.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::clamp_audio_volume;

    #[test]
    fn clamps_audio_volume_to_zero_and_one() {
        assert_eq!(clamp_audio_volume(-1.0), 0.0);
        assert_eq!(clamp_audio_volume(0.5), 0.5);
        assert_eq!(clamp_audio_volume(2.0), 1.0);
    }

    #[test]
    fn normalizes_nan_audio_volume_to_default() {
        assert_eq!(clamp_audio_volume(f32::NAN), 1.0);
    }
}
