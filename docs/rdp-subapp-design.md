# FluxTerm RDP 子应用设计

## 1. 文档目标

本文档定义 FluxTerm `RDP SubApp` 的实现边界、运行时拆分、通信契约、实施阶段与进度记录。

本文档同时记录两个阶段性的架构决策：

- `2026-03-26` 起，RDP 首版采用“独立 crate sidecar”方案
- 原因不是窗口模型或产品形态本身要求，而是当前 `IronRDP` 与主工程安全依赖链存在冲突
- `2026-03-27` 起，专用分支开始验证“回收进 workspace，但继续使用独立 crate 管理运行时”的新方案
- 后续如果依赖冲突被稳定消除，RDP 运行时优先回收至 `crates/rdp_runtime`，而不是重新散落回 `src-tauri`

## 2. 背景与决策

### 2.1 产品目标

FluxTerm 需要在独立子窗口中提供远程桌面访问能力，满足以下要求：

- 远程画面在浏览器窗口中渲染
- 支持键盘、鼠标、滚轮输入
- 支持窗口尺寸同步与动态分辨率
- 支持基础剪贴板与证书确认
- 生命周期遵循现有 `SubApp` 模型，不进入 Main 布局容器

### 2.2 为什么不先直接接入 `src-tauri`

`2026-03-26` 的实际验证结果表明，当前可发布版 `IronRDP 0.14.0` 与仓库现有 SSH 依赖链在密码学预发布依赖上存在求解冲突，核心涉及：

- `IronRDP -> ironrdp-connector -> picky`
- `russh -> internal-russh-forked-ssh-key -> rsa / sha1 / signature / der`

这些依赖链要求的预发布版本集合不一致，导致 Cargo 无法在同一工作区内稳定求解。

因此当前不适合：

- 直接把真实 `IronRDP` 运行时塞进 `src-tauri`
- 为了接入 RDP 而大规模改写 SSH 栈或全局密码学依赖

### 2.3 当前架构决策

当前决定采用：

- `RDP sidecar` 独立 crate
- 与主 workspace 解耦构建
- 通过本地 IPC / WebSocket 与 `src-tauri` / 前端子应用通信

当前专用实验分支同时在验证：

- 将真实运行时回收到 workspace 内的 `crates/rdp_runtime`
- `src-tauri` 只保留编排层，不再负责 sidecar 进程管理
- 前端协议边界保持不变，继续通过本地 WebSocket bridge 接收高频帧流

该决策的目标是：

- 不影响现有 SSH / SFTP / Terminal 架构稳定性
- 允许 RDP 独立推进与单独锁定依赖版本
- 保留未来回收进 workspace 的可能性

### 2.4 未来回收条件

只有在以下条件满足时，才重新评估将 RDP 运行时回收进当前 workspace：

1. `IronRDP` 与当前 SSH 依赖链可在同一 Cargo 求解图中稳定共存
2. 不需要为 RDP 单独维护一套构建、发布、调试链路
3. 回收后不会显著增加 `src-tauri` 进程的崩溃面与升级风险

在条件未满足前，sidecar 视为正式运行时方案，而不是临时 hack。

`2026-03-27` 的当前进度是：

- 已新增 `crates/rdp_runtime` 作为 workspace 内独立运行时 crate
- 已将 `src-tauri/src/rdp.rs` 改为对 `rdp_runtime` 的编排与状态代理
- 已通过本地 patch crate 对齐 `IronRDP` fork 与 `sspi 0.19` 的 API 变化
- 当前分支已经可以完成 Rust 侧编译与静态检查，下一步转向真实联调与 sidecar 代码退场

## 3. 架构总览

### 3.1 运行单元

RDP 功能拆分为四层：

1. Main 窗口
2. RDP SubApp 前端窗口
3. `src-tauri` 编排层
4. RDP 运行时

职责划分如下：

- Main：负责入口、窗口生命周期、聚焦、关闭、外观同步
- RDP SubApp：负责 Canvas 渲染、输入采集、状态展示
- `src-tauri`：负责 profile 存储、运行时编排、本地控制命令代理
- `rdp-sidecar`：在 sidecar 路线下负责真实 `IronRDP` 会话、图像解码、输入下发、重连、证书处理
- `crates/rdp_runtime`：在 workspace 路线下负责真实 `IronRDP` 会话、图像解码、输入下发与本地 bridge

### 3.2 进程关系

```text
Main Window
  └─ launch/focus/close
     └─ RDP SubApp Window (WebView)
         ├─ 控制命令 -> src-tauri command
         └─ 画面/状态 <- 本地 WS / IPC

src-tauri
  ├─ 管理 RDP Profile
  ├─ 编排 RDP runtime
  └─ 维护 session registry

RDP Runtime
  ├─ sidecar 路线: rdp-sidecar
  └─ workspace 路线: crates/rdp_runtime
```

