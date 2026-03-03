import Button from "@/components/ui/button";
import type { Translate } from "@/i18n";
import type { AiChatMessage } from "@/features/ai/types";
import "./AiPanel.css";

type AiPanelProps = {
  activeSessionId: string | null;
  messages: AiChatMessage[];
  draft: string;
  pending: boolean;
  errorMessage: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => Promise<void>;
  onClear: () => void;
  t: Translate;
};

/** AI 会话上下文问答面板。 */
export default function AiPanel({
  activeSessionId,
  messages,
  draft,
  pending,
  errorMessage,
  onDraftChange,
  onSend,
  onClear,
  t,
}: AiPanelProps) {
  const canChat = !!activeSessionId && !pending;

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
          {activeSessionId ? t("ai.sessionReady") : t("ai.sessionMissing")}
        </span>
      </div>

      <div className="ai-panel-messages">
        {!messages.length && !errorMessage && (
          <div className="ai-panel-empty">
            {activeSessionId
              ? t("ai.emptyWithSession")
              : t("ai.emptyWithoutSession")}
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}-${message.content.slice(0, 20)}`}
            className={`ai-message ${message.role === "user" ? "user" : "assistant"}`}
          >
            {message.content}
          </div>
        ))}
      </div>

      {errorMessage && <div className="ai-panel-error">{errorMessage}</div>}

      <div className="ai-panel-input">
        <textarea
          className="ai-panel-textarea"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={t("ai.inputPlaceholder")}
          disabled={!activeSessionId || pending}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            onSend().catch(() => {});
          }}
        />
        <div className="ai-panel-actions">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onSend().catch(() => {});
            }}
            disabled={!canChat || !draft.trim()}
          >
            {pending ? t("ai.sending") : t("ai.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}
