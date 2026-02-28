## 会话资源监控设计

### 目标

在底部状态栏中显示当前活动会话对应主机的 CPU 与内存摘要，并在悬浮详情中展示更完整的资源字段。

- 本地 shell：监控客户端本机资源
- SSH 会话：监控服务端资源
- 关闭会话时：同步关闭该会话对应的监控任务与监控连接
- 监控不能影响终端输入输出

### 非目标

- 第一版不支持远端 macOS 主机
- 第一版不尝试复用终端输出解析资源数据
- 第一版不把采样逻辑放在前端轮询里

### 约束

1. 资源监控开关放在会话设置中
2. 采样间隔默认 `5s`
3. 采样间隔最小 `3s`
4. 即使本地配置被篡改，后端也必须把间隔钳制到不低于 `3s`
5. 关闭会话时必须保证关闭监控使用的连接或后台任务

### 为什么不能做前端止血方案

资源监控的根因在后端能力边界，而不是前端展示层。

- 前端无法稳定、低成本地拿到本地与远端统一格式的 CPU/内存数据
- 前端轮询触发远端命令会把采样时序、重试、生命周期分散到 UI 层
- 如果把监控命令写入交互终端，会直接污染终端输入输出

因此资源监控必须由后端统一采样，前端只消费结构化快照事件。

### 架构结论

#### 本地 shell

本地 shell 监控不需要额外连接。

- 后端直接通过系统信息库采样本机 CPU/内存
- 采样器按会话设置的间隔产出快照
- 关闭会话时停止该本地采样任务

#### SSH 会话

远端监控不能复用交互终端，也不应与 SFTP 混用。

- 为每个启用了资源监控的 SSH 会话建立一条独立监控 SSH 连接
- 这条连接不承载终端、不承载 SFTP，只负责资源采样
- 采样通过独立 exec channel 执行轻量命令并返回结构化文本
- 关闭会话时显式断开该监控连接

这样可以保证：

- 监控不会污染终端输出
- 监控失败不会阻塞交互 shell
- 监控连接生命周期和会话生命周期一一对应

### 为什么不复用现有 SSH 会话

当前交互 SSH 会话已经承载：

- 终端 PTY
- 用户输入输出
- SFTP 命令分发

继续在同一会话里加入周期性资源采样，会让时序与阻塞边界变得更模糊。开发阶段应直接在源头建立更清晰的能力边界，因此远端监控使用独立连接更合适。

### 采样策略

#### 本地

统一使用 Rust 系统信息库采样：

- CPU 总占用
- 内存 total / used / free / available

#### 远端 Linux

第一版只保证远端 Linux。

- CPU：读取 `/proc/stat`
- 内存：读取 `/proc/meminfo`

后端维护上一次 CPU 原始计数，用两次采样差值计算：

- total
- user
- system
- idle
- iowait

#### 远端 macOS

当前版本不支持远端 macOS。

- 需要单独适配 `sysctl`、`vm_stat`、`top -l 1`
- 输出格式与 Linux 不同，不能与 Linux 路径混写
- 当前版本主力范围是把本地与远端 Linux 做稳，因此暂不进入实现范围

### 前后端数据边界

#### 后端输出

后端向前端推送结构化资源快照事件，建议事件名为：

- `session:resource`

快照至少包含：

- `sessionId`
- `sampledAt`
- `cpu.totalPercent`
- `cpu.userPercent`
- `cpu.systemPercent`
- `cpu.idlePercent`
- `cpu.iowaitPercent`
- `memory.totalBytes`
- `memory.usedBytes`
- `memory.freeBytes`
- `memory.availableBytes`
- `memory.cacheBytes`
- `source`
  - `local`
  - `ssh-linux`
  - 后续可扩展 `ssh-macos`

#### 前端职责

前端只负责：

- 读取当前活动会话的最新资源快照
- 在状态栏左侧展示 CPU/内存摘要
- 悬浮时显示资源详情
- 关闭会话配置后隐藏资源区域

前端不负责：

- 执行采样命令
- 计算 CPU 差值
- 管理监控连接生命周期

### 配置设计

会话设置新增：

- `resourceMonitorEnabled: boolean`
- `resourceMonitorIntervalSec: number`

持久化到 `session.json`，约束如下：

- 默认 `resourceMonitorEnabled = false`
- 默认 `resourceMonitorIntervalSec = 5`
- 最小 `resourceMonitorIntervalSec = 3`
- 非法值加载后自动纠正并回写

### 生命周期

#### 启动监控

满足以下条件才启动：

1. 会话设置启用了资源监控
2. 当前存在活动会话
3. 会话状态为 `connected`

#### 停止监控

以下任一情况发生时停止：

1. 会话关闭
2. 用户关闭资源监控开关
3. 活动会话切换且旧会话不再需要持续监控

### UI 状态

第一版建议状态栏资源区域有三种可见状态：

1. 未启用：不显示资源区域
2. 检测中：显示简短 loading 文案或占位
3. 已就绪：显示 CPU / Memory 摘要

悬浮详情中展示：

- CPU：total、user、system、idle、iowait
- Memory：total、used、free、available、cache

### 日志

所有日志统一使用 Tauri 日志插件或 Rust `log`。

建议记录：

- 监控连接创建成功/失败
- 远端采样失败
- 非法采样间隔被纠正
- 会话关闭时监控连接关闭

### 已知取舍

1. 第一版远端只支持 Linux，更容易保证稳定性
2. 远端 macOS 留到后续版本
3. 本地采样可以跨平台统一，远端采样需要分平台实现
4. 资源监控默认只跟随当前活动会话，避免多会话并发监控放大资源占用

### 后续扩展

1. 支持远端 macOS
2. 支持更详细的负载、swap、磁盘、网络指标
3. 支持会话级与全局级不同监控策略
