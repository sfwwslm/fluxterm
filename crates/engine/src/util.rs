//! 通用工具函数。
use std::time::SystemTime;

/// 获取当前时间的 Unix 秒级时间戳。
pub fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
