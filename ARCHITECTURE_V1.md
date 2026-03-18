# FluxTerm 架构 v1

## 概述

FluxTerm 是一款面向 SSH 连接并支持 SFTP 的现代化终端工具。  
平台优先级为 Windows 与 macOS 同级，Linux 次之。

## 目标

- 提供稳定的 SSH 连接与交互式终端会话。
- 提供 SFTP 传输与基础文件管理能力。
- 连接与会话逻辑只保留一套核心引擎。
- 保持统一视觉体系（主题、背景图、透明度）并支持跨窗口一致性。
- 采用模块化架构，保证职责清晰、边界稳定、可维护。

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

#### SFTP 传输执行模型

- 批量上传/下载采用流水线：`Scanner -> TaskQueue -> WorkerPool -> ProgressAggregator`。
- 扫描与传输并行，避免全量预扫描阻塞。
- 文件级并发与窗口化读取降低高延迟链路损耗。
- 远端目录按需创建并缓存去重，减少重复往返。

### `src-tauri`

桌面 GUI 外壳。

- 连接 GUI 与 `engine`。
- 向前端暴露 Rust 命令接口。
- 管理窗口能力权限与原生窗口行为。

### `frontend`

React 前端采用“领域能力 + 运行单元壳层”结构：

- `src/features`：会话、终端、SFTP、AI 等领域能力。
- `src/main`：主窗口壳层（布局编排、菜单、窗口管理）。
- `src/widgets`：可停靠/可浮动的 Widget 适配层。
- `src/subapps`：独立子应用窗口壳层与入口。
- `src/components/ui`：跨运行单元复用的基础 UI 组件。

通用约束：

- 业务逻辑优先沉淀在 `features`。
- 常量统一放 `src/constants`。
- Hook 默认放 `src/hooks`，运行单元专属 Hook 下沉到对应目录。
- 运行单元术语统一为 `Main / Widget / SubApp`。

## 数据流

1. 用户在 GUI 中选择主机配置。
2. GUI 调用 `engine` 建立 SSH 会话。
3. 终端数据在远端与 UI 之间流动。
4. SFTP 请求经由 `engine` 处理并返回结构化结果。

## 配置与存储

- 配置根目录由 `src-tauri/src/config_paths.rs` 解析。
- 应用运行数据存放于 `app_data_dir`。
- 凭据采用本地 Provider 加密存储。

## 安全性考虑

- SSH 主机身份校验由应用独立维护。
- SSH 连接与资源监控连接遵循统一主机校验策略。
- 尽量避免存储明文密码。
- SFTP 操作范围限制在明确目标路径。

## 平台说明

- Windows 与 macOS 为第一优先级，优先保证测试与体验。
- Linux 支持需避免平台特化假设。

## 文档索引（按职责）

- `docs/window-app-model.md`：窗口模型、生命周期协议、目录归属（唯一细则来源）。
- `docs/terminal-split-workspace-design.md`：终端拆分工作区与会话重建策略。
- `docs/security-crypto-refactor-design.md`：加密模块与凭据存储设计。