## 4. 为什么 sidecar 比 WASM 路线更适合首版

当前 FluxTerm 首版不采用 `IronRDP WASM/Web` 作为主运行时，原因如下：

1. WASM/Web 路线本质依赖 WebSocket 代理或 Gateway，不是浏览器直连 TCP
2. FluxTerm 当前是桌面端 Tauri 应用，原生 sidecar 更符合本地桌面分发模型
3. 原生 sidecar 到目标主机的链路更短，延迟和资源调度通常更稳定
4. 证书、重连、NLA、画面解码、输入处理更适合放在原生 Rust 进程中

因此当前策略是：

- 首版运行时：`native sidecar`
- 未来可选扩展：增加 `gateway/web transport adapter`
- 不排斥未来引入 WASM/Web，但不作为 P3 首发路径

## 5. 目录与工程组织

### 5.1 当前仓库内文档与壳层

- `src/subapps/rdp/`：RDP 子应用前端壳层
- `src/features/rdp/`：前端命令与领域类型
- `src-tauri/src/commands/rdp.rs`：主进程命令入口
- `src-tauri/src/rdp.rs`：主进程 RDP 编排层
- `crates/rdp_runtime/`：workspace 内独立 RDP 运行时 crate
- `patches/ironrdp-connector/`：当前分支用于对齐上游 `sspi 0.19` API 的本地 patch
- `patches/ironrdp-tokio/`：当前分支用于对齐上游 `ironrdp-tokio` 与 `sspi 0.19` 的本地 patch

### 5.2 sidecar 建议目录

建议在仓库根目录下新增：

```text
tools/
└─ rdp-sidecar/
   ├─ Cargo.toml
   ├─ src/
   │  ├─ main.rs
   │  ├─ protocol.rs
   │  ├─ session_manager.rs
   │  ├─ bridge.rs
   │  ├─ certificate.rs
   │  └─ ironrdp_runtime.rs
   └─ README.md
```

说明：

- 该目录先不加入当前 workspace
- 由 `src-tauri` 在运行时启动外部可执行文件
- sidecar 可以独立维护 `Cargo.lock`

## 6. 通信设计

### 6.1 通信分层

分成两类通道：

- 控制通道：低频命令与状态
- 图像通道：高频画面帧与光标事件

### 6.2 `src-tauri` 与 sidecar

建议使用本地 loopback IPC：

- 控制面优先 `HTTP JSON-RPC` 或本地 `WebSocket`
- 画面面统一使用二进制 `WebSocket`

首版建议：

- sidecar 启动后监听 `127.0.0.1:随机端口`
- `src-tauri` 通过命令行参数或握手文件获取端口
- `src-tauri` 负责把会话 `sessionId` 与 sidecar 内部运行时映射起来

### 6.3 前端与 `src-tauri`

前端仍保持现有风格：

- 会话创建、连接、断开、剪贴板、证书确认走 Tauri command
- 画面流与高频状态通过本地 `WebSocket` 直连 sidecar 暴露的桥接端口

这样做的好处：

- 大体积图像流不经过 Tauri 事件总线
- `src-tauri` 只负责编排，不承担画面转发热点

## 7. 会话模型

### 7.1 Profile

`RdpProfile` 保持当前字段方向：

- `id`
- `name`
- `host`
- `port`
- `username`
- `passwordRef`
- `domain`
- `ignoreCertificate`
- `resolutionMode`
- `width`
- `height`
- `clipboardMode`
- `reconnectPolicy`

### 7.2 Session 状态

首版状态统一为：

- `idle`
- `connecting`
- `connected`
- `reconnecting`
- `certificate_prompt`
- `disconnected`
- `error`

### 7.3 运行时职责

`rdp-sidecar` 中的 `SessionManager` 负责：

- 建立与销毁会话
- 维护状态机
- 处理自动重连
- 接收前端输入
- 输出图像与控制消息
- 做证书确认等待

## 8. 图像与输入协议

### 8.1 图像输出

首版保持当前协议方向：

- 二进制帧
- 头部包含 `type + x + y + width + height`
- 负载为 `RGBA8888`

后续 sidecar 接入真实 `IronRDP` 后：

- 按脏矩形发送
- 合并同 tick 内多个更新
- 前端 Canvas 按区域回放

### 8.2 输入事件

前端采集：

- `mouse_move`
- `mouse_down`
- `mouse_up`
- `wheel`
- `key_down`
- `key_up`

sidecar 负责：

- Web 键值到 RDP scancode / unicode 的映射
- 组合键状态跟踪
- FastPath input 打包与发送

## 9. 首版范围

### 9.1 纳入范围

- 远程桌面画面显示
- 键盘鼠标输入
- 窗口同步分辨率
- 证书确认
- 自动重连
- 文本剪贴板

### 9.2 暂不纳入

