# SSH 会话与资源监控实现说明

## 摘要

FluxTerm 当前将 SSH 终端会话与资源监控连接作为两条独立链路实现：

- 主 SSH 会话负责认证、PTY、终端输入输出和交互生命周期
- 资源监控 SSH 连接负责远端资源采样，不承载终端和 SFTP
- 两条链路共享同一套主机身份校验规则

## 主 SSH 会话

### 连接入口

前端通过会话命令发起连接，请求经 `src-tauri/src/commands/ssh.rs` 进入后端，再调用 `crates/engine/src/engine.rs` 和 `crates/engine/src/session.rs` 建立 SSH 会话。

主 SSH 会话负责：

- 认证
- PTY 分配
- 终端输入输出
- 会话状态流转

### 连接链路

当前主 SSH 会话建立顺序如下：

1. 读取会话设置中的 `hostKeyPolicy`
2. 执行主机身份预检
3. 根据校验结果决定继续连接、等待前端确认或直接拒绝
4. 进入正式 SSH 握手
5. 在握手阶段校验当前服务端公钥与预期公钥一致
6. 完成认证并建立终端会话

### 前端确认

当策略为 `ask` 且主机尚未信任或指纹发生变化时，后端会发出 `ssh:host-key-verification-required` 事件。

前端当前按 `profileId` 管理待确认上下文，并支持两种入口：

- 从主机列表发起的新连接
- 已断开会话上的回车重连

确认后：

- 写入或替换应用自己的 `known_hosts` 记录
- 继续连接当前 profile
- 如果当前是重连场景，则继续原会话的重连链路

取消后：

- 当前连接流程终止
- 当前待确认上下文清理完成

### 重连行为

当前 SSH 重连行为遵循以下规则：

- 同一个 `profileId` 同时只允许一个待确认弹窗
- 主机身份待确认期间，不自动重复发起重连
- `exit` 后按回车触发的重连，在确认通过后继续原会话，不额外创建新会话

## 资源监控 SSH 连接

### 连接职责

资源监控使用独立 SSH 连接，职责仅包括：

- 建立远端采样连接
- 周期性执行资源采样命令
- 向前端回传结构化资源快照

该连接不承载：

- PTY 终端
- SFTP
- 用户交互输入输出

### 启动条件

满足以下条件时才启动远端资源监控：

1. 当前活动会话为 SSH 会话
2. 会话状态为 `connected`
3. 会话设置启用了资源监控
4. 主机身份校验允许该监控连接建立

### 主机身份校验

资源监控 SSH 连接与主 SSH 会话共享同一套主机身份校验规则：

- `off`：不校验 Host Key
- `ask` / `strict`：只有目标主机已经存在受信任记录时，才允许启动资源监控连接

资源监控正式握手阶段同样校验服务端公钥与预期公钥一致。

### 采样方式

当前远端 Linux 资源采样通过独立 `exec channel` 执行命令。

- 采样命令不分配 PTY
- 采样结果解析为结构化 CPU 与内存快照
- 前端只消费 `session:resource` 事件

### 状态回传

资源监控无法启动或采样失败时，后端会回传 `unsupported` 状态，并附带原因码。当前已使用的原因包括：

- `host_key_untrusted`
- `probe_failed`
- `connect_failed`
- `unsupported_platform`
- `sample_failed`

断开连接或当前没有可运行监控的 SSH 会话时，前端显示“资源监控未运行”。

## 主机身份校验

### 存储位置

Host Key 文件路径位于：

```text
<resolve_config_root_dir(app)>/terminal/ssh/known_hosts
```

该文件由 FluxTerm 独立维护，不与系统 `~/.ssh/known_hosts` 互相读写。

### 存储格式

当前使用 OpenSSH `known_hosts` 兼容文本格式，支持：

- `host key-type base64-key`
- `[host]:port key-type base64-key`
- 空行
- `#` 注释行

当前不支持：

- hashed host
- 多 host 合并记录
- marker
- 通配符和复杂模式匹配

### 匹配维度

当前按以下维度匹配一条记录：

```text
host + port + keyAlgorithm
```

命中同一 `host + port + keyAlgorithm` 但公钥不同，会判定为指纹不一致。

### 策略语义

`ask`：

- 已信任则允许连接
- 未信任或指纹不一致则等待用户确认

`strict`：

- 已信任则允许连接
- 未信任或指纹不一致则拒绝连接

`off`：

- 不校验 Host Key
- 不读取应用级 `known_hosts`
- 不写入 Host Key 记录

主会话和资源监控连接在正式握手阶段都会校验当前服务端公钥与预期公钥一致；不一致时连接失败并返回 `ssh_host_key_untrusted`。

## 相关实现

后端：

- `src-tauri/src/commands/ssh.rs`
- `src-tauri/src/resource_monitor.rs`
- `src-tauri/src/ssh_host_keys.rs`
- `src-tauri/src/session_settings.rs`
- `crates/engine/src/session.rs`
- `crates/engine/src/host_key.rs`
- `crates/engine/src/monitor.rs`

前端：

- `src/features/session/core/commands.ts`
- `src/features/session/core/listeners.ts`
- `src/features/session/core/reconnectRuntime.ts`
- `src/features/session/hooks/useSessionStateCore.ts`
- `src/components/layout/ConfigModal.tsx`
- `src/components/app/BottomArea.tsx`
- `src/app/AppShell.tsx`
