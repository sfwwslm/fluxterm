//! 本地 Shell 会话管理。
use std::collections::HashMap;
use std::env;
use std::io::{Read, Write};
#[cfg(target_os = "windows")]
use std::path::Path;
use std::sync::Mutex;
use std::thread;

#[cfg(not(target_os = "windows"))]
use std::path::PathBuf;

use engine::{EngineError, Session, SessionState, TerminalSize, util::now_epoch};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::ai::{record_terminal_exit_from_app, record_terminal_output_from_app};

const LOCAL_PROFILE_ID: &str = "__local_shell__";

/// 本地 Shell 配置。
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalShellProfile {
    pub id: String,
    pub label: String,
    pub path: String,
    pub args: Vec<String>,
}

/// 本地 Shell 启动参数。
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalShellLaunchConfig {
    pub terminal_type: Option<String>,
    pub charset: Option<String>,
    pub word_separators: Option<String>,
    pub bell_mode: Option<String>,
    pub bell_cooldown_ms: Option<u32>,
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

struct LocalShellHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    _reader_thread: thread::JoinHandle<()>,
    _waiter_thread: thread::JoinHandle<()>,
}

/// 本地 Shell 共享状态。
pub struct LocalShellState {
    sessions: Mutex<HashMap<String, LocalShellHandle>>,
}

impl Default for LocalShellState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg(target_os = "windows")]
fn path_exists(path: &str) -> bool {
    Path::new(path).is_file()
}

#[cfg(target_os = "windows")]
fn find_in_path(exe: &str) -> Option<String> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn collect_windows_shells() -> Vec<LocalShellProfile> {
    let mut shells = Vec::new();

    if let Some(pwsh) = find_in_path("pwsh.exe")
        .or_else(|| Some("C:\\Program Files\\PowerShell\\7\\pwsh.exe".to_string()))
        .filter(|path| path_exists(path))
    {
        shells.push(LocalShellProfile {
            id: "pwsh".to_string(),
            label: "PowerShell 7".to_string(),
            path: pwsh,
            args: Vec::new(),
        });
    }

    let windows_ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    if path_exists(windows_ps) {
        shells.push(LocalShellProfile {
            id: "powershell".to_string(),
            label: "PowerShell".to_string(),
            path: windows_ps.to_string(),
            args: Vec::new(),
        });
    }

    let cmd = "C:\\Windows\\System32\\cmd.exe";
    if path_exists(cmd) {
        shells.push(LocalShellProfile {
            id: "cmd".to_string(),
            label: "Command Prompt".to_string(),
            path: cmd.to_string(),
            args: Vec::new(),
        });
    }

    let git_bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    if path_exists(git_bash) {
        shells.push(LocalShellProfile {
            id: "git-bash".to_string(),
            label: "Git Bash".to_string(),
            path: git_bash.to_string(),
            args: vec!["--login".to_string(), "-i".to_string()],
        });
    }

    let wsl = "C:\\Windows\\System32\\wsl.exe";
    if path_exists(wsl) {
        shells.push(LocalShellProfile {
            id: "wsl-ubuntu".to_string(),
            label: "WSL Ubuntu".to_string(),
            path: wsl.to_string(),
            args: vec!["~".to_string(), "-d".to_string(), "Ubuntu".to_string()],
        });
    }

    shells
}

fn collect_shells() -> Vec<LocalShellProfile> {
    #[cfg(target_os = "windows")]
    {
        collect_windows_shells()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut shells = Vec::new();
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let label = PathBuf::from(&shell)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("shell")
            .to_string();
        let args = resolve_login_shell_args(&shell);
        shells.push(LocalShellProfile {
            id: "shell".to_string(),
            label,
            path: shell,
            args,
        });
        shells
    }
}

#[cfg(not(target_os = "windows"))]
/// 根据 shell 可执行文件名推断 login shell 参数，确保 GUI 启动时也能加载用户环境。
fn resolve_login_shell_args(shell_path: &str) -> Vec<String> {
    let shell_name = PathBuf::from(shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase())
        .unwrap_or_default();
    if shell_name.contains("fish") {
        return vec!["--login".to_string()];
    }
    vec!["-l".to_string()]
}

fn default_shell_id(shells: &[LocalShellProfile]) -> Option<String> {
    shells
        .iter()
        .find(|shell| shell.id == "powershell")
        .map(|shell| shell.id.clone())
        .or_else(|| shells.first().map(|shell| shell.id.clone()))
}

fn resolve_shell_profile(shell_id: Option<String>) -> Result<LocalShellProfile, EngineError> {
    let shells = collect_shells();
    if shells.is_empty() {
        return Err(EngineError::new("local_shell_missing", "未发现可用 Shell"));
    }
    if let Some(id) = shell_id
        && let Some(shell) = shells.iter().find(|shell| shell.id == id)
    {
        return Ok(shell.clone());
    }
    let fallback = default_shell_id(&shells)
        .ok_or_else(|| EngineError::new("local_shell_missing", "未发现可用 Shell"))?;
    shells
        .into_iter()
        .find(|shell| shell.id == fallback)
        .ok_or_else(|| EngineError::new("local_shell_missing", "未发现可用 Shell"))
}

fn normalize_terminal_type(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "xterm-256color" => Some("xterm-256color"),
        "xterm" => Some("xterm"),
        "screen-256color" => Some("screen-256color"),
        "tmux-256color" => Some("tmux-256color"),
        "vt100" => Some("vt100"),
        _ => None,
    }
}

