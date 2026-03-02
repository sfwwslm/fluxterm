//! 会话资源监控管理。
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use engine::{
    EngineEvent, EventCallback, HostProfile, ResourceCpuSnapshot, ResourceMemorySnapshot,
    ResourceMonitorStatus, SessionResourceSnapshot, monitor::run_ssh_resource_monitor,
    util::now_epoch,
};
use log::{info, warn};
use sysinfo::System;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

pub const MIN_RESOURCE_MONITOR_INTERVAL_SEC: u64 = 3;

struct ResourceMonitorHandle {
    stop_tx: watch::Sender<bool>,
}

/// 资源监控共享状态。
pub struct ResourceMonitorState {
    monitors: Mutex<HashMap<String, ResourceMonitorHandle>>,
}

impl Default for ResourceMonitorState {
    fn default() -> Self {
        Self {
            monitors: Mutex::new(HashMap::new()),
        }
    }
}

impl ResourceMonitorState {
    /// 启动本地资源监控。
    pub fn start_local(&self, app: AppHandle, session_id: String, interval_sec: u64) {
        self.stop(&session_id);
        let interval_sec = interval_sec.max(MIN_RESOURCE_MONITOR_INTERVAL_SEC);
        let (stop_tx, stop_rx) = watch::channel(false);
        self.monitors
            .lock()
            .expect("resource monitor lock poisoned")
            .insert(session_id.clone(), ResourceMonitorHandle { stop_tx });

        info!(
            "resource_monitor_local_start session_id={} interval_sec={}",
            session_id, interval_sec
        );
        tauri::async_runtime::spawn(async move {
            run_local_resource_monitor(app, session_id, interval_sec, stop_rx).await;
        });
    }

    /// 启动远端 SSH 资源监控。
    pub fn start_ssh(
        &self,
        app: AppHandle,
        session_id: String,
        profile: HostProfile,
        interval_sec: u64,
    ) {
        self.stop(&session_id);
        let interval_sec = interval_sec.max(MIN_RESOURCE_MONITOR_INTERVAL_SEC);
        let (stop_tx, stop_rx) = watch::channel(false);
        self.monitors
            .lock()
            .expect("resource monitor lock poisoned")
            .insert(session_id.clone(), ResourceMonitorHandle { stop_tx });

        info!(
            "resource_monitor_ssh_start session_id={} profile_id={} host={} interval_sec={}",
            session_id, profile.id, profile.host, interval_sec
        );
        tauri::async_runtime::spawn(async move {
            let on_event = build_resource_event_bridge(app);
            if let Err(error) = run_ssh_resource_monitor(
                session_id.clone(),
                profile,
                interval_sec,
                stop_rx,
                on_event,
            )
            .await
            {
                warn!(
                    "resource_monitor_ssh_failed session_id={} code={} message={} detail={}",
                    session_id,
                    error.code,
                    error.message,
                    error.detail.unwrap_or_default()
                );
            }
        });
    }

    /// 停止指定会话的资源监控。
    pub fn stop(&self, session_id: &str) {
        let handle = self
            .monitors
            .lock()
            .expect("resource monitor lock poisoned")
            .remove(session_id);
        if let Some(handle) = handle {
            let _ = handle.stop_tx.send(true);
            info!("resource_monitor_stop session_id={}", session_id);
        }
    }
}

async fn run_local_resource_monitor(
    app: AppHandle,
    session_id: String,
    interval_sec: u64,
    mut stop_rx: watch::Receiver<bool>,
) {
    let mut system = System::new_all();
    system.refresh_memory();
    system.refresh_cpu_usage();
    tokio::time::sleep(Duration::from_millis(250)).await;
    system.refresh_cpu_usage();

    let mut ticker = tokio::time::interval(Duration::from_secs(interval_sec));

    loop {
        tokio::select! {
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    break;
                }
            }
            _ = ticker.tick() => {
                system.refresh_memory();
                system.refresh_cpu_usage();
                let snapshot = SessionResourceSnapshot {
                    session_id: session_id.clone(),
                    sampled_at: now_epoch(),
                    source: "local".to_string(),
                    status: ResourceMonitorStatus::Ready,
                    cpu: Some(ResourceCpuSnapshot {
                        total_percent: system.global_cpu_info().cpu_usage(),
                        user_percent: 0.0,
                        system_percent: 0.0,
                        idle_percent: 0.0,
                        iowait_percent: 0.0,
                    }),
                    memory: Some(ResourceMemorySnapshot {
                        total_bytes: system.total_memory(),
                        used_bytes: system.used_memory(),
                        free_bytes: system.free_memory(),
                        available_bytes: system.available_memory(),
                        cache_bytes: 0,
                    }),
                };
                let _ = app.emit("session:resource", snapshot);
            }
        }
    }
}

fn build_resource_event_bridge(app: AppHandle) -> EventCallback {
    std::sync::Arc::new(move |event| {
        if let EngineEvent::SessionResource(payload) = event {
            let _ = app.emit("session:resource", payload);
        }
    })
}
