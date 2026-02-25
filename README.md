# 简介

FluxTerm：Flux 是流动、变换，强调动态与现代感的终端

## 技术栈

- Rust（edition 2024）
- Tauri v2
- Vite + React
- TypeScript
- pnpm
- russh + russh-sftp
- xterm.js 6

## 🏗️ 项目结构概览

```text
flux-term/
├── crates/
│   ├── engine/        # 核心引擎 ssh sftp 等
│   ├── cli/           # 命令行入口（TUI CLI）
│   └── tauri/         # GUI 壳（可插拔）
├── src/               # 前端工程
├── ARCHITECTURE_V1.md # 架构宪法
├── CONTRIBUTING.md    # 贡献与约束规则
└── README.md
```

---

## 📄 文档导航（必读）

- **架构设计** 👉 [`ARCHITECTURE_V1.md`](./ARCHITECTURE_V1.md)

- **贡献规则（强制）** 👉 [`CONTRIBUTING.md`](./CONTRIBUTING.md)

- **核心引擎说明** 👉 [`crates/engine/README.md`](./crates/engine/README.md)
