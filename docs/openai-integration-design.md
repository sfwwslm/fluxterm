# 终端 AI 助手设计

本设计受 [终端 AI 助手上下文规范](./ai-context-contract.md) 约束。涉及上下文边界、状态归属和 AI 输入裁剪时，以该规范为准。

## 目标

FluxTerm 当前的 AI 能力只围绕终端工作流展开，范围固定为两类：

1. 终端会话上下文问答
2. 将终端中选中的文本发送给 AI

这两类能力都以“当前终端会话”为核心。

## 当前能力边界

### 终端会话上下文问答

AI 面板中的问答能力只在存在活动会话时可用。

问答上下文由后端统一组装，当前包括：

- 会话名称
- 主机
- 用户名
- 会话状态
- 资源监控状态
- 主机身份状态
- 最近终端输出片段

前端只发送：

- 当前 `sessionId`
- 当前轮消息历史
- 问答响应语言策略
- 当前界面语言

前端不拼接 prompt，不拼接会话摘要。

### 发送选中文本给 AI

该能力的目标是让用户自己完成上下文裁剪。

交互原则：

- 用户在终端中选中文本
- 通过右键菜单把选中文本发送给 AI
- AI 在当前会话上下文基础上，重点解释这段选中文本

这项能力通过终端右键菜单触发，当前实现会把选中文本与当前会话上下文一起发送给 AI。

选中文本进入模型前会由后端统一裁剪。当前裁剪上限由终端域 AI 配置控制，而不是写死在前端。

## 模块划分

### 独立 crate

- `crates/openai`

职责：

- OpenAI 兼容接口请求
- 终端会话问答 prompt 模板
- 请求与响应类型
- 响应解析
- 模型请求错误映射

该 crate 不依赖 Tauri，不读取应用状态。

### `src-tauri`

- `src-tauri/src/ai/mod.rs`
- `src-tauri/src/ai/context.rs`
- `src-tauri/src/ai_settings.rs`
- `src-tauri/src/commands/ai.rs`

职责：

- 读取 OpenAI 配置
- 维护终端会话上下文缓存
- 把会话状态转换成 AI 可消费的结构化输入
- 暴露 Tauri AI 命令
- 读取终端域 AI 配置

### 前端

- `src/features/ai/types.ts`
- `src/features/ai/core/commands.ts`
- `src/features/ai/hooks/useAiState.ts`
- `src/components/terminal/ai/AiPanel.tsx`

职责：

- 展示 AI 面板
- 发送会话上下文问答请求
- 订阅会话问答流式事件
- 展示返回结果
- 管理最小对话状态

## 接口设计

### 会话上下文问答

后端命令：

- `ai_session_chat`
- `ai_session_chat_stream_start`
- `ai_session_chat_stream_cancel`

前端事件：

- `ai:chat-chunk`
- `ai:chat-done`
- `ai:chat-error`

前端请求：

```ts
type AiSessionChatRequest = {
  sessionId: string;
  responseLanguageStrategy: "follow_user_input" | "follow_ui";
  uiLanguage: "zh" | "en";
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
};
```

前端响应：

```ts
type AiSessionChatResponse = {
  message: {
    role: "assistant" | "user" | "system";
    content: string;
  };
};
```

约束：

- 没有活动会话时，不允许发起会话问答
- prompt 模板只由后端维护
- 最近输出片段由后端统一裁剪
- 当前实现使用流式返回，会话问答的 assistant 内容通过事件增量追加
- 切换会话或清空对话时，前端需要取消当前流式请求

### 选中文本发送给 AI

这项能力落地时，建议新增独立命令，而不是复用普通问答文本输入。

建议请求：

```ts
type AiExplainSelectionRequest = {
  sessionId: string;
  responseLanguageStrategy: "follow_ui";
  uiLanguage: "zh" | "en";
  selectionText: string;
};
```

建议响应：

```ts
type AiExplainSelectionResponse = {
  message: {
    role: "assistant";
    content: string;
  };
};
```

约束：

- `selectionText` 由前端显式提供
- 会话上下文仍由后端补齐
- 选中文本需要裁剪长度

## OpenAI 配置

当前由 `src-tauri` 读取环境变量：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_MS`

前端不保存 API Key，不直接请求模型接口。

## 终端域 AI 配置

终端 AI 助手的本地配置文件路径为：

- `<resolve_config_root_dir(app)>/terminal/ai.json`

当前已使用的配置项：

```json
{
  "version": 1,
  "selectionMaxChars": 1500
}
```

约束：

- 该值由后端读取并应用
- 前端不维护单独的长度限制副本
- 未来如果开放用户设置，仍然写回这份配置文件

## 当前实现说明

当前已经落地：

- 独立 `crates/openai` crate
- `ai_session_chat` 命令
- `ai_session_chat_stream_start` 与 `ai_session_chat_stream_cancel` 命令
- `ai_explain_selection` 命令
- 会话上下文运行时缓存
- AI 面板最小问答界面
- 终端右键菜单中的“发送给 AI”入口
- 会话问答流式输出
- 选中文本按界面语言输出
- 会话问答按用户输入语言输出

## 验收标准

1. AI 功能只围绕终端会话工作流展开。
2. 会话问答必须依赖当前活动会话。
3. 前端不直接拼接 prompt，不直接请求模型。
4. 后端统一维护会话上下文并裁剪最近输出。
5. 终端选中文本发送给 AI 时，必须继续复用当前会话上下文，而不是脱离终端单独聊天。
6. 会话问答的 assistant 响应必须通过流式事件逐步渲染。
