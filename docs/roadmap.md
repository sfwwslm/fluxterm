# FluxTerm 路线图

本文档记录 FluxTerm 的主要能力方向与阶段性优先级，仅面向后续规划内容。已发布能力以 `CHANGELOG.md` 为准。

## 当前规划

### P1 SSH Profile 高级连接能力

目标：为所有 SSH Profile 提供更完整的连接配置能力，使手动添加与导入生成的配置在连接行为上保持一致，并逐步支持跳板机、代理、主机密钥校验与多密钥等高级能力。

下一步：

- 明确需要纳入 SSH Profile 编辑界面的高级字段
- 梳理高级字段从 Profile 到连接链路的传递与生效方式
- 规划 `ProxyJump`、`ProxyCommand`、多 `IdentityFile`、`UserKnownHostsFile`、`StrictHostKeyChecking`、`AddKeysToAgent` 的分阶段支持范围
- 补充独立设计文档

### P2 串口功能

目标：基于 `tokio-serial` 增加串口连接能力，支持本地串口设备调试与终端交互。

下一步：

- 明确串口连接配置项
- 评估如何复用现有终端能力
- 补充独立设计文档

### P3 远程桌面功能

目标：基于 `IronRDP` 增加远程桌面访问能力，扩展 FluxTerm 的远程运维场景。

下一步：

- 已确认使用 `SubApp` 承载
- 当前实现已落地为 `src-tauri` 编排 + `crates/rdp_core` 进程内 runtime + 本地 WebSocket bridge
- 主窗口继续负责 Profile 管理与发起连接，RDP 子应用继续负责运行态与画面显示
- 当前阶段优先稳固基础能力，包括国际化、telemetry、注释收敛、文档同步与冗余清理
- 按 `docs/rdp-subapp-design.md` 持续推进实施与记录进度
