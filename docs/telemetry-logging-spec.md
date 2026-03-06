# Telemetry/埋点日志规范（V1）

## 1. 目标与范围

### 1.1 目标

统一 FluxTerm 全栈埋点日志规范，解决命名不一致、字段缺失、无法跨层追踪、敏感信息泄露风险等问题，使日志可用于：

1. 故障排查与回放（Debug）
2. 行为分析与质量评估（Observability）
3. 稳定性指标与告警（SRE）

### 1.2 适用范围

本规范适用于以下全部埋点输出：

1. 前端 Webview（React/TS，`@tauri-apps/plugin-log`）
2. Tauri 命令层（Rust）
3. Engine 运行时（Rust）
4. SubApp 与 Main 的跨窗口生命周期日志

不适用：

1. 纯开发临时 `console.log`（PR 合并前需清理）

## 2. 事件命名规范

### 2.1 命名格式

统一使用：

`domain.action.result`

说明：

1. `domain`：业务域（如 `proxy` / `ssh` / `sftp` / `subapp` / `layout`）
2. `action`：动作（如 `create` / `close` / `update` / `sync` / `connect`）
3. `result`：结果（如 `start` / `success` / `failed`）

示例：

1. `proxy.create.start`
2. `proxy.create.success`
3. `proxy.create.failed`
4. `subapp.launch.success`

### 2.2 命名约束

1. 仅允许小写英文与点号分段，不使用空格、下划线、驼峰。
2. 同一动作必须成组出现：`start/success/failed`。
3. 禁止同义重复：例如 `proxy.open.success` 与 `proxy.create.success` 同时存在。
4. 事件名一旦发布，禁止无迁移直接改名。

## 3. 事件级别与分类

### 3.1 日志级别

1. `info`：正常业务路径（start/success、状态更新摘要）
2. `warn`：可恢复异常（重试、校验失败、冲突、依赖短暂不可用）
3. `error`：不可恢复异常（崩溃、关键链路中断、数据损坏风险）
4. `debug`：仅开发调试（默认建议关闭或采样）

### 3.2 事件类型

1. 业务事件：用户操作及其结果（如创建代理）
2. 运行时事件：后台状态变化（如连接数变化）
3. 生命周期事件：窗口/会话/子应用启动关闭
4. 错误事件：异常与失败

## 4. 字段模型规范

### 4.1 强制字段（所有事件必须有）

1. `event`: 事件名（`domain.action.result`）
2. `ts`: 事件时间戳（毫秒，UTC Epoch）
3. `source`: 来源（`frontend` / `tauri` / `engine`）
4. `level`: 级别（`info/warn/error/debug`）
5. `traceId`: 链路追踪 ID（跨层透传）

### 4.2 推荐公共字段

1. `sessionId`: 会话 ID（存在则必须带）
2. `subappId`: 子应用 ID
3. `widgetKey`: 组件 key
4. `durationMs`: 耗时
5. `attempt`: 重试次数

### 4.3 错误字段（失败事件必须有）

1. `error.code`: 机器可识别错误码
2. `error.message`: 可读错误信息
3. `error.detail`: 详细上下文（可选，注意脱敏）

### 4.4 业务扩展字段

业务字段必须遵循：

1. 小写驼峰（JSON 常规字段）
2. 不得与公共字段重名
3. 优先稳定含义，不因 UI 文案变化而变更

## 5. 脱敏与安全规范

### 5.1 禁止直接记录

1. 密码、私钥、API Key、Token、Cookie、Authorization 明文
2. 完整用户输入内容（除非显式允许并已脱敏）
3. 本地敏感路径全量（可记录摘要或哈希）

### 5.2 允许记录（需最小化）

1. 用户名（可选）
2. 主机/IP（按场景可做掩码）
3. 端口、协议、状态码

### 5.3 脱敏规则

1. 凭据字段统一用 `***` 或哈希摘要
2. 长文本字段限制长度（建议 <= 512）
3. 错误栈默认不落用户可见日志，必要时落 debug 通道

## 6. 链路关联规范（Trace）

### 6.1 traceId 规则

1. UI 发起操作时创建 `traceId`（UUID/ULID）
2. Tauri invoke 参数中透传 `traceId`
3. Engine 事件回调继续透传 `traceId`
4. 同一用户动作全链路仅使用一个 `traceId`

### 6.2 parent/child 关系（可选）

复杂流程可增加：

1. `spanId`
2. `parentSpanId`

用于拆解长链路（如 connect -> auth -> open channel -> ready）。

## 7. 采样与性能约束

### 7.1 高频事件采样

以下事件建议采样或聚合输出：

1. 按连接频繁刷新状态事件
2. 高频终端输出类事件

策略建议：

1. 默认全量记录 `warn/error`
2. `info` 高频事件按时间窗口聚合（如 1s 一次）
3. `debug` 默认关闭

### 7.2 大小与频率限制

1. 单条日志建议 <= 4KB
2. 单实例日志速率可配置上限（防止日志风暴）
3. 严禁在热循环中无条件拼接大字符串

## 8. 事件字典与版本管理

### 8.1 事件字典

维护 `event -> 字段 -> 含义` 字典，新增事件必须登记。

### 8.2 版本策略

1. 规范版本：`Telemetry Spec Vx`
2. 破坏性改动需发布迁移说明
3. 废弃事件保留兼容窗口（至少一个小版本）

## 9. 代码接入规范

### 9.1 前端（TS）

1. 统一通过封装的日志工具输出，禁止散落硬编码字符串
2. 同一动作必须有 `start/success/failed`
3. `failed` 必须携带 `error.code/error.message`

### 9.2 Rust（Tauri/Engine）

1. 统一结构化日志（JSON）
2. 严禁 `format!("{:?}", sensitive)` 输出敏感对象
3. 错误日志必须使用统一错误码

## 10. 迁移与评审清单

### 10.1 增量接入 Checklist

1. 事件命名是否符合 `domain.action.result`
2. 是否包含强制字段（含 `traceId`）
3. 失败事件是否带标准错误字段
4. 是否存在敏感信息泄露
5. 高频路径是否有采样/聚合策略

### 10.2 PR Review 必查项

1. 是否新增未登记事件名
2. 是否引入同义重复事件
3. 是否缺失 start/success/failed 成组语义
4. 是否有不可检索自由文本日志替代结构化字段

## 11. Proxy 域示例映射（当前建议）

### 11.1 控制面事件

1. `proxy.create.start`
2. `proxy.create.success`
3. `proxy.create.failed`
4. `proxy.close.start`
5. `proxy.close.success`
6. `proxy.close.failed`
7. `proxy.closeAll.start`
8. `proxy.closeAll.success`
9. `proxy.closeAll.failed`
10. `proxy.list.success`
11. `proxy.list.failed`

### 11.2 运行时事件

1. `proxy.runtime.update`
2. `proxy.connection.open`
3. `proxy.connection.close`
4. `proxy.connection.failed`

### 11.3 推荐字段

1. `proxyId`
2. `protocol`
3. `bindHost`
4. `bindPort`
5. `activeConnections`
6. `bytesIn`
7. `bytesOut`
8. `error.code/error.message/error.detail`

---

## 12. 后续执行建议

1. 在 `src/shared` 与 `src-tauri` 增加统一日志助手，屏蔽直接字符串拼接。
2. 引入 `traceId` 透传能力（前端 -> Tauri -> Engine）并改造关键链路。
3. 为现有域（ssh/sftp/subapp/layout）建立事件字典并逐步对齐。
