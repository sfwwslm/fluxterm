import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import Button from "@/components/ui/button";
import type { Translate } from "@/i18n";
import type { AiChatMessage } from "@/features/ai/types";
import "./AiPanel.css";

type AiPanelProps = {
  activeSessionId: string | null;
  aiAvailable: boolean;
  aiUnavailableMessage: string | null;
  messages: AiChatMessage[];
  draft: string;
  pending: boolean;
  waitingFirstChunk: boolean;
  errorMessage: string | null;
  keepLocalDraftBuffer?: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => Promise<void>;
  onCancel: () => void;
  onClear: () => void;
  t: Translate;
};

/** AI 会话上下文问答面板。 */
export default function AiPanel({
  activeSessionId,
  aiAvailable,
  aiUnavailableMessage,
  messages,
  draft,
  pending,
  waitingFirstChunk,
  errorMessage,
  keepLocalDraftBuffer = false,
  onDraftChange,
  onSend,
  onCancel,
  onClear,
  t,
}: AiPanelProps) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [localDraft, setLocalDraft] = useState(draft);
  const [isComposing, setIsComposing] = useState(false);
  const canChat = !!activeSessionId && !pending && aiAvailable;
  const textareaValue = keepLocalDraftBuffer ? localDraft : draft;

  useEffect(() => {
    if (!autoScroll) return;
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [autoScroll, messages, waitingFirstChunk, errorMessage]);

  useEffect(() => {
    if (keepLocalDraftBuffer && isComposing) return;
    setLocalDraft(draft);
  }, [draft, isComposing, keepLocalDraftBuffer]);

  useEffect(() => {
    // 输入区默认按单行起步，内容增多后再向上扩展，避免空状态占用过高。
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 40), 144);
    textarea.style.height = `${nextHeight}px`;
  }, [textareaValue]);

  async function copyMessage(content: string, key: string) {
    await writeText(content);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1500);
  }

  return (
    <div className="ai-panel">
      <div className="ai-panel-toolbar">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={!messages.length && !errorMessage}
        >
          {t("ai.clear")}
        </Button>
        <span className="ai-panel-status">
          {!activeSessionId
            ? t("ai.sessionMissing")
            : waitingFirstChunk
              ? t("ai.generating")
              : pending
                ? t("ai.streaming")
                : t("ai.sessionReady")}
        </span>
      </div>

      <div
        ref={messagesRef}
        className="ai-panel-messages"
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
          setAutoScroll(nearBottom);
        }}
      >
        {!messages.length && !errorMessage && (
          <div className="ai-panel-empty">
            {!aiAvailable && activeSessionId
              ? aiUnavailableMessage
              : activeSessionId
                ? t("ai.emptyWithSession")
                : t("ai.emptyWithoutSession")}
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}-${message.content.slice(0, 20)}`}
            className={`ai-message ${message.role === "user" ? "user" : "assistant"}`}
          >
            <div className="ai-message-toolbar">
              <span className="ai-message-role">
                {message.role === "user"
                  ? t("ai.message.user")
                  : t("ai.message.assistant")}
              </span>
              <button
                type="button"
                className="ai-message-copy"
                onClick={() => {
                  copyMessage(
                    message.content,
                    `${message.role}-${index}-${message.content.length}`,
                  ).catch(() => {});
                }}
              >
                {copiedKey ===
                `${message.role}-${index}-${message.content.length}`
                  ? t("actions.copied")
                  : t("actions.copy")}
              </button>
            </div>
            <div className="ai-message-body">
              {message.content ||
                (pending && message.role === "assistant" ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      {errorMessage && <div className="ai-panel-error">{errorMessage}</div>}

      <div className="ai-panel-input">
        <div className="ai-panel-input-shell">
          <textarea
            ref={textareaRef}
            className="ai-panel-textarea"
            value={textareaValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (keepLocalDraftBuffer) {
                setLocalDraft(nextValue);
              }
              if (!keepLocalDraftBuffer || !isComposing) {
                onDraftChange(nextValue);
              }
            }}
            onCompositionStart={() => {
              if (!keepLocalDraftBuffer) return;
              setIsComposing(true);
            }}
            onCompositionEnd={(event) => {
              if (!keepLocalDraftBuffer) return;
              const nextValue = event.currentTarget.value;
              setIsComposing(false);
              setLocalDraft(nextValue);
              onDraftChange(nextValue);
            }}
            onBlur={(event) => {
              if (!keepLocalDraftBuffer) return;
              const nextValue = event.currentTarget.value;
              setLocalDraft(nextValue);
              onDraftChange(nextValue);
            }}
            placeholder={t("ai.inputPlaceholder")}
            disabled={!activeSessionId || pending || !aiAvailable}
            rows={1}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              onSend().catch(() => {});
            }}
          />
          <div className="ai-panel-input-actions">
            <Button
              variant={pending ? "ghost" : "primary"}
              size="sm"
              className={`ai-panel-send ${pending ? "secondary" : ""}`}
              onClick={() => {
                if (pending) {
                  onCancel();
                  return;
                }
                onSend().catch(() => {});
              }}
              disabled={pending ? false : !canChat || !textareaValue.trim()}
            >
              {pending ? t("ai.stop") : t("ai.send")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
