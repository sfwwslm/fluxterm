# OpenSSH Config 会话导入说明

## 摘要

FluxTerm 支持从默认 OpenSSH config 导入会话。

实现遵循以下原则：

- 读取 OpenSSH config，但不直接依赖系统 `ssh` 命令。
- 导入结果转为 FluxTerm 自己管理的会话数据。
- 所有导入会话统一归入固定分组 `OpenSSH`。
- 文档只定义已支持的字段与规则，不以 OpenSSH 全量语法兼容为目标。

## 数据来源

默认读取用户主目录下的 OpenSSH config：

```text
<home>/.ssh/config
```

其中 `<home>` 由后端通过系统路径能力解析，不在设计中写死具体用户名路径。

当前仅解析主配置文件，不递归处理其他被引用文件。

## 用户入口

入口位于主机面板右键菜单：

- `Openssh 导入`

点击后由后端直接执行导入，并返回导入摘要结果；前端使用 toast 展示摘要。

## 固定分组

所有导入得到的会话统一写入固定分组：

```text
OpenSSH
```

要求：

- 该分组由导入功能自动创建。
- 若分组已存在，则复用。
- 所有导入会话的 `tags` 统一写入该分组。

## 支持的配置字段

支持以下字段：

- `Host`
- `HostName`
- `Port`
- `User`
- `IdentityFile`
- `IdentitiesOnly`

字段用途：

- `Host`：作为导入会话的名称来源。
- `HostName`：作为真实连接地址。
- `Port`：作为连接端口。
- `User`：作为用户名。
- `IdentityFile`：作为私钥路径。
- `IdentitiesOnly`：作为默认值和解析结果的一部分，不写入 `HostProfile`。

## 能力边界

以下配置不参与导入决策：

- `Include`
- `Match`
- 通配符 Host 批量展开
- `ProxyJump`
- `ProxyCommand`
- `LocalForward`
- `RemoteForward`
- `DynamicForward`
- `CertificateFile`
- `UserKnownHostsFile`
- `StrictHostKeyChecking`

## 解析规则

### Host 块识别与默认值

以 OpenSSH config 的 `Host ...` 作为基本块边界。

例如：

```text
Host prod
  HostName 10.0.0.10
  User root
  Port 22
```

每个可识别的 `Host` 块最多生成一个 FluxTerm 会话。

`Host *` 不会生成会话，而是作为默认值块参与后续具体 Host 的字段继承。当前继承字段如下：

- `HostName`
- `Port`
- `User`
- `IdentityFile`
- `IdentitiesOnly`

### 跳过规则

以下情况直接跳过并计入 `unsupportedCount`：

- `Host` 中包含通配符的模式块。
- `Host` 中包含否定模式。
- 一个 `Host` 行中包含多个 pattern。
- 没有可确定目标地址的块。
- 内容无法映射为 FluxTerm 会话的块。

## 字段映射规则

映射规则如下：

- `profile.name` = `Host`
- `profile.host` = `HostName`，若缺失则回退为 `Host`
- `profile.port` = `Port`，若缺失则使用 `22`
- `profile.username` = `User`，若缺失则为空字符串
- `profile.authType`：
  - 存在 `IdentityFile` 时设为 `privateKey`
  - 否则设为 `password`
- `profile.privateKeyPath` = `IdentityFile`
- `profile.tags` = `["OpenSSH"]`

约束说明：

- `Host` 是显示名，不一定等于真实地址。
- `HostName` 优先级高于 `Host`。
- `IdentityFile` 若包含 `~`，后端应展开为用户主目录绝对路径。
- `Host` 名称超过 14 个字符时，导入阶段会裁剪到当前会话名称上限，并记录 `warn` 日志。

## 认证方式说明

由于 FluxTerm 当前会话模型和 OpenSSH config 并不完全等价，导入采用保守映射：

- 有 `IdentityFile` 时，导入为私钥认证会话。
- 没有 `IdentityFile` 时，仅导入基础连接信息。

这意味着：

- 导入后的会话可能仍需用户补充密码。
- 某些 OpenSSH 特性不会自动转化为 FluxTerm 内可执行的连接行为。

## 冲突与去重策略

导入采用默认不覆盖策略。

判重建议基于以下组合：

```text
name + host + port + username
```

处理规则：

- 完全相同：跳过。
- 同名但连接信息不同：跳过并计入冲突。
- 不存在：新增。

## 导入结果回执

后端导入命令返回以下结果：

- `addedCount`
- `skippedCount`
- `conflictCount`
- `unsupportedCount`
- `errorCount`

前端 toast 摘要只显示值大于 0 的项。

## 后端接口

Tauri 命令：

- `ssh_import_openssh_config`

职责：

1. 解析用户主目录下的 `~/.ssh/config`。
2. 提取支持字段。
3. 转换为 FluxTerm 会话。
4. 确保固定分组存在。
5. 写入会话列表。
6. 返回导入结果摘要。

前端不传入路径，统一使用默认路径。

## 配置文件与路径处理

路径处理遵循以下规则：

- `~` 展开为当前用户主目录。
- Windows 下保留 `C:\...` 绝对路径。
- 相对路径按 `~/.ssh/` 为基准解析。

其中 `IdentityFile` 的路径展开要在后端统一完成，避免前端对平台路径做额外判断。

## 错误处理

导入流程区分以下错误：

- 找不到 SSH config 文件。
- SSH config 文件不可读。
- SSH config 解析失败。
- 配置可读但没有可导入条目。

建议错误文案：

- `未找到 SSH config 文件`
- `无法读取 SSH config 文件`
- `SSH config 解析失败`
- `未发现可导入的 SSH 主机配置`

## 实现分层

实现分为三层：

1. OpenSSH config 解析层。
2. FluxTerm profile 映射层。
3. 导入执行与结果汇总层。

职责划分：

- 解析层：负责把文本解析成中间结构。
- 映射层：负责把中间结构转换成 `HostProfile`。
- 导入层：负责分组创建、判重、写入和结果汇总。

## 设计边界

- 不改变 FluxTerm 自己的 SSH 连接参数模型。
- 不保证导入后完全还原 OpenSSH 原始行为。
- 不把 OpenSSH config 当作运行时单一事实来源。
- 不返回逐项导入明细。
- 不支持用户选择覆盖已有会话。
