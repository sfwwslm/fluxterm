export type AiResponseLanguageStrategy = "follow_ui" | "follow_user_input";

/** AI 对话消息。 */
export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** 会话上下文问答请求。 */
export type AiSessionChatRequest = {
  sessionId: string;
  responseLanguageStrategy: AiResponseLanguageStrategy;
  uiLanguage: "zh" | "en";
  messages: AiChatMessage[];
};

/** 会话上下文问答流式请求。 */
export type AiSessionChatStreamRequest = {
  requestId: string;
  sessionId: string;
  responseLanguageStrategy: AiResponseLanguageStrategy;
  uiLanguage: "zh" | "en";
  messages: AiChatMessage[];
};

/** 会话上下文问答响应。 */
export type AiSessionChatResponse = {
  message: AiChatMessage;
};

/** 终端选中文本解释请求。 */
export type AiExplainSelectionRequest = {
  sessionId: string;
  responseLanguageStrategy: AiResponseLanguageStrategy;
  uiLanguage: "zh" | "en";
  selectionText: string;
};

/** AI 流式输出片段事件。 */
export type AiChatChunkPayload = {
  requestId: string;
  sessionId: string;
  content: string;
};

/** AI 流式输出完成事件。 */
export type AiChatDonePayload = {
  requestId: string;
  sessionId: string;
};

/** AI 流式输出失败事件。 */
export type AiChatErrorPayload = {
  requestId: string;
  sessionId: string;
  error: {
    code: string;
    message: string;
    detail?: string | null;
  };
};
