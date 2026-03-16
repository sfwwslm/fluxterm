# 安全数据保护设计

## 概述

FluxTerm 使用统一的安全数据保护模型管理 SSH 密码、私钥口令和 AI Key。

当前设计遵循以下原则：

- 默认不加密，行为透明。
- 用户主动设置安全密码后，敏感字段进入受保护状态。
- 安全密码只保存在当前运行期的内存中，不写入磁盘。
- SSH 凭据与 AI Key 共用同一套安全状态与读写规则。

## 适用范围

本设计覆盖以下敏感数据：

- `HostProfile.password_ref`
- `HostProfile.private_key_passphrase_ref`
- AI Provider 的 `api_key_ref`

不属于上述范围的普通配置项仍按原有方式直接保存。

## 术语

### 未加密

敏感字段以明文写入本地配置文件。

### 已加密

敏感字段以结构化密文写入本地配置文件，读取前需要安全密码解锁。

### 已锁定

当前运行期内没有可用的内存态密钥，已加密数据不能被读取。

### 已解锁

当前运行期内存在可用的内存态密钥，已加密数据可以被读取。

## 模块结构

```text
src-tauri/src/security
├─ mod.rs
├─ crypto.rs
├─ provider.rs
├─ secret_store.rs
├─ types.rs
└─ providers
   ├─ mod.rs
   └─ user_password.rs
```

相关模块：

- `src-tauri/src/profile_secrets.rs`
  负责 `HostProfile` 敏感字段的保护与解保护。
- `src-tauri/src/commands/security.rs`
  负责安全状态查询、启用加密、解锁、锁定、更换密码、解除加密。
- `src-tauri/src/commands/ssh.rs`
  连接 SSH 时按 `profile.id` 重新读取并解析受保护字段。
- `src-tauri/src/ai_settings.rs`
  统一处理 AI Key 的保存与读取。

## 分层职责

### Provider

Provider 只负责原始字节级别的加解密能力。

当前实现包含：

- `UserPasswordProvider`

### CryptoService

`CryptoService` 是统一的安全服务入口，负责：

- 解析当前安全模式
- 基于安全密码派生会话密钥
- 生成与解析结构化密文
- 输出当前安全状态

### SecretStore

`SecretStore` 负责业务字段层面的统一读写规则：

- 未加密模式下直接透传字符串
- 已加密模式下输出或读取 `enc:v1:` 密文 token

### ProfileSecretCodec

`profile_secrets.rs` 负责定义 `HostProfile` 中哪些字段属于敏感字段，并统一执行保护与解保护。

## 安全模式

### 未加密模式

未加密模式下：

- `profiles.json` 中的 `secret.provider` 为 `plaintext`
- SSH 密码、私钥口令、AI Key 直接保存为字符串
- 不生成 `enc:v1:` 密文 token

示例：

```json
{
  "version": 1,
  "provider": "plaintext",
  "active_key_id": null,
  "kdf_salt": null,
  "verify_hash": null
}
```

### 安全密码加密模式

启用后：

- `profiles.json` 中的 `secret.provider` 为 `user_password`
- 敏感字段写盘时统一保存为密文
- 应用重启后默认进入已锁定状态

示例：

```json
{
  "version": 1,
  "provider": "user_password",
  "active_key_id": "master-uuid",
  "kdf_salt": "base64...",
  "verify_hash": "base64..."
}
```

字段说明：

- `active_key_id`
  当前密钥标识。
- `kdf_salt`
  安全密码派生时使用的随机盐值。
- `verify_hash`
  用于校验用户输入的安全密码是否正确。

## 密文格式

已加密字段写盘格式如下：

```text
enc:v1:<base64(payload-bytes)>
```

其中 `payload-bytes` 为 JSON 序列化后的字节，再整体进行 Base64 编码。

内部载荷结构如下：

```json
{
  "provider": "user_password",
  "algorithm": "aes256_gcm",
  "keyId": "master-uuid",
  "nonce": "base64...",
  "ciphertext": "base64..."
}
```

## 运行时行为

### 初始状态

- 未加密模式：可直接读取敏感字段。
- 已加密模式：应用启动后默认处于已锁定状态。

### 启用加密

用户在安全页设置安全密码后：

1. 后端生成新的安全配置与当前会话密钥。
2. 已保存的 SSH 密码、私钥口令、AI Key 被统一转换为受保护数据。
3. 当前运行期保持已解锁状态。

### 解锁

用户输入安全密码后：

1. 后端校验 `verify_hash`。
2. 派生出本次运行可用的会话密钥。
3. 已加密字段在当前运行期内可以被读取。

### 锁定

用户主动锁定后：

1. 内存中的会话密钥被清除。
2. 磁盘中的密文保持不变。
3. 需要重新输入安全密码才能读取已加密字段。

### 更换密码

用户输入当前安全密码和新安全密码后：

1. 后端校验当前安全密码。
2. 使用新的安全密码生成新的安全配置。
3. 已保存的受保护数据切换到新的安全密码。

### 解除加密

解除加密后：

1. 当前敏感字段恢复为明文保存。
2. `profiles.json` 中的安全模式切换回 `plaintext`。
3. 后续不再要求解锁。

## SSH 与 AI 的读取规则

### SSH

SSH 建立连接时，后端不会直接信任前端内存中的凭据副本，而是：

1. 根据 `profile.id` 重新读取本地配置。
2. 按当前安全状态解析敏感字段。
3. 在已锁定状态下直接阻止连接。

这样可以确保锁定后 SSH 凭据立即失效。

### AI

AI 使用 Provider Key 时统一通过 `SecretStore` 读取：

- 未加密模式下直接读取明文。
- 已加密且已解锁时读取明文结果。
- 已加密且已锁定时返回锁定错误。

## 前端状态表达

状态栏显示三种安全状态：

- `未加密`
- `已解锁`
- `已锁定`

交互规则：

- 未加密：点击后打开安全设置。
- 已锁定：点击后打开安全设置并引导用户解锁。
- 已解锁：点击后立即锁定。

安全设置页提供以下能力：

- 启用加密
- 解锁
- 更换密码
- 立即锁定
- 解除加密

安全操作执行期间，整个配置弹窗进入忙碌态遮盖。

## 后端命令接口

当前暴露以下安全相关命令：

- `security_status`
- `security_unlock`
- `security_lock`
- `security_enable_with_password`
- `security_change_password`
- `security_disable_encryption`

这些命令统一返回 `SecurityStatus`，供前端更新状态展示与交互。

## 约束

- 默认模式为未加密模式。
- 未设置安全密码时，不生成任何密文 token。
- 已加密但未解锁时，不允许读取受保护字段。
- SSH 与 AI 必须共享同一套安全状态。
- 安全密码最少为 4 个字符。
- 安全密码只保存在内存中，不写入磁盘。

## 用户可见结果

从用户视角，安全功能提供以下行为：

- 默认直接可用，不强制输入密码。
- 开启加密后，本次运行立即可用。
- 应用重启后，需要重新输入安全密码。
- 锁定后，AI 与 SSH 的受保护数据都会立即不可用。
- 解除加密后，敏感字段恢复为明文保存。
