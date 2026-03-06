//! 统一埋点日志助手。
use std::time::{SystemTime, UNIX_EPOCH};

use log::{debug, error, info, warn};
use serde_json::{Map, Value, json};

/// 埋点级别。
pub enum TelemetryLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// 输出统一结构化埋点日志。
pub fn log_telemetry(level: TelemetryLevel, event: &str, trace_id: Option<&str>, fields: Value) {
    let mut payload = Map::new();
    payload.insert("event".to_string(), Value::String(event.to_string()));
    payload.insert("ts".to_string(), json!(now_epoch_ms()));
    payload.insert("source".to_string(), Value::String("engine".to_string()));
    payload.insert(
        "level".to_string(),
        Value::String(
            match level {
                TelemetryLevel::Debug => "debug",
                TelemetryLevel::Info => "info",
                TelemetryLevel::Warn => "warn",
                TelemetryLevel::Error => "error",
            }
            .to_string(),
        ),
    );
    payload.insert(
        "traceId".to_string(),
        trace_id
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
    );
    if let Value::Object(map) = fields {
        map.into_iter().for_each(|(k, v)| {
            payload.insert(k, v);
        });
    }
    let line = Value::Object(payload).to_string();
    match level {
        TelemetryLevel::Debug => debug!("{line}"),
        TelemetryLevel::Info => info!("{line}"),
        TelemetryLevel::Warn => warn!("{line}"),
        TelemetryLevel::Error => error!("{line}"),
    }
}

fn now_epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
