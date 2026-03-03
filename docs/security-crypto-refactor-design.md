# 加密工具公共模块重构设计

## 摘要

本次重构将 SSH 凭据加密从 `profile` 命令层中抽离，统一下沉到 `src-tauri/src/security` 公共模块。

当前阶段为 Alpha：

- 启用首版 `enc:v1` 密文 token 方案
- `ProfileStore.version` 保持 `1`
- 默认 Provider 仍为硬编码密钥

目标不是立即提升安全等级，而是把“加密能力”从业务逻辑中剥离出来，为后续切换系统钥匙串、用户主密码或云端密钥提供稳定的替换点。

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
   ├─ hardcoded.rs
   └─ system_keychain.rs
```

另有：

- `src-tauri/src/profile_secrets.rs`：负责 `HostProfile` 的敏感字段编解码

## 分层职责

### Provider 层

只负责原始字节加解密：

- `HardcodedKeyProvider`
- `SystemKeychainProvider`（占位）

Provider 不知道：

- `HostProfile`
- JSON 文件结构
- 哪些字段属于密码

### CryptoService

负责：

- 选择当前 Provider
- 生成结构化密文 envelope
- 解析结构化密文 envelope

业务层只依赖 `CryptoService`，不直接依赖 AES-GCM、nonce 或 base64。

### SecretStore

负责：

- 将 `Option<String>` 类型的敏感值统一加解密
- 处理空字符串归一化为 `None`

### ProfileSecretCodec

负责：

- 指定 `HostProfile.password_ref`
- 指定 `HostProfile.private_key_passphrase_ref`

只有这一层知道 profile 哪些字段是敏感字段。

## 数据格式

敏感字段在写盘时保存为单字符串 token：

```text
enc:v1:<base64(payload-bytes)>
```

说明：

- `enc:v1:` 是外层 token 封装协议版本
- `payload-bytes` 当前为 JSON 序列化后的字节，再整体做 base64
- 当前读取逻辑仅处理 `enc:v1:` 前缀的密文 token

`v1` 下的内部 payload 结构为：

```json
{
  "provider": "hardcoded_key",
  "algorithm": "aes256_gcm",
  "keyId": "builtin-v1",
  "nonce": "base64...",
  "ciphertext": "base64..."
}
```

说明：

- 内层 payload 不再包含通用 `version` 字段，避免和外层 `enc:v1:` 语义冲突
- `provider`、`algorithm`、`keyId` 属于密文元数据，仍由安全模块私有管理
- 后续若要更换内部编码，可新增 `enc:v2:`，而不是复用 `v1`

## 当前 Provider

### HardcodedKeyProvider

当前默认实现：

- AES-256-GCM
- 固定 32 字节内置密钥
- `keyId = builtin-v1`

该方案只能防止凭据直接以明文落盘，不能抵御本机高权限攻击、二进制逆向或内存抓取。

### SystemKeychainProvider

本轮只保留骨架，不接入真实系统能力。

目的是提前固定 Provider 抽象，避免以后切换时再次改业务接口。

## Profile 流程

### 保存

1. 前端传入明文 `HostProfile`
2. `profile_save`
3. `ProfileSecretCodec::encrypt_profile_secrets`
4. `SecretStore::protect_optional_string`
5. `CryptoService::encrypt_string`
6. Provider 执行真实加密
7. 写入 `profiles.json`

### 读取

1. `profile_list`
2. 读取 `profiles.json`
3. `ProfileSecretCodec::decrypt_profile_secrets`
4. `SecretStore::reveal_optional_string`
5. `CryptoService::decrypt_string`
6. Provider 执行真实解密
7. 返回前端明文 `HostProfile`

## 演进路径

### Phase 1

- `HardcodedKeyProvider`

### Phase 2

- `SystemKeychainProvider`

### Phase 3

- `UserPasswordProvider`

### Phase 4

- `RemoteKeyProvider`

无论底层 Provider 如何变化，业务调用入口保持不变：

- `CryptoService`
- `SecretStore`
- `ProfileSecretCodec`

## 当前边界

- 不新增前端加密逻辑
- 不改变 `HostProfile` 前后端接口
- 当前仅实现 `enc:v1` token 读写

这符合当前 Alpha 阶段“允许破坏性重构、优先干净架构”的要求。
