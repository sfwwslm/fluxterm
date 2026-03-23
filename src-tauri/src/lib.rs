//! Tauri 应用入口与命令注册。
pub mod ai;
pub mod ai_settings;
pub mod commands;
pub mod config_paths;
pub mod events;
pub mod local_fs;
pub mod local_shell;
pub mod profile_secrets;
pub mod profile_store;
pub mod remote_edit;
pub mod resource_monitor;
pub mod security;
pub mod session_settings;
pub mod ssh_config_import;
pub mod ssh_host_keys;
pub mod state;
pub mod telemetry;
pub mod utils;

use std::sync::Arc;

use engine::Engine;
use log::LevelFilter;
use tauri_plugin_log::{Target, TargetKind};

use crate::commands::ai::{
    ai_explain_selection, ai_provider_test, ai_session_chat, ai_session_chat_stream_cancel,
    ai_session_chat_stream_start, ai_settings_get, ai_settings_save,
};
use crate::commands::file::file_open;
use crate::commands::local::{local_home, local_list, local_ssh_keys};
use crate::commands::local_shell::{
    local_shell_connect, local_shell_disconnect, local_shell_list, local_shell_resize,
    local_shell_write, local_shell_write_binary,
};
use crate::commands::profile::{
    profile_groups_list, profile_groups_save, profile_list, profile_remove, profile_save,
    ssh_import_openssh_config,
};
use crate::commands::proxy::{proxy_close, proxy_close_all, proxy_list, proxy_open};
use crate::commands::remote_edit::{
    remote_edit_confirm_upload, remote_edit_dismiss_pending, remote_edit_list, remote_edit_open,
};
use crate::commands::resource_monitor::{
    resource_monitor_start_local, resource_monitor_start_ssh, resource_monitor_stop,
};
use crate::commands::security::{
    security_change_password, security_enable_strong_protection, security_enable_weak_protection,
    security_lock, security_status, security_unlock,
};
use crate::commands::sftp::{
    sftp_cancel_transfer, sftp_download, sftp_download_dir, sftp_home, sftp_list, sftp_mkdir,
    sftp_remove, sftp_rename, sftp_resolve_path, sftp_upload, sftp_upload_batch,
};
use crate::commands::ssh::{
    ssh_connect, ssh_disconnect, ssh_host_key_confirm, ssh_resize, ssh_write, ssh_write_binary,
};
use crate::commands::system::{app_config_dir, app_data_dir, get_system_info, open_devtools};
use crate::commands::tunnel::{
    ssh_tunnel_close, ssh_tunnel_close_all, ssh_tunnel_list, ssh_tunnel_open,
};
use crate::local_shell::LocalShellState;
use crate::remote_edit::RemoteEditState;
use crate::resource_monitor::ResourceMonitorState;
use crate::state::{EngineState, SecurityState};

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(EngineState {
            engine: Arc::new(Engine::new()),
        })
        .manage(SecurityState::default())
        .manage(LocalShellState::default())
        .manage(ResourceMonitorState::default())
        .manage(RemoteEditState::default())
        .manage(ai::AiRuntimeState::default())
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
            ssh_import_openssh_config,
            ai_session_chat,
            ai_session_chat_stream_start,
            ai_session_chat_stream_cancel,
            ai_explain_selection,
            ai_settings_get,
            ai_settings_save,
            ai_provider_test,
            security_status,
            security_unlock,
            security_lock,
            security_enable_strong_protection,
            security_change_password,
            security_enable_weak_protection,
            ssh_connect,
            ssh_disconnect,
            ssh_host_key_confirm,
            ssh_resize,
            ssh_write,
            ssh_write_binary,
            ssh_tunnel_open,
            ssh_tunnel_close,
            ssh_tunnel_list,
            ssh_tunnel_close_all,
            sftp_list,
            sftp_home,
            sftp_resolve_path,
            sftp_upload,
            sftp_upload_batch,
            sftp_download,
            sftp_download_dir,
            sftp_cancel_transfer,
            sftp_rename,
            sftp_remove,
            sftp_mkdir,
            local_home,
            local_list,
            local_ssh_keys,
            file_open,
            local_shell_connect,
            local_shell_disconnect,
            local_shell_list,
            local_shell_write,
            local_shell_write_binary,
            local_shell_resize,
            resource_monitor_start_local,
            resource_monitor_start_ssh,
            resource_monitor_stop,
            app_config_dir,
            app_data_dir,
            get_system_info,
            open_devtools,
            proxy_open,
            proxy_close,
            proxy_list,
            proxy_close_all,
            remote_edit_open,
            remote_edit_list,
            remote_edit_confirm_upload,
            remote_edit_dismiss_pending,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
