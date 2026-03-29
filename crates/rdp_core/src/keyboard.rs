//! 浏览器键盘事件到 RDP 扫描码的映射。
//!
//! 该模块只负责 `KeyboardEvent.code -> RDP Scancode` 这条稳定映射链，
//! 用于处理物理键位语义明确的控制键、导航键、功能键和小键盘。
//!
//! 设计约束：
//!
//! 1. 前端负责采集 `keydown` / `keyup`、传递 `code` / `key` 和修饰键状态，
//!    并在失焦时补发 `key_up`
//! 2. 运行时优先使用 `KeyboardEvent.code` 解析扫描码，因为它表示物理键位，
//!    不受键盘布局切换影响
//! 3. 可打印单字符输入是否走 Unicode，不在本模块决定，而由
//!    `ironrdp_runtime::extract_unicode_char` 统一判断
//! 4. 本模块维护的映射表应覆盖主键区、控制键、导航键、功能键和小键盘，
//!    避免按单个异常键位零散打补丁

use ironrdp::input::Scancode;

/// 内部键盘扫描码表项，用于将浏览器 `KeyboardEvent.code` 映射到 RDP 协议使用的 scancode。
#[derive(Clone, Copy)]
pub struct KeyboardScancodeEntry {
    pub code: &'static str,
    pub extended: bool,
    pub scancode: u8,
}

/// 将浏览器 `KeyboardEvent.code` 转换为 IronRDP 内部 Scancode 类型。
pub fn code_to_scancode(code: &str) -> Option<Scancode> {
    KEYBOARD_SCANCODE_TABLE
        .iter()
        .find(|entry| entry.code == code)
        .map(|entry| Scancode::from_u8(entry.extended, entry.scancode))
}

