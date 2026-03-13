# ![FluxTerm Logo](./src-tauri/icons/32x32.png) FluxTerm

FluxTerm 是一个基于 `Tauri + Rust + React` 构建的现代桌面终端，统一提供 SSH、本地 Shell、SFTP 与 AI 协作体验。

它面向需要同时处理远端连接、文件传输、终端工作区和上下文辅助的桌面使用场景，重点强调一致的交互模型、清晰的状态边界和可维护的系统架构。

## 核心特性

- 统一的 SSH、本地 Shell 与 SFTP 桌面工作流
- 支持终端拆分、多区域工作区与区域级会话管理
- 提供文件浏览、上传、下载、目录下载与传输进度展示
- 支持命令历史、自动补全与浮动面板同步
- 提供 AI 助手、终端上下文拼装与对话协作能力
- 采用 Main / Widget / SubApp 分层窗口模型

## 项目状态

FluxTerm 目前处于公开预览阶段。核心能力已具备可演示和持续迭代的基础，但部分功能、配置项与文档仍会继续整理和演进。

## 设计参考

在 UI 交互与设置体验上，FluxTerm 参考了 [WindTerm](https://github.com/kingToolbox/WindTerm) 对终端工具工作流的组织方式，尤其是会话管理、终端工作区、文件侧边能力与设置项分层等方向。

FluxTerm 的目标不是复刻 WindTerm，而是在 Tauri、Rust 与 React 的技术栈下，围绕统一状态模型、窗口边界和可维护架构，形成自己的桌面终端体验。

## 技术栈

- Rust `edition 2024`
- Tauri `v2`
- React `19`
- TypeScript `5`
- Vite `7`
- pnpm
- russh / russh-sftp
- xterm.js `6`

## 快速开始

### 环境要求

- Node.js `18+`
- pnpm `10+`
- Rust 稳定版工具链
- Tauri v2 所需的本地开发依赖

### 安装依赖

```bash
pnpm install
```

### 启动前端开发环境

```bash
pnpm dev
```

### 启动桌面应用

```bash
pnpm tauri dev
```

### 构建

```bash
pnpm web:build
pnpm build
```

## 常用开发命令

```bash
pnpm check
pnpm web:build
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
pnpm code:stats
```

`pnpm code:stats` 用于统计当前项目代码文件的总代码行数、注释行数、空行数和按语言汇总。

## 项目结构

```text
fluxterm/
├── crates/
│   ├── engine/              # SSH / SFTP / 会话核心引擎
│   └── openai/              # OpenAI 集成能力
├── docs/                    # 设计文档与专题说明
├── scripts/                 # 项目脚本
├── src/                     # 前端 React + TypeScript
├── src-tauri/               # Tauri 桌面壳与命令层
├── ARCHITECTURE_V1.md       # 架构总览
├── CHANGELOG.md             # 变更日志
└── README.md
```

## 架构概览

### `crates/engine`

负责 SSH 认证、终端会话读写、SFTP 传输、资源监控与事件分发。

### `crates/openai`

负责 OpenAI API 客户端封装、请求响应类型、提示词组织与上下文拼装。

### `src-tauri`

负责桌面命令层、系统能力桥接、配置持久化、本地 Shell 集成和安全模块。

### `src`

负责主窗口布局、窗口生命周期编排、Widget/SubApp 渲染，以及会话与交互状态管理。

## 主要能力

- SSH 主机配置管理与导入
- 本地 Shell 启动与统一终端交互
- 终端区域拆分与区域级工作区栏
- SFTP 文件浏览、目录下载、取消传输与进度聚合展示
- 资源监控与底部状态展示
- 命令历史与自动补全
- Proxy 子应用与跨窗口事件联动
- AI 助手、上下文选择与对话协作

## 文档入口

- [架构总览](./ARCHITECTURE_V1.md)
- [文档索引](./docs/README.md)
- [窗口与应用模型](./docs/window-app-model.md)
- [终端拆分工作区设计](./docs/terminal-split-workspace-design.md)
- [SSH 会话与资源监控](./docs/ssh-session-and-monitoring.md)
- [AI 上下文契约](./docs/ai-context-contract.md)

## 贡献

欢迎通过 Issue 和 Pull Request 参与改进。提交前建议至少完成以下检查：

- `pnpm check`
- `pnpm web:build`
- `cargo fmt`
- `cargo clippy --all-targets --all-features -- -D warnings`
