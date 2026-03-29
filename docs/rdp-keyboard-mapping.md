# FluxTerm RDP 键盘映射设计

## 1. 目标

本文档定义 FluxTerm RDP 子应用的键盘输入策略，目标是：

- 不再按单个异常键位打补丁
- 用统一映射表覆盖主键区、控制键、导航键、功能键和小键盘
- 明确哪些输入走 Unicode，哪些输入走 RDP 扫描码

## 2. 设计原则

### 2.1 分层处理

键盘输入分成两层：

1. 前端事件归一化
2. sidecar 扫描码映射

前端负责：

- 采集 `keydown` / `keyup`
- 传递 `KeyboardEvent.code`
- 传递 `key`
- 传递 `ctrlKey` / `shiftKey` / `altKey` / `metaKey`
- 维护本地已按下键集合
- 在失焦时补发 `key_up`

sidecar 负责：

- `KeyboardEvent.code -> RDP Scancode`
- 可打印字符的 Unicode 输入
- 控制键、导航键、功能键、小键盘的扫描码输入

### 2.2 为什么以 `code` 为主

`KeyboardEvent.key` 会被键盘布局影响，适合做文本输入。  
`KeyboardEvent.code` 表示物理键位，更适合远程桌面控制键与组合键。

因此：

- 可打印字符优先走 `Unicode`
- 非打印控制键优先走 `code -> scancode`

## 3. 输入策略

### 3.1 Unicode 路径

以下条件满足时，优先发送 Unicode：

- 没有 `Ctrl`
- 没有 `Alt`
- 没有 `Meta`
- `key` 为单字符
- 不是控制字符

适用示例：

- `a`
- `A`
- `1`
- `!`
- `中`

### 3.2 扫描码路径

以下类型统一走扫描码：

- `Tab`
- `Enter`
- `Backspace`
- `Escape`
- `Shift` / `Ctrl` / `Alt` / `Meta`
- 方向键
- `Home` / `End` / `PageUp` / `PageDown`
- `Insert` / `Delete`
- `F1-F12`
- 小键盘
- `ContextMenu`
- `PrintScreen`
- `Pause`

## 4. 当前映射分组

### 4.1 主键区

- `` Backquote ``
- `Digit0-9`
- `Minus`
- `Equal`
- `Backspace`
- `Tab`
- `KeyA-Z`
- `BracketLeft`
- `BracketRight`
- `Backslash`
- `IntlBackslash`
- `Semicolon`
- `Quote`
- `Comma`
- `Period`
- `Slash`
- `Space`

### 4.2 修饰键与控制键

- `Escape`
- `Enter`
- `ControlLeft`
- `ControlRight`
- `ShiftLeft`
- `ShiftRight`
- `AltLeft`
- `AltRight`
- `MetaLeft`
- `MetaRight`
- `CapsLock`
- `ContextMenu`

### 4.3 功能键

- `F1-F12`
- `PrintScreen`
- `ScrollLock`
- `Pause`

### 4.4 导航编辑键

- `Insert`
- `Delete`
- `Home`
- `End`
- `PageUp`
- `PageDown`
- `ArrowUp`
- `ArrowDown`
- `ArrowLeft`
- `ArrowRight`

### 4.5 小键盘

- `NumLock`
- `Numpad0-9`
- `NumpadAdd`
- `NumpadSubtract`
- `NumpadMultiply`
- `NumpadDivide`
- `NumpadDecimal`
- `NumpadEnter`
- `NumpadEqual`

## 5. 当前暂不承诺的特殊键

以下键位在浏览器、系统或远端会话中可能存在额外拦截，不作为当前阶段的强保证项：

- `Alt+Tab`
- `Ctrl+Alt+Delete`
- 浏览器/系统保留快捷键
- 媒体键
- 启动器键
- 厂商扩展热键

这些键不是没有映射价值，而是需要结合宿主窗口和系统快捷键策略单独处理。

## 6. 实施规则

后续若出现新的键盘问题，排查顺序固定为：

1. 前端是否收到 `keydown/keyup`
2. 前端失焦时是否已补发 `key_up`
3. sidecar 映射表是否已覆盖对应 `code`
4. 该键应走 Unicode 还是扫描码
5. 是否属于系统保留快捷键

不再接受“直接对某个键写特判但不补文档”的做法。
