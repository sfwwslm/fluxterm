//! 本地文件打开命令。
use std::path::Path;

use engine::EngineError;
use log::warn;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// 使用默认编辑器或系统默认程序打开本地文件。
#[tauri::command]
pub fn file_open(
    app: AppHandle,
    file_path: String,
    default_editor_path: Option<String>,
) -> Result<(), EngineError> {
    if !Path::new(&file_path).is_file() {
        return Err(EngineError::new("file_open_failed", "目标文件不存在或不可访问"));
    }

    if let Some(editor_path) = default_editor_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if Path::new(&editor_path).is_file() {
            match app.opener().open_path(&file_path, Some(&editor_path)) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    warn!(
                        "{{\"event\":\"file:open-editor-fallback\",\"filePath\":\"{}\",\"editorPath\":\"{}\",\"message\":\"{}\"}}",
                        file_path,
                        editor_path,
                        error
                    );
                }
            }
        } else {
            warn!(
                "{{\"event\":\"file:open-editor-invalid\",\"filePath\":\"{}\",\"editorPath\":\"{}\"}}",
                file_path, editor_path
            );
        }
    }

    app.opener()
        .open_path(&file_path, None::<&str>)
        .map_err(|error| {
            EngineError::with_detail("file_open_failed", "无法打开文件", error.to_string())
        })
}
