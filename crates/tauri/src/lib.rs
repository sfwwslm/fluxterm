//! Tauri 应用入口与命令注册。
pub mod commands;
pub mod config_paths;
pub mod events;
pub mod local_fs;
pub mod local_shell;
pub mod profile_store;
pub mod resource_monitor;
pub mod state;

use std::sync::Arc;

use engine::Engine;
use log::LevelFilter;
use tauri_plugin_log::{Target, TargetKind};

use crate::commands::local::{local_home, local_list, local_ssh_keys};
use crate::commands::local_shell::{
    local_shell_connect, local_shell_disconnect, local_shell_list, local_shell_resize,
    local_shell_write,
};
use crate::commands::profile::{
    profile_groups_list, profile_groups_save, profile_list, profile_remove, profile_save,
};
use crate::commands::resource_monitor::{
    resource_monitor_start_local, resource_monitor_start_ssh, resource_monitor_stop,
};
use crate::commands::sftp::{
    sftp_download, sftp_home, sftp_list, sftp_mkdir, sftp_remove, sftp_rename, sftp_resolve_path,
    sftp_upload,
};
use crate::commands::ssh::{ssh_connect, ssh_disconnect, ssh_resize, ssh_write};
use crate::commands::system::app_config_dir;
use crate::local_shell::LocalShellState;
use crate::resource_monitor::ResourceMonitorState;
use crate::state::EngineState;

fn resolve_log_level() -> LevelFilter {
    let raw = std::env::var("RUST_LOG").unwrap_or_default();
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.contains("trace") {
        return LevelFilter::Trace;
    }
    if normalized.contains("debug") {
        return LevelFilter::Debug;
    }
    if normalized.contains("warn") {
        return LevelFilter::Warn;
    }
    if normalized.contains("error") {
        return LevelFilter::Error;
    }
    if normalized.contains("off") {
        return LevelFilter::Off;
    }
    LevelFilter::Info
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(message) = crate::config_paths::load_dotenv_strict() {
        eprintln!("{message}");
        std::process::exit(1);
    }
    let log_level = resolve_log_level();
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(EngineState {
            engine: Arc::new(Engine::new()),
        })
        .manage(LocalShellState::default())
        .manage(ResourceMonitorState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .level(log_level)
                // https://github.com/tauri-apps/tauri/issues/8494 2025年7月22日 未解决
                // 抑制 tao::platform_impl::platform::event 警告的日志
                .filter(|metadata| {
                    metadata.target() != "tao::platform_impl::platform::event_loop::runner"
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            profile_list,
            profile_groups_list,
            profile_groups_save,
            profile_save,
            profile_remove,
            ssh_connect,
            ssh_disconnect,
            ssh_resize,
            ssh_write,
            sftp_list,
            sftp_home,
            sftp_resolve_path,
            sftp_upload,
            sftp_download,
            sftp_rename,
            sftp_remove,
            sftp_mkdir,
            local_home,
            local_list,
            local_ssh_keys,
            local_shell_connect,
            local_shell_disconnect,
            local_shell_list,
            local_shell_write,
            local_shell_resize,
            resource_monitor_start_local,
            resource_monitor_start_ssh,
            resource_monitor_stop,
            app_config_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
