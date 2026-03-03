# SSH Host Key 校验实现说明

## 摘要

FluxTerm 当前已经实现应用级 SSH 主机身份校验链路，目标是让首次连接、主机指纹变更和策略控制都有明确且可预期的行为。

当前实现遵循以下原则：

- Host Key 信任关系由 FluxTerm 自己维护
- 应用内信任决策不与系统 `ssh` 命令共享
- 存储文件使用 OpenSSH `known_hosts` 兼容文本格式
- 提供 `ask / strict / off` 三档策略
- `ask` 模式下通过前端弹窗显式确认
- 正式 SSH 握手阶段会再次校验预期公钥，避免预检与正式连接之间的公钥漂移

## 当前实现范围

### 存储位置

Host Key 文件路径由 `src-tauri/src/config_paths.rs` 中的 `resolve_config_root_dir` 决定配置根目录，当前落在：

```text
<resolve_config_root_dir(app)>/terminal/ssh/known_hosts
```

该文件由 FluxTerm 独立维护，不与系统 `~/.ssh/known_hosts` 互相读写。

### 存储格式

当前使用 OpenSSH `known_hosts` 兼容文本格式，支持的记录形式为：

```text
example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...
[example.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...
```

当前支持：

- `host key-type base64-key`
- `[host]:port key-type base64-key`
- 空行
- `#` 注释行

当前不支持：

- hashed host
- 多 host 合并记录
- marker（如 `@cert-authority`、`@revoked`）
- 通配符和复杂模式匹配
- 注释字段保留写回

### 匹配维度

当前按以下维度匹配一条记录：

```text
host + port + keyAlgorithm
```

命中同一 `host + port + keyAlgorithm` 但公钥不同，会返回 `Mismatch`，并附带旧指纹给前端展示。

## 策略语义

### `ask`

- 已信任：直接连接
- 未信任：中断当前连接，前端弹窗确认
- 指纹变更：中断当前连接，前端弹窗确认
- 用户确认后：写入或替换 Host Key，再重新发起连接

### `strict`

- 已信任：直接连接
- 未信任：直接拒绝连接
- 指纹变更：直接拒绝连接

### `off`

- 不校验 Host Key
- 不读取应用级 `known_hosts`
- 不写入 Host Key 记录

## 连接链路

### 连接前预检

`src-tauri/src/commands/ssh.rs` 中的 `enforce_host_key_policy` 会在建立 SSH 会话前执行：

1. 读取 `session.json` 中的 `hostKeyPolicy`
2. 预检远端 Host Key
3. 在应用自己的 `known_hosts` 中按 `host + port + keyAlgorithm` 匹配
4. 根据 `ask / strict / off` 返回：
   - 允许继续连接的 `ExpectedHostKey`
   - 需要前端确认的事件
   - 直接阻断的错误

### 正式握手校验

`crates/engine/src/session.rs` 中的 `ClientHandler::check_server_key` 在正式 SSH 握手阶段会再次校验：

- 如果上层没有传入 `ExpectedHostKey`，直接放行
- 如果传入了 `ExpectedHostKey`，则要求当前服务端公钥与预检允许通过的公钥完全一致
- 不一致时返回 `ssh_host_key_untrusted`

这样当前实现不是单纯“预检后放行”，而是“预检分流 + 正式握手再确认”两段式校验。

## 前端交互

前端通过 `ssh:host-key-verification-required` 事件接收待确认信息，当前载荷包含：

- `profileId`
- `host`
- `port`
- `keyAlgorithm`
- `publicKeyBase64`
- `fingerprintSha256`
- `previousFingerprintSha256`
- `policy`

当前事件不包含 `sessionId`。原因是 `ask` 模式下这次连接已经被中断，后续可能是：

- 用户从主机列表发起的一次全新连接
- 某个已断开会话的回车重连

前端在 `src/features/session/hooks/useSessionStateCore.ts` 中维护 `profileId -> reconnecting sessionId` 的映射，用来把“确认后继续连接”收敛回原有重连链路，避免额外新建重复会话。

## 重连与确认行为

当前已实现以下收敛逻辑：

- 同一个 `profileId` 同时只允许一个待确认弹窗
- `exit` 后按回车触发的 SSH 重连，如果命中 Host Key 确认，确认后继续重连原 session，不新建重复会话
- 用户点击“取消”后，会终止当前这条待确认重连链路，不再自动重复弹窗

## 资源监控与 Host Key

远端资源监控会复用同一套主机身份校验规则：

- `off` 模式下不校验 Host Key
- `ask / strict` 模式下，只有当应用自己的 `known_hosts` 已信任目标主机时，才允许启动 SSH 资源监控
- 正式资源监控连接同样会在握手阶段校验预期公钥

当前资源监控无法启动时，会通过 `session:resource` 回传 `unsupported` 状态，并带上不可用原因，例如：

- `host_key_untrusted`
- `probe_failed`
- `connect_failed`
- `unsupported_platform`
- `sample_failed`

## 相关实现文件

后端：

- `src-tauri/src/commands/ssh.rs`
- `src-tauri/src/ssh_host_keys.rs`
- `src-tauri/src/session_settings.rs`
- `src-tauri/src/resource_monitor.rs`
- `crates/engine/src/session.rs`
- `crates/engine/src/host_key.rs`

前端：

- `src/hooks/settings/useSessionSettings.ts`
- `src/features/session/hooks/useSessionStateCore.ts`
- `src/features/session/core/listeners.ts`
- `src/components/layout/ConfigModal.tsx`
- `src/components/app/BottomArea.tsx`

## 当前边界

- 不与系统 `ssh` 命令共享信任数据
- 不实现 OpenSSH `known_hosts` 全量语法
- 不支持 SSH CA、证书链或 DNS SSHFP
- Host Key 确认事件当前按 `profileId` 关联重连上下文，而不是后端直接携带 `sessionId`

## 结论

当前实现已经形成完整的应用级 Host Key 校验链路：

- 存储边界独立
- 首次连接和指纹变更可阻断
- 前端确认后可以继续连接或继续原重连链路
- 正式握手阶段仍会再次校验公钥

后续如果继续扩展，应在保持当前存储边界和策略语义稳定的前提下，再增加导入导出、管理界面和更完整的 OpenSSH 语法支持。