/// 浏览器 `KeyboardEvent.code` 到 RDP Scancode 的映射表。
///
/// 遵循标准 PS/2 Set 1 扫描码转换规则，包括 Extended 位处理。
/// 这里仅表达“该物理键位对应哪个扫描码”，不负责 Unicode 字符输入判断。
pub const KEYBOARD_SCANCODE_TABLE: &[KeyboardScancodeEntry] = &[
    KeyboardScancodeEntry {
        code: "Escape",
        extended: false,
        scancode: 0x01,
    },
    KeyboardScancodeEntry {
        code: "Backquote",
        extended: false,
        scancode: 0x29,
    },
    KeyboardScancodeEntry {
        code: "Digit1",
        extended: false,
        scancode: 0x02,
    },
    KeyboardScancodeEntry {
        code: "Digit2",
        extended: false,
        scancode: 0x03,
    },
    KeyboardScancodeEntry {
        code: "Digit3",
        extended: false,
        scancode: 0x04,
    },
    KeyboardScancodeEntry {
        code: "Digit4",
        extended: false,
        scancode: 0x05,
    },
    KeyboardScancodeEntry {
        code: "Digit5",
        extended: false,
        scancode: 0x06,
    },
    KeyboardScancodeEntry {
        code: "Digit6",
        extended: false,
        scancode: 0x07,
    },
    KeyboardScancodeEntry {
        code: "Digit7",
        extended: false,
        scancode: 0x08,
    },
    KeyboardScancodeEntry {
        code: "Digit8",
        extended: false,
        scancode: 0x09,
    },
    KeyboardScancodeEntry {
        code: "Digit9",
        extended: false,
        scancode: 0x0A,
    },
    KeyboardScancodeEntry {
        code: "Digit0",
        extended: false,
        scancode: 0x0B,
    },
    KeyboardScancodeEntry {
        code: "Minus",
        extended: false,
        scancode: 0x0C,
    },
    KeyboardScancodeEntry {
        code: "Equal",
        extended: false,
        scancode: 0x0D,
    },
    KeyboardScancodeEntry {
        code: "Backspace",
        extended: false,
        scancode: 0x0E,
    },
    KeyboardScancodeEntry {
        code: "Tab",
        extended: false,
        scancode: 0x0F,
    },
    KeyboardScancodeEntry {
        code: "KeyQ",
        extended: false,
        scancode: 0x10,
    },
    KeyboardScancodeEntry {
        code: "KeyW",
        extended: false,
        scancode: 0x11,
    },
    KeyboardScancodeEntry {
        code: "KeyE",
        extended: false,
        scancode: 0x12,
    },
    KeyboardScancodeEntry {
        code: "KeyR",
        extended: false,
        scancode: 0x13,
    },
    KeyboardScancodeEntry {
        code: "KeyT",
        extended: false,
        scancode: 0x14,
    },
    KeyboardScancodeEntry {
        code: "KeyY",
        extended: false,
        scancode: 0x15,
    },
    KeyboardScancodeEntry {
        code: "KeyU",
        extended: false,
        scancode: 0x16,
    },
    KeyboardScancodeEntry {
        code: "KeyI",
        extended: false,
        scancode: 0x17,
    },
    KeyboardScancodeEntry {
        code: "KeyO",
        extended: false,
        scancode: 0x18,
    },
    KeyboardScancodeEntry {
        code: "KeyP",
        extended: false,
        scancode: 0x19,
    },
    KeyboardScancodeEntry {
        code: "BracketLeft",
        extended: false,
        scancode: 0x1A,
    },
    KeyboardScancodeEntry {
        code: "BracketRight",
        extended: false,
        scancode: 0x1B,
    },
    KeyboardScancodeEntry {
        code: "Enter",
        extended: false,
        scancode: 0x1C,
    },
    KeyboardScancodeEntry {
        code: "ControlLeft",
        extended: false,
        scancode: 0x1D,
    },
    KeyboardScancodeEntry {
        code: "KeyA",
        extended: false,
        scancode: 0x1E,
    },
    KeyboardScancodeEntry {
        code: "KeyS",
        extended: false,
        scancode: 0x1F,
    },
    KeyboardScancodeEntry {
        code: "KeyD",
        extended: false,
        scancode: 0x20,
    },
    KeyboardScancodeEntry {
        code: "KeyF",
        extended: false,
        scancode: 0x21,
    },
    KeyboardScancodeEntry {
        code: "KeyG",
        extended: false,
        scancode: 0x22,
    },
    KeyboardScancodeEntry {
        code: "KeyH",
        extended: false,
        scancode: 0x23,
    },
    KeyboardScancodeEntry {
        code: "KeyJ",
        extended: false,
        scancode: 0x24,
    },
    KeyboardScancodeEntry {
        code: "KeyK",
        extended: false,
        scancode: 0x25,
    },
    KeyboardScancodeEntry {
        code: "KeyL",
        extended: false,
        scancode: 0x26,
    },
    KeyboardScancodeEntry {
        code: "Semicolon",
        extended: false,
        scancode: 0x27,
    },
    KeyboardScancodeEntry {
        code: "Quote",
        extended: false,
        scancode: 0x28,
    },
    KeyboardScancodeEntry {
        code: "ShiftLeft",
        extended: false,
        scancode: 0x2A,
    },
    KeyboardScancodeEntry {
        code: "Backslash",
        extended: false,
        scancode: 0x2B,
    },
    KeyboardScancodeEntry {
        code: "IntlBackslash",
        extended: false,
        scancode: 0x56,
    },
    KeyboardScancodeEntry {
        code: "KeyZ",
        extended: false,
        scancode: 0x2C,
    },
    KeyboardScancodeEntry {
        code: "KeyX",
        extended: false,
        scancode: 0x2D,
    },
    KeyboardScancodeEntry {
        code: "KeyC",
        extended: false,
        scancode: 0x2E,
    },
    KeyboardScancodeEntry {
        code: "KeyV",
        extended: false,
        scancode: 0x2F,
    },
    KeyboardScancodeEntry {
        code: "KeyB",
        extended: false,
        scancode: 0x30,
    },
    KeyboardScancodeEntry {
        code: "KeyN",
        extended: false,
        scancode: 0x31,
    },
    KeyboardScancodeEntry {
        code: "KeyM",
        extended: false,
        scancode: 0x32,
    },
    KeyboardScancodeEntry {
        code: "Comma",
        extended: false,
        scancode: 0x33,
    },
    KeyboardScancodeEntry {
        code: "Period",
        extended: false,
        scancode: 0x34,
    },
    KeyboardScancodeEntry {
        code: "Slash",
        extended: false,
        scancode: 0x35,
    },
    KeyboardScancodeEntry {
        code: "ShiftRight",
        extended: false,
        scancode: 0x36,
    },
    KeyboardScancodeEntry {
        code: "AltLeft",
        extended: false,
        scancode: 0x38,
    },
    KeyboardScancodeEntry {
        code: "Space",
        extended: false,
        scancode: 0x39,
    },
    KeyboardScancodeEntry {
        code: "CapsLock",
        extended: false,
        scancode: 0x3A,
    },
    KeyboardScancodeEntry {
        code: "F1",
        extended: false,
        scancode: 0x3B,
    },
    KeyboardScancodeEntry {
        code: "F2",
        extended: false,
        scancode: 0x3C,
    },
    KeyboardScancodeEntry {
        code: "F3",
        extended: false,
        scancode: 0x3D,
    },
    KeyboardScancodeEntry {
        code: "F4",
        extended: false,
        scancode: 0x3E,
    },
    KeyboardScancodeEntry {
        code: "F5",
        extended: false,
        scancode: 0x3F,
    },
    KeyboardScancodeEntry {
        code: "F6",
        extended: false,
        scancode: 0x40,
    },
    KeyboardScancodeEntry {
        code: "F7",
        extended: false,
        scancode: 0x41,
    },
    KeyboardScancodeEntry {
        code: "F8",
        extended: false,
        scancode: 0x42,
    },
    KeyboardScancodeEntry {
        code: "F9",
        extended: false,
        scancode: 0x43,
    },
    KeyboardScancodeEntry {
        code: "F10",
        extended: false,
        scancode: 0x44,
    },
    KeyboardScancodeEntry {
        code: "NumLock",
        extended: false,
        scancode: 0x45,
    },
    KeyboardScancodeEntry {
        code: "ScrollLock",
        extended: false,
        scancode: 0x46,
    },
    KeyboardScancodeEntry {
        code: "F11",
        extended: false,
        scancode: 0x57,
    },
    KeyboardScancodeEntry {
        code: "F12",
        extended: false,
        scancode: 0x58,
    },
    KeyboardScancodeEntry {
        code: "Numpad7",
        extended: false,
        scancode: 0x47,
    },
    KeyboardScancodeEntry {
        code: "Numpad8",
        extended: false,
        scancode: 0x48,
    },
    KeyboardScancodeEntry {
        code: "Numpad9",
        extended: false,
        scancode: 0x49,
    },
    KeyboardScancodeEntry {
        code: "NumpadSubtract",
        extended: false,
        scancode: 0x4A,
    },
    KeyboardScancodeEntry {
        code: "Numpad4",
        extended: false,
        scancode: 0x4B,
    },
    KeyboardScancodeEntry {
        code: "Numpad5",
        extended: false,
        scancode: 0x4C,
    },
    KeyboardScancodeEntry {
        code: "Numpad6",
        extended: false,
        scancode: 0x4D,
    },
    KeyboardScancodeEntry {
        code: "NumpadAdd",
        extended: false,
        scancode: 0x4E,
    },
    KeyboardScancodeEntry {
        code: "Numpad1",
        extended: false,
        scancode: 0x4F,
    },
    KeyboardScancodeEntry {
        code: "Numpad2",
        extended: false,
        scancode: 0x50,
    },
    KeyboardScancodeEntry {
        code: "Numpad3",
        extended: false,
        scancode: 0x51,
    },
    KeyboardScancodeEntry {
        code: "Numpad0",
        extended: false,
        scancode: 0x52,
    },
    KeyboardScancodeEntry {
        code: "NumpadDecimal",
        extended: false,
        scancode: 0x53,
    },
    KeyboardScancodeEntry {
        code: "PrintScreen",
        extended: true,
        scancode: 0x37,
    },
    KeyboardScancodeEntry {
        code: "Pause",
        extended: false,
        scancode: 0x45,
    },
    KeyboardScancodeEntry {
        code: "NumpadMultiply",
        extended: false,
        scancode: 0x37,
    },
    KeyboardScancodeEntry {
        code: "NumpadDivide",
        extended: true,
        scancode: 0x35,
    },
    KeyboardScancodeEntry {
        code: "NumpadEnter",
        extended: true,
        scancode: 0x1C,
    },
    KeyboardScancodeEntry {
        code: "NumpadEqual",
        extended: false,
        scancode: 0x59,
    },
    KeyboardScancodeEntry {
        code: "Home",
        extended: true,
        scancode: 0x47,
    },
    KeyboardScancodeEntry {
        code: "ArrowUp",
        extended: true,
        scancode: 0x48,
    },
    KeyboardScancodeEntry {
        code: "PageUp",
        extended: true,
        scancode: 0x49,
    },
    KeyboardScancodeEntry {
        code: "ArrowLeft",
        extended: true,
        scancode: 0x4B,
    },
    KeyboardScancodeEntry {
        code: "ArrowRight",
        extended: true,
        scancode: 0x4D,
    },
    KeyboardScancodeEntry {
        code: "End",
        extended: true,
        scancode: 0x4F,
    },
    KeyboardScancodeEntry {
        code: "ArrowDown",
        extended: true,
        scancode: 0x50,
    },
    KeyboardScancodeEntry {
        code: "PageDown",
        extended: true,
        scancode: 0x51,
    },
    KeyboardScancodeEntry {
        code: "Insert",
        extended: true,
        scancode: 0x52,
    },
    KeyboardScancodeEntry {
        code: "Delete",
        extended: true,
        scancode: 0x53,
    },
    KeyboardScancodeEntry {
        code: "MetaLeft",
        extended: true,
        scancode: 0x5B,
    },
    KeyboardScancodeEntry {
        code: "MetaRight",
        extended: true,
        scancode: 0x5C,
    },
    KeyboardScancodeEntry {
        code: "ContextMenu",
        extended: true,
        scancode: 0x5D,
    },
    KeyboardScancodeEntry {
        code: "ControlRight",
        extended: true,
        scancode: 0x1D,
    },
    KeyboardScancodeEntry {
        code: "AltRight",
        extended: true,
        scancode: 0x38,
    },
];

#[cfg(test)]
mod tests {
    use super::code_to_scancode;

    #[test]
    fn maps_basic_control_keys() {
        assert!(code_to_scancode("Tab").is_some());
        assert!(code_to_scancode("Enter").is_some());
        assert!(code_to_scancode("Backspace").is_some());
        assert!(code_to_scancode("Escape").is_some());
    }
}
