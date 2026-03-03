import { useEffect, useRef, useState } from "react";
import { info as logInfo } from "@tauri-apps/plugin-log";
import {
  aiExplainSelection,
  aiSessionChatStreamCancel,
  aiSessionChatStreamStart,
  onAiChatChunk,
  onAiChatDone,
  onAiChatError,
} from "@/features/ai/core/commands";
import type {
  AiChatDonePayload,
  AiChatErrorPayload,
  AiChatMessage,
  AiChatChunkPayload,
} from "@/features/ai/types";
import type { Locale } from "@/i18n";

type UseAiStateProps = {
  activeSessionId: string | null;
  locale: Locale;
  debugLoggingEnabled: boolean;
  aiAvailable: boolean;
  aiUnavailableMessage: string | null;
};

type UseAiStateResult = {
  messages: AiChatMessage[];
  draft: string;
  pending: boolean;
  waitingFirstChunk: boolean;
  errorMessage: string | null;
  setDraft: (value: string) => void;
  sendMessage: () => Promise<void>;
  sendSelectionText: (selectionText: string) => Promise<void>;
  cancelMessage: () => void;
  clearMessages: () => void;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

/** AI 面板状态管理。 */
export default function useAiState({
  activeSessionId,
  locale,
  debugLoggingEnabled,
  aiAvailable,
  aiUnavailableMessage,
}: UseAiStateProps): UseAiStateResult {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [waitingFirstChunk, setWaitingFirstChunk] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlistenChunk: (() => void) | null = null;
    let unlistenDone: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    // Tauri 事件订阅是异步返回 unlisten 的，组件快速卸载时要立即回收晚到的订阅句柄。
    onAiChatChunk(handleChunk).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenChunk = unlisten;
    });
    onAiChatDone(handleDone).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenDone = unlisten;
    });
    onAiChatError(handleError).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenError = unlisten;
    });

    return () => {
      disposed = true;
      cancelPendingRequest();
      unlistenChunk?.();
      unlistenDone?.();
      unlistenError?.();
    };
  }, []);

  useEffect(() => {
    cancelPendingRequest();
    setMessages([]);
    setDraft("");
    setWaitingFirstChunk(false);
    setErrorMessage(null);
  }, [activeSessionId]);

  function handleChunk(payload: AiChatChunkPayload) {
    if (payload.requestId !== pendingRequestIdRef.current) return;
    setWaitingFirstChunk(false);
    setMessages((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last?.role !== "assistant") return prev;
      next[next.length - 1] = {
        ...last,
        content: `${last.content}${payload.content}`,
      };
      return next;
    });
  }

  function handleDone(payload: AiChatDonePayload) {
    if (payload.requestId !== pendingRequestIdRef.current) return;
    pendingRequestIdRef.current = null;
    setPending(false);
    setWaitingFirstChunk(false);
  }

  function handleError(payload: AiChatErrorPayload) {
    if (payload.requestId !== pendingRequestIdRef.current) return;
    pendingRequestIdRef.current = null;
    setPending(false);
    setWaitingFirstChunk(false);
    setErrorMessage(payload.error.message);
    setMessages((prev) => {
      const next = prev.slice();
      if (next[next.length - 1]?.role === "assistant") {
        next.pop();
      }
      return next;
    });
    if (debugLoggingEnabled) {
      void logInfo(
        JSON.stringify({
          event: "ai.session-chat.error",
          sessionId: payload.sessionId,
          error: payload.error.message,
        }),
      );
    }
  }

  function cancelPendingRequest() {
    const requestId = pendingRequestIdRef.current;
    if (!requestId) return;
    pendingRequestIdRef.current = null;
    setPending(false);
    setWaitingFirstChunk(false);
    // 流式请求仍由后端继续读取时，显式取消可以停止继续消费 token。
    void aiSessionChatStreamCancel(requestId);
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !activeSessionId || pending) return;
    if (!aiAvailable) {
      setErrorMessage(aiUnavailableMessage ?? "AI 助手当前不可用");
      return;
    }

    const nextUserMessage: AiChatMessage = {
      role: "user",
      content,
    };
    const nextMessages = messages.concat(nextUserMessage);
    const nextRequestId = crypto.randomUUID();
    pendingRequestIdRef.current = nextRequestId;
    setMessages(
      nextMessages.concat({
        role: "assistant",
        content: "",
      }),
    );
    setDraft("");
    setPending(true);
    setWaitingFirstChunk(true);
    setErrorMessage(null);

    try {
      if (debugLoggingEnabled) {
        void logInfo(
          JSON.stringify({
            event: "ai.session-chat.request",
            sessionId: activeSessionId,
            requestId: nextRequestId,
            responseLanguageStrategy: "follow_user_input",
            uiLanguage: locale,
            content,
          }),
        );
      }
      await aiSessionChatStreamStart({
        requestId: nextRequestId,
        sessionId: activeSessionId,
        responseLanguageStrategy: "follow_user_input",
        uiLanguage: locale,
        messages: nextMessages,
      });
    } catch (error) {
      if (debugLoggingEnabled) {
        void logInfo(
          JSON.stringify({
            event: "ai.session-chat.error",
            sessionId: activeSessionId,
            requestId: nextRequestId,
            error: getErrorMessage(error),
          }),
        );
      }
      pendingRequestIdRef.current = null;
      setMessages((prev) => {
        const next = prev.slice();
        if (next[next.length - 1]?.role === "assistant") {
          next.pop();
        }
        if (next[next.length - 1] === nextUserMessage) {
          next.pop();
        }
        return next;
      });
      setDraft(content);
      setErrorMessage(getErrorMessage(error));
      setPending(false);
      setWaitingFirstChunk(false);
    }
  }

  async function sendSelectionText(selectionText: string) {
    const content = selectionText.trim();
    if (!content || !activeSessionId || pending) return;
    if (!aiAvailable) {
      setErrorMessage(aiUnavailableMessage ?? "AI 助手当前不可用");
      return;
    }

    const nextUserMessage: AiChatMessage = {
      role: "user",
      content,
    };
    setMessages((prev) => prev.concat(nextUserMessage));
    setPending(true);
    setErrorMessage(null);

    try {
      if (debugLoggingEnabled) {
        void logInfo(
          JSON.stringify({
            event: "ai.selection.request",
            sessionId: activeSessionId,
            responseLanguageStrategy: "follow_ui",
            uiLanguage: locale,
            selectionText: content,
          }),
        );
      }
      const response = await aiExplainSelection({
        sessionId: activeSessionId,
        responseLanguageStrategy: "follow_ui",
        uiLanguage: locale,
        selectionText: content,
      });
      if (debugLoggingEnabled) {
        void logInfo(
          JSON.stringify({
            event: "ai.selection.response",
            sessionId: activeSessionId,
            message: response.message,
          }),
        );
      }
      setMessages((prev) => prev.concat(response.message));
    } catch (error) {
      if (debugLoggingEnabled) {
        void logInfo(
          JSON.stringify({
            event: "ai.selection.error",
            sessionId: activeSessionId,
            error: getErrorMessage(error),
          }),
        );
      }
      setMessages((prev) => prev.filter((item) => item !== nextUserMessage));
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  function clearMessages() {
    cancelPendingRequest();
    setMessages([]);
    setErrorMessage(null);
  }

  return {
    messages,
    draft,
    pending,
    waitingFirstChunk,
    errorMessage,
    setDraft,
    sendMessage,
    sendSelectionText,
    cancelMessage: cancelPendingRequest,
    clearMessages,
  };
}
