# 文档索引

本目录收录 FluxTerm 的设计文档、能力说明和专题记录。阅读时建议先看架构总览，再按主题进入细节文档。

## 推荐阅读顺序

1. [架构总览](../ARCHITECTURE_V1.md)
2. [窗口与应用模型](./window-app-model.md)
3. [浮动窗口快照同步模式](./floating-panel-snapshot-pattern.md)
4. [终端拆分工作区设计](./terminal-split-workspace-design.md)
5. [SSH 会话与资源监控](./ssh-session-and-monitoring.md)

## 能力与设计

- [文件打开能力设计](./file-open-v1-design.md)
- [SSH Config 会话导入说明](./ssh-config-import-design.md)
- [历史命令与命令联想设计](./history-and-autocomplete.md)
- [终端与 SFTP 路径联动设计](./terminal-sftp-path-sync-design.md)
- [本地 Shell 终端字符集透传](./local-shell-term-charset-propagation.md)
- [设置交互规范](./settings-interaction-spec-v1.md)
- [持久化设计模式](./persistence-design-pattern.md)
- [公共加密模块设计](./security-crypto-refactor-design.md)

## AI 相关

- [OpenAI 集成设计](./openai-integration-design.md)
- [AI 上下文契约](./ai-context-contract.md)

## 日志与可观测性

- [SFTP 日志与事件说明](./sftp-log-events.md)
- [Telemetry / 埋点日志规范](./telemetry-logging-spec.md)

## 性能与专题记录

- [终端性能基准记录](./terminal-performance-benchmark.md)
- [代理性能基准记录](./proxy-performance-benchmark.md)
- [主题设计 Token 重构设计](./theme-design-token-refactor-design.md)
