# ![FluxTerm Logo](./src-tauri/icons/32x32.png) FluxTerm

FluxTerm 是一个基于 `Tauri + Rust + React` 的现代终端桌面应用，当前重点围绕：

- SSH 会话连接与重连
- 多区域终端工作区与拆分
- SFTP 文件浏览、上传、下载与传输进度
- 本地 Shell 与远端终端统一交互体验
- AI 助手与终端上下文协作

当前阶段为 `Alpha`，开发策略以干净重构和清晰架构优先，不考虑旧版本兼容。

## 技术栈

- Rust `edition 2024`
- Tauri `v2`
- React `19`
- TypeScript `5`
- Vite `7`
- pnpm
- russh / russh-sftp
- xterm.js `6`

## 当前项目结构

```text
fluxterm/
├── crates/
│   ├── engine/              # SSH / SFTP / 会话核心引擎
│   └── openai/              # OpenAI 集成能力（客户端、类型、提示词）
├── docs/                    # 设计文档与专题说明
├── scripts/                 # 项目脚本（如代码统计）
├── src/                     # 前端 React + TypeScript
├── src-tauri/               # Tauri 桌面壳与命令层
├── AGENTS.md                # 仓库协作与开发约束
├── ARCHITECTURE_V1.md       # 当前架构总览
├── CHANGELOG.md             # 变更日志
└── README.md
```

## 架构分层

### `crates/engine`

核心能力层，负责：

- SSH 认证与连接
- 终端会话读写
- SFTP 文件操作与传输
- 资源监控与事件分发

### `crates/openai`

AI 能力层，负责：

- OpenAI API 客户端封装
- 请求/响应类型定义
- Prompt 组织与上下文拼装
- AI 相关遥测与错误处理

### `src-tauri`

桌面命令层与系统能力桥接，负责：

- 暴露 Tauri 命令
- 主机配置持久化
- 本地 Shell 集成
- 安全模块与凭据加解密
- 把 `engine` / `openai` 事件转发给前端

### `src`

前端界面与状态编排层，负责：

- 主窗口布局与窗口生命周期编排
- Widget 渲染（终端、主机、文件、传输、事件、历史、AI、隧道）
- SubApp 渲染（如代理窗口）
- 会话状态、SFTP 状态与交互体验

## 当前主要能力

- SSH 主机配置管理
- 本地 Shell 启动
- 终端区域拆分与区域级工作区栏
- 会话重连与退出提示
- SFTP 文件列表、目录下载、取消传输
- 传输进度聚合展示
- 资源监控与底部状态展示
- 命令历史与自动补全
- 代理（Proxy）子应用与事件联动
- AI 助手（配置、上下文、对话）

## 常用命令

### 前端开发

```bash
pnpm dev
pnpm check
pnpm web:build
```

### 桌面应用

```bash
pnpm tauri dev
pnpm build
```

### Rust 检查

```bash
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
```

### 辅助脚本

```bash
pnpm code:stats
```

用于统计当前项目代码文件的总代码行数、注释行数、空行数和按语言汇总。

## 文档导航

- [ARCHITECTURE_V1.md](./ARCHITECTURE_V1.md)：项目架构总览
- [AGENTS.md](./AGENTS.md)：仓库协作规范与开发约束
- [docs/window-app-model.md](./docs/window-app-model.md)：Main / Widget / SubApp 窗口模型与边界
- [docs/floating-panel-snapshot-pattern.md](./docs/floating-panel-snapshot-pattern.md)：浮动窗口快照同步模式
- [docs/terminal-split-workspace-design.md](./docs/terminal-split-workspace-design.md)：终端拆分工作区设计
- [docs/terminal-sftp-path-sync-design.md](./docs/terminal-sftp-path-sync-design.md)：终端路径联动设计
- [docs/ssh-session-and-monitoring.md](./docs/ssh-session-and-monitoring.md)：SSH 会话与资源监控说明
- [docs/ssh-config-import-design.md](./docs/ssh-config-import-design.md)：SSH 配置导入设计
- [docs/file-open-v1-design.md](./docs/file-open-v1-design.md)：文件打开能力设计
- [docs/security-crypto-refactor-design.md](./docs/security-crypto-refactor-design.md)：公共加密模块设计
- [docs/openai-integration-design.md](./docs/openai-integration-design.md)：OpenAI 集成设计
- [docs/ai-context-contract.md](./docs/ai-context-contract.md)：AI 上下文契约与边界
- [docs/history-and-autocomplete.md](./docs/history-and-autocomplete.md)：命令历史与自动补全
- [docs/sftp-log-events.md](./docs/sftp-log-events.md)：SFTP 日志与事件说明
- [docs/telemetry-logging-spec.md](./docs/telemetry-logging-spec.md)：遥测日志规范
- [docs/terminal-performance-benchmark.md](./docs/terminal-performance-benchmark.md)：终端性能基准记录
- [docs/proxy-performance-benchmark.md](./docs/proxy-performance-benchmark.md)：代理性能基准记录

## 说明

- `README` 以当前仓库真实结构为准
- 更细的设计与边界说明请优先查看 `docs/` 和 `ARCHITECTURE_V1.md`