#[cfg(not(target_os = "windows"))]
fn normalize_locale_for_charset(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "utf-8" => Some("en_US.UTF-8"),
        "gbk" => Some("zh_CN.GBK"),
        "gb18030" => Some("zh_CN.GB18030"),
        _ => None,
    }
}

/// 枚举本地可用 Shell 列表。
pub fn list_local_shells() -> Vec<LocalShellProfile> {
    collect_shells()
}

/// 启动本地 Shell 会话。
pub fn start_local_shell(
    app: AppHandle,
    state: &LocalShellState,
    shell_id: Option<String>,
    launch_config: Option<LocalShellLaunchConfig>,
    size: TerminalSize,
) -> Result<Session, EngineError> {
    let session_id = Uuid::new_v4().to_string();
    let shell = resolve_shell_profile(shell_id)?;
    let pty_system = native_pty_system();
    let pty_pair = pty_system.openpty(PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    });
    let pair = pty_pair.map_err(|err| {
        EngineError::with_detail("local_shell_failed", "无法创建本地终端", err.to_string())
    })?;

    let mut command = CommandBuilder::new(&shell.path);
    let resolved_term = launch_config
        .as_ref()
        .and_then(|cfg| cfg.terminal_type.as_deref())
        .and_then(normalize_terminal_type)
        .unwrap_or("xterm-256color");
    command.env("TERM", resolved_term);
    let colorterm = env::var("COLORTERM").unwrap_or_default();
    if colorterm.trim().is_empty() {
        command.env("COLORTERM", "truecolor");
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(locale) = launch_config
        .as_ref()
        .and_then(|cfg| cfg.charset.as_deref())
        .and_then(normalize_locale_for_charset)
    {
        command.env("LC_CTYPE", locale);
        command.env("LANG", locale);
    }
    for arg in &shell.args {
        command.arg(arg);
    }
    let mut child = pair.slave.spawn_command(command).map_err(|err| {
        EngineError::with_detail("local_shell_failed", "无法启动本地 Shell", err.to_string())
    })?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|err| {
        EngineError::with_detail(
            "local_shell_failed",
            "无法读取本地终端输出",
            err.to_string(),
        )
    })?;
    let writer = pair.master.take_writer().map_err(|err| {
        EngineError::with_detail("local_shell_failed", "无法写入本地终端", err.to_string())
    })?;
    let killer = child.clone_killer();

    let session_id_clone = session_id.clone();
    let app_clone = app.clone();
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                    record_terminal_output_from_app(&app_clone, &session_id_clone, &data);
                    let _ = app_clone.emit(
                        "terminal:output",
                        TerminalOutputPayload {
                            session_id: session_id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = session_id_clone;
    });

    let session_id_wait = session_id.clone();
    let app_wait = app.clone();
    let waiter_thread = thread::spawn(move || {
        let _ = child.wait();
        record_terminal_exit_from_app(&app_wait, &session_id_wait);
        let _ = app_wait.emit(
            "terminal:exit",
            TerminalExitPayload {
                session_id: session_id_wait,
            },
        );
    });

    let handle = LocalShellHandle {
        master: pair.master,
        writer,
        killer,
        _reader_thread: reader_thread,
        _waiter_thread: waiter_thread,
    };

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| EngineError::new("local_shell_lock_failed", "无法访问本地 Shell 状态"))?;
    sessions.insert(session_id.clone(), handle);

    Ok(Session {
        session_id,
        profile_id: LOCAL_PROFILE_ID.to_string(),
        state: SessionState::Connected,
        created_at: now_epoch(),
        last_error: None,
    })
}

/// 写入本地 Shell 输入。
pub fn write_local_shell(
    state: &LocalShellState,
    session_id: &str,
    data: &[u8],
) -> Result<(), EngineError> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| EngineError::new("local_shell_lock_failed", "无法访问本地 Shell 状态"))?;
    let handle = sessions
        .get_mut(session_id)
        .ok_or_else(|| EngineError::new("local_shell_missing", "本地 Shell 会话不存在"))?;
    handle.writer.write_all(data).map_err(|err| {
        EngineError::with_detail(
            "local_shell_write_failed",
            "无法写入本地 Shell",
            err.to_string(),
        )
    })?;
    handle.writer.flush().map_err(|err| {
        EngineError::with_detail(
            "local_shell_write_failed",
            "无法刷新本地 Shell",
            err.to_string(),
        )
    })?;
    Ok(())
}

/// 调整本地 Shell 终端尺寸。
pub fn resize_local_shell(
    state: &LocalShellState,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), EngineError> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| EngineError::new("local_shell_lock_failed", "无法访问本地 Shell 状态"))?;
    let handle = sessions
        .get_mut(session_id)
        .ok_or_else(|| EngineError::new("local_shell_missing", "本地 Shell 会话不存在"))?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| {
            EngineError::with_detail(
                "local_shell_resize_failed",
                "无法调整本地 Shell 尺寸",
                err.to_string(),
            )
        })?;
    Ok(())
}

/// 关闭本地 Shell 会话。
pub fn stop_local_shell(state: &LocalShellState, session_id: &str) -> Result<(), EngineError> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| EngineError::new("local_shell_lock_failed", "无法访问本地 Shell 状态"))?;
    let mut handle = sessions
        .remove(session_id)
        .ok_or_else(|| EngineError::new("local_shell_missing", "本地 Shell 会话不存在"))?;
    let _ = handle.killer.kill();
    Ok(())
}
