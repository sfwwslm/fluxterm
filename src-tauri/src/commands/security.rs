//! 安全状态查询命令。

use engine::EngineError;
use tauri::AppHandle;

use crate::profile_store::read_profiles;
use crate::security::CryptoService;
use crate::security::SecurityStatus;

/// 返回当前安全服务状态。
#[tauri::command]
pub fn security_status(app: AppHandle) -> Result<SecurityStatus, EngineError> {
    let store = read_profiles(&app)?;
    let crypto = CryptoService::new(store.secret.as_ref())?;
    Ok(crypto.status())
}
