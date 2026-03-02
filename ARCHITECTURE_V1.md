# FluxTerm 架构 v1

## 概述

FluxTerm 是一款面向 SSH 连接并支持 SFTP 的现代化终端工具。
平台优先级为 Windows 与 macOS 同级，Linux 次之。

## 目标

- 提供稳定的 SSH 连接与交互式终端会话。
- 提供 SFTP 传输与基础文件管理能力。
- 连接与会话逻辑只保留一套核心引擎。
- 视觉风格统一为玻璃拟态轻奢：强调透明层次、细腻高光与质感边框，保持一致的光影与层级规范。
- 代码设计采用模块化：各功能模块职责清晰、边界稳定、可替换与可复用，避免跨层耦合。

## 非目标（v1）

- Mosh 风格的 UDP 传输。
- 完整的终端复用器功能（tmux 替代）。
- 插件市场或脚本运行时。

## 总体架构

```text
frontend (React/Vite)  --->  tauri (Rust)  --->  engine (Rust)
```

## 模块说明

### `crates/engine`

核心连接与文件传输引擎。

- SSH 客户端：认证、会话、终端 I/O。
- SFTP 客户端：列出/上传/下载/重命名/删除。
- 会话生命周期、重试与超时抽象。

### `src-tauri`

桌面 GUI 外壳。

- 连接 GUI 与 `engine`。
- 向前端暴露 Rust 命令接口。

### `frontend`

会话管理与终端视图的 React UI。

- 使用 xterm 渲染终端。
- 主机配置与 SFTP 文件浏览界面。

#### 前端分层（2026-02 重构）

- `src/app`：应用编排层。
  - `AppRoot` 只作为根入口。
  - `AppShell` 负责组装各域 Controller、布局与弹窗。
  - `theme/themePresets.ts` 统一主题定义。
  - `panels/buildPanels.tsx` 统一工作区面板装配。
- `src/features/session`：会话域入口与状态控制。
  - `useSessionController` 对外暴露 `sessionState/sessionRefs/sessionActions`。
- `src/features/terminal`：终端域入口与行为控制。
  - `useTerminalController` 对外暴露 `terminalQuery/terminalActions`。
- `src/features/sftp`：文件域入口与行为控制。
  - `useSftpController` 对外暴露 `sftpState/sftpActions`。

设计原则：

- 保持 UI 组件只消费领域接口，避免直接依赖底层实现细节。
- 优先通过 Controller 组合能力，减少顶层组件中的跨域耦合。
- 重构阶段保留兼容封装，逐步将大 Hook 内部逻辑下沉到 feature/core。

相关设计文档：

- `docs/terminal-split-workspace-design.md`：终端拆分工作区、区域工作区栏与会话重建策略设计。

## 前端布局规则

- 开发阶段采用破坏性重构策略，不考虑旧布局配置兼容，优先保证结构清晰与可维护性。
- 布局固定为 7 区域：`top` 标题区、`center` 终端主区、`left-top`、`left-bottom`、`right-top`、`right-bottom`、`bottom`。
- `center` 区域始终显示 terminal 主区域，不允许被组件覆盖。
- 左右两侧为组件容器区域，支持两种模式：
  - 单槽模式：整列只显示 1 个组件。
  - 双槽模式：上下拆分显示 2 个组件。
- 底部区域容纳 1 个组件。
- 组件支持通过标题区下拉切换显示。
- 组件支持拖拽重排：
  - 拖拽到空槽位时直接迁移。
  - 拖拽到已有组件的槽位时与目标槽位合并为组件组。
- 组件组内同一时刻只显示 1 个组件，通过标题区下拉切换。
- 组件全局唯一，同一组件不可在多个槽位或多个组件组中重复出现。
- 当左侧或右侧容器无可显示组件时，该容器自动收起并将空间让渡给 `center`。
- 左右容器高度始终等于窗口总高度减去 `top` 与 `bottom`（含分割条）后的剩余高度。
- 组件支持“悬浮”能力：点击悬浮按钮后在独立窗口展示，主布局中对应组件槽位自动释放。

## 数据流

1. 用户在 GUI 中选择主机配置。
2. GUI 调用 `engine` 建立 SSH 会话。
3. 终端数据在远端与 UI 之间流动。
4. SFTP 请求经由 `engine` 处理并返回结构化结果。

## 配置与存储

- 配置数据存放于 `$HOME/.vust/flux-term`，按 `global` 与 `terminal` 子目录区分应用级配置和终端域配置。
- 应用使用数据存放于 `app_data_dir`，例如远端文件下载缓存。
- 凭据优先使用系统钥匙串，无法使用时回退到本地加密存储。

## 安全性考虑

- 首次连接进行主机指纹校验并持久化。
- 尽量避免存储明文密码。
- SFTP 操作范围限制在明确的目标路径。

## 平台说明

- Windows 与 macOS 为第一优先级，优先保证测试与体验。
- Linux 支持需避免平台特化假设。

## 依赖（初始）

- Rust：SSH 采用 russh，SFTP 使用其配套实现。
- 前端：React、styled-components、xterm。
- Tauri：用于桌面打包与原生能力。

## 接口契约

### Tauri 命令（frontend -> tauri -> engine）

- `profile.list`：返回主机配置列表。
- `profile.save`：新增或更新主机配置，返回保存后的配置。
- `profile.remove`：删除主机配置，返回是否成功。
- `ssh.connect`：建立会话，返回 `sessionId`。
- `ssh.disconnect`：关闭会话。
- `ssh.resize`：调整终端尺寸。
- `sftp.list`：列出目录内容（支持分页/游标）。
- `sftp.upload`：上传文件（支持进度事件）。
- `sftp.download`：下载文件（支持进度事件）。
- `sftp.rename` / `sftp.remove` / `sftp.mkdir`：基础文件操作。

### 事件通道（tauri -> frontend）

- `terminal.output`：终端输出数据（按 sessionId 推送）。
- `terminal.exit`：远端会话结束。
- `sftp.progress`：上传/下载进度更新。
- `session.status`：连接状态变化（connecting/connected/disconnected/error）。

### 错误约定

- 统一错误结构：`code`、`message`、`detail`。
- 网络类错误可重试，认证/主机指纹错误不可自动重试。

## 数据模型

### 主机配置（HostProfile）

- `id`：唯一标识。
- `name`：显示名称。
- `host`：主机地址。
- `port`：端口号。
- `username`：用户名。
- `authType`：认证方式（password/key/agent）。
- `keyPath`：密钥路径（可选）。
- `keyPassphraseRef`：密钥口令引用（可选）。
- `passwordRef`：密码引用（可选）。
- `knownHost`：主机指纹记录（可选）。
- `tags`：标签（可选）。

### 会话（Session）

- `sessionId`：会话标识。
- `profileId`：关联的主机配置。
- `state`：状态（connecting/connected/disconnected/error）。
- `createdAt`：创建时间。
- `lastError`：最近一次错误（可选）。

### SFTP 条目（SftpEntry）

- `path`：完整路径。
- `name`：名称。
- `kind`：类型（file/dir/link）。
- `size`：字节大小（可选）。
- `mtime`：修改时间（可选）。
- `permissions`：权限字符串（可选）。

### 配置版本

- `version`：配置版本号，用于迁移。
- `updatedAt`：最后更新时间。

## 待决问题

- russh 的 SFTP 能力与稳定性边界如何评估？
- 主机指纹存储位置与格式？