- 音频
- 磁盘映射
- 打印机
- 摄像头
- 麦克风
- 多显示器
- 文件剪贴板
- Gateway / Web transport

## 10. 安全与稳定性

### 10.1 采用 sidecar 的稳定性收益

- RDP 协议栈崩溃不会直接拉倒主 Tauri 进程
- `IronRDP` 升级可以独立验证
- 依赖锁文件与密码学版本隔离
- RDP 故障更容易做进程级回收和拉起

### 10.2 风险

- 增加一个额外进程与打包链路
- 需要管理 sidecar 版本匹配
- 本地 IPC/WS 需要补访问边界和超时处理

### 10.3 控制原则

- sidecar 仅监听 `127.0.0.1`
- 每次启动使用随机端口
- 握手必须包含一次性 token
- 会话关闭后立即回收无效 token

## 11. 实施阶段

### 阶段 A：设计落地

- [x] 确认 RDP 使用 `SubApp`
- [x] 确认首版不采用 WASM 主路线
- [x] 确认因安全依赖冲突采用 sidecar
- [x] 形成本文档

### 阶段 B：sidecar 工程骨架

- [x] 新建 `tools/rdp-sidecar`
- [x] 增加独立 `Cargo.lock`
- [x] 定义 sidecar 配置与启动参数
- [x] 定义控制协议与图像协议

### 阶段 C：主进程编排

- [x] `src-tauri` 启动 sidecar 进程
- [x] 维护 sidecar 生命周期与健康检查
- [x] 将现有 RDP command 改为代理到 sidecar

### 阶段 D：真实会话接入

- [x] 接入 `IronRDP` 连接建立
- [x] 接入真实图像更新
- [x] 接入键鼠输入
- [x] 接入 Display Control
- [ ] 接入证书确认
- [ ] 接入重连策略

### 阶段 E：完善体验

- [ ] 文本剪贴板
- [ ] 更明确的错误提示
- [ ] 断开/重连 UI 反馈
- [ ] 连接性能与资源占用观察
- [x] 键盘输入映射表与回归基线
- [x] 当前可用版本的代码收敛与关键注释补齐

## 12. 进度记录

### 2026-03-26

- 已确认 RDP 属于 `SubApp`，不进入 Main 布局
- 已完成前端/后端骨架，当前可打开 RDP 子应用并走通占位画面桥
- 已尝试将真实 `IronRDP` 接入 `src-tauri`
- 已确认当前阶段存在安全依赖冲突，暂不继续把真实 `IronRDP` 塞进 workspace
- 已决定切换到独立 crate sidecar 方案
- 已建立本文档，作为后续持续实施与进度登记基线
- 已创建 `tools/rdp-sidecar` 独立 crate 骨架
- 已补充启动参数、ready 文件输出、token 校验与最小控制协议
- 已生成 sidecar 独立 `Cargo.lock`，确认不加入主 workspace
- `src-tauri` 已能按需启动 sidecar，并通过 HTTP 控制面代理现有 RDP command
- sidecar 已提供占位 WebSocket bridge，前端协议保持不变
- sidecar 已接入真实 `IronRDP` 依赖与运行时主循环，当前为“编译通过、待远端主机联调”状态
- 已建立 `docs/rdp-keyboard-mapping.md`，将浏览器 `KeyboardEvent.code` 到 RDP 扫描码的规则集中化
- sidecar 已将基础键盘扫描码映射改为表驱动，并补充主键区、导航键、功能键、小键盘覆盖

### 2026-03-27

- 当前 RDP 子应用已经具备可用连接能力，可完成真实桌面显示、键鼠输入、窗口跟随和基础断开流程
- 已修复 bridge 积压导致的错误关闭、断开后重复拉起 sidecar、前端断线残帧、窗口跟随模式下的 `DeactivateAll` 问题
- 已补充前端键盘按下状态跟踪、失焦释放和鼠标坐标映射，减少卡键与指针漂移
- 已为主进程 sidecar 编排、sidecar 会话管理、真实 IronRDP 运行时和前端 bridge 生命周期补充关键中文注释
- 下一阶段进入交互优化，重点收敛 profile 编辑体验、连接中反馈、错误提示和可观测性

## 13. 后续维护规则

从本文档建立起，后续每次 RDP 实施都应同步更新：

1. `实施阶段` 勾选状态
2. `进度记录`
3. 如果协议或目录边界有变化，优先更新本文档再改代码

## 14. 结论

当前 `RDP SubApp` 的正式技术路线为：

- UI 壳层留在当前 FluxTerm 仓库
- 真实 `IronRDP` 运行时移至独立 crate sidecar
- 采用 sidecar 的直接原因是当前安全依赖冲突
- 后续若冲突解决，再评估是否回收进当前 workspace

当前状态补充说明：

- 功能已进入“可正常使用”的阶段
- 接下来工作重点从“协议接通”转为“交互体验与可维护性优化”
