# Telemetry / 埋点日志规范

## 1. 目标与范围

### 1.1 目标

统一 FluxTerm 全栈埋点日志规范，提升命名一致性、字段完整性、跨层追踪能力与敏感信息控制水平，使日志可服务于：

1. 故障排查与回放
2. 行为分析与质量评估
3. 稳定性指标与告警

### 1.2 适用范围

本规范适用于以下埋点输出：

1. 前端 Webview（React/TS，`@tauri-apps/plugin-log`）
2. Tauri 命令层（Rust）
3. Engine 运行时（Rust）
4. SubApp 与 Main 的跨窗口生命周期日志

不适用于：

1. 纯开发期临时 `console.log`，此类日志应在合并前清理

## 2. 事件命名规范

### 2.1 命名格式

统一使用：

`domain.action.result`

说明：

1. `domain`：业务域，例如 `proxy`、`ssh`、`sftp`、`subapp`、`layout`
2. `action`：动作，例如 `create`、`close`、`update`、`sync`、`connect`
3. `result`：结果，例如 `start`、`success`、`failed`

示例：

1. `proxy.create.start`
2. `proxy.create.success`
3. `proxy.create.failed`
4. `subapp.launch.success`

### 2.2 命名约束

1. 仅允许小写英文与点号分段，不使用空格、下划线或驼峰
2. 同一动作应保持 `start / success / failed` 成组语义
3. 避免同义重复命名，例如 `proxy.open.success` 与 `proxy.create.success`
4. 事件名一旦发布，应通过迁移流程管理变更

## 3. 事件级别与分类

### 3.1 日志级别

1. `info`：正常业务路径与状态摘要
2. `warn`：可恢复异常，例如重试、校验失败、冲突或依赖短暂不可用
3. `error`：不可恢复异常，例如崩溃、关键链路中断或数据损坏风险
4. `debug`：开发调试日志，默认建议关闭或采样

### 3.2 事件类型

1. 业务事件：用户操作及其结果
2. 运行时事件：后台状态变化
3. 生命周期事件：窗口、会话与子应用的启动关闭
4. 错误事件：异常与失败

## 4. 字段模型规范

### 4.1 强制字段

所有事件必须包含：

1. `event`：事件名（`domain.action.result`）
2. `ts`：事件时间戳（毫秒，UTC Epoch）
3. `source`：来源（`frontend` / `tauri` / `engine`）
4. `level`：级别（`info / warn / error / debug`）
5. `traceId`：链路追踪 ID

### 4.2 推荐公共字段

1. `sessionId`：会话 ID
2. `subappId`：子应用 ID
3. `widgetKey`：组件 Key
4. `durationMs`：耗时
5. `attempt`：重试次数

### 4.3 失败事件字段

失败事件建议包含：

1. `error.code`：机器可识别错误码
2. `error.message`：可读错误信息
3. `error.detail`：详细上下文，可选，需脱敏

### 4.4 业务扩展字段

业务字段应满足：

1. 使用小写驼峰命名
2. 不与公共字段重名
3. 含义稳定，不随 UI 文案变化而变化

## 5. 脱敏与安全规范

### 5.1 禁止直接记录

1. 密码、私钥、API Key、Token、Cookie、Authorization 明文
2. 完整用户输入内容，除非具备显式授权且已脱敏
3. 本地敏感路径全量信息，可记录摘要或哈希

### 5.2 允许记录

在最小化原则下，可记录：

1. 用户名
2. 主机或 IP，可按场景做掩码
3. 端口、协议与状态码

### 5.3 脱敏规则

1. 凭据字段统一使用 `***` 或哈希摘要
2. 长文本字段应限制长度，建议不超过 `512`
3. 错误栈默认不进入用户可见日志，必要时输出到 `debug` 通道

## 6. 链路关联规范

### 6.1 `traceId` 规则

1. UI 发起操作时创建 `traceId`
2. Tauri invoke 参数中透传 `traceId`
3. Engine 回调继续透传 `traceId`
4. 同一用户动作在全链路内使用同一个 `traceId`

### 6.2 `parent / child` 关系

复杂流程可增加：

1. `spanId`
2. `parentSpanId`

用于拆解长链路，例如 `connect -> auth -> open channel -> ready`。

## 7. 采样与性能约束

### 7.1 高频事件采样

以下事件建议采样或聚合输出：

1. 高频连接状态刷新事件
2. 高频终端输出类事件

建议策略：

1. `warn / error` 默认全量记录
2. 高频 `info` 事件按时间窗口聚合，例如 `1s` 一次
3. `debug` 默认关闭

### 7.2 大小与频率限制

1. 单条日志建议不超过 `4KB`
2. 单实例日志速率应可配置上限，以防止日志风暴
3. 禁止在热循环中无条件拼接大字符串

## 8. 事件字典与版本管理

### 8.1 事件字典

维护 `event -> 字段 -> 含义` 字典，新增事件时同步登记。

### 8.2 版本策略

1. 规范版本采用 `Telemetry Spec Vx`
2. 破坏性改动需发布迁移说明
3. 废弃事件保留兼容窗口，至少覆盖一个小版本

## 9. 代码接入规范

### 9.1 前端（TS）

1. 统一通过封装日志工具输出，避免散落硬编码字符串
2. 同一动作保持 `start / success / failed` 语义完整
3. `failed` 事件必须携带 `error.code` 与 `error.message`

### 9.2 Rust（Tauri / Engine）

1. 统一使用结构化日志（JSON）
2. 禁止 `format!("{:?}", sensitive)` 输出敏感对象
3. 错误日志应使用统一错误码

## 10. 迁移与评审清单

### 10.1 增量接入 Checklist

1. 事件命名是否符合 `domain.action.result`
2. 是否包含强制字段，尤其是 `traceId`
3. 失败事件是否具备标准错误字段
4. 是否存在敏感信息泄露
5. 高频路径是否具备采样或聚合策略

### 10.2 PR Review 必查项

1. 是否新增未登记事件名
2. 是否引入同义重复事件
3. 是否缺失 `start / success / failed` 成组语义
4. 是否以不可检索自由文本替代结构化字段

## 11. Proxy 域示例

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
8. `error.code / error.message / error.detail`
