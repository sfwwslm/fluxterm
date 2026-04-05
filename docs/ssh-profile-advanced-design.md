# SSH Profile 高级连接能力设计

## 概述

本文档记录 FluxTerm P1 阶段 SSH Profile 高级连接能力的当前实现边界，目标是让手工编辑、OpenSSH 导入结果、持久化结构与连接链路保持一致。

## 字段语义

- `identityFiles`
  - 表示私钥认证时的候选私钥列表
  - 按数组顺序依次尝试认证
- `privateKeyPath`
  - 作为 UI 主展示字段
  - 保存时与 `identityFiles[0]` 保持一致
- `proxyJump`
  - P1 真正生效
  - 仅支持单跳 `host[:port]`
- `proxyCommand`
  - P1 仅保存与展示，不执行
- `userKnownHostsFile`
  - 作为附加只读 Host Key 校验源
  - 不会回写
- `strictHostKeyChecking`
  - `null` 表示跟随全局终端域 Host Key 策略
  - `true` 表示严格校验
  - `false` 表示关闭校验
- `addKeysToAgent`
  - P1 仅保存与展示，不执行

## 保存规则

- 空字符串统一清理为 `null`
- `identityFiles` 会去空、去重、保序
- 仅填写 `privateKeyPath` 时，会自动同步成单元素 `identityFiles`
- 存在 `identityFiles` 时，`privateKeyPath` 始终回填为首项
- `proxyJump` 与 `proxyCommand` 同时存在时，以 `proxyJump` 为准，保存时清空 `proxyCommand`
- 使用私钥认证时，至少要求一个私钥路径

## Host Key 规则

- 应用私有 `known_hosts` 仍然是主校验源
- `userKnownHostsFile` 作为附加只读校验源，仅在应用私有记录未命中时参与匹配
- 当前支持的匹配模型仍为 `host + port + keyAlgorithm`
- 不支持 hashed host、marker、多 host pattern 等复杂 OpenSSH 语法
- 用户确认 Host Key 后，只写入应用私有 `known_hosts`

## ProxyJump 边界

- P1 仅支持单跳 `host[:port]`
- 跳板机沿用当前 Profile 的用户名、认证方式、私钥列表与 Host Key 策略
- 不支持多跳链、`user@host`、逗号链、跳板机单独凭据与 `ProxyCommand` 回退

## 当前未支持项

- `ProxyCommand` 执行
- `AddKeysToAgent` 执行
- Agent 认证
- 多跳 `ProxyJump`
- 跳板机独立 Profile 引用
