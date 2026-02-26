//! Tauri 应用入口与命令注册。
pub mod commands;
pub mod events;
pub mod local_fs;
pub mod local_shell;
pub mod profile_store;
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
use crate::commands::profile::{profile_list, profile_remove, profile_save};
use crate::commands::sftp::{
    sftp_download, sftp_home, sftp_list, sftp_mkdir, sftp_remove, sftp_rename, sftp_upload,
};
use crate::commands::ssh::{ssh_connect, ssh_disconnect, ssh_resize, ssh_write};
use crate::local_shell::LocalShellState;
use crate::state::EngineState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(EngineState {
            engine: Arc::new(Engine::new()),
        })
        .manage(LocalShellState::default())
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
                .level(LevelFilter::Info)
                // https://github.com/tauri-apps/tauri/issues/8494 2025年7月22日 未解决
                // 抑制 tao::platform_impl::platform::event 警告的日志
                .filter(|metadata| {
                    metadata.target() != "tao::platform_impl::platform::event_loop::runner"
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            profile_list,
            profile_save,
            profile_remove,
            ssh_connect,
            ssh_disconnect,
            ssh_resize,
            ssh_write,
            sftp_list,
            sftp_home,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
