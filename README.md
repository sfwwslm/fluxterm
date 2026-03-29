# ![FluxTerm Logo](./src-tauri/icons/32x32.png) FluxTerm

FluxTerm 是一个基于 `Tauri + Rust + React` 构建的现代桌面终端，统一提供 SSH、本地 Shell、SFTP、RDP 远程桌面与终端 AI 协作能力。

产品面向需要同时处理远端连接、文件传输、终端工作区与上下文辅助的桌面场景，强调一致的交互模型、清晰的状态边界与可维护的系统架构。

## 核心特性

- 在同一套桌面工作流中统一处理 SSH、本地 Shell、SFTP 与 RDP 远程访问
- 通过终端拆分、多区域工作区与区域级会话管理承载更复杂的并行操作场景
- 将文件浏览、传输进度与远程桌面入口收拢到一致的桌面交互模型中
- 提供命令历史、自动补全、浮动面板同步与终端 AI 协作能力，降低重复操作成本
- 以 Main / Widget / SubApp 分层窗口模型组织复杂桌面能力，保持清晰的状态边界

## 设计参考

FluxTerm 在终端交互与设置体验上参考了 [WindTerm](https://github.com/kingToolbox/WindTerm) 对桌面终端工作流的组织方式，重点吸收会话管理、终端工作区、文件侧边能力与设置分层等思路。

项目目标并非复刻既有产品，而是在 `Tauri`、`Rust` 与 `React` 技术栈下，构建具有统一状态模型、明确窗口边界与长期可维护性的桌面终端体验。

## 贡献

欢迎通过 Issue 与 Pull Request 参与改进。提交前建议至少完成以下检查：

- `pnpm format:all`
- `pnpm check:all`
