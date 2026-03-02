//! 共享状态定义。
use std::sync::Arc;

use engine::Engine;

/// Tauri 共享状态，承载引擎实例。
pub struct EngineState {
    pub engine: Arc<Engine>,
}
