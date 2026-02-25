import type { Locale, Translate } from "@/i18n";
import type {
  DisconnectReason,
  LogEntry,
  SessionStateUi,
  SftpProgress,
} from "@/types";
import { formatBytes } from "@/utils/format";

type LogPanelProps = {
  sessionState: SessionStateUi;
  sessionReason: DisconnectReason | null;
  reconnectInfo: { attempt: number; delayMs: number } | null;
  onReconnect: () => void;
  canReconnect: boolean;
  progress: SftpProgress | null;
  busyMessage: string | null;
  entries: LogEntry[];
  locale: Locale;
  t: Translate;
};

/** 会话日志与传输状态面板。 */
export default function LogPanel({
  sessionState,
  sessionReason,
  reconnectInfo,
  onReconnect,
  canReconnect,
  progress,
  busyMessage,
  entries,
  locale,
  t,
}: LogPanelProps) {
  const sessionLabelMap: Record<SessionStateUi, string> = {
    connected: t("session.connected"),
    disconnected: t("session.disconnected"),
    connecting: t("session.connecting"),
    error: t("session.error"),
    reconnecting: t("session.reconnecting"),
  };
  const sessionLabel = sessionLabelMap[sessionState] ?? sessionState;
  const reasonLabelMap: Record<DisconnectReason, string> = {
    exit: t("session.reason.exit"),
    poweroff: t("session.reason.poweroff"),
    reboot: t("session.reason.reboot"),
    network: t("session.reason.network"),
    unknown: t("session.reason.unknown"),
  };
  const reasonLabel = sessionReason
    ? reasonLabelMap[sessionReason]
    : t("session.reason.unknown");

  const formatLogTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  return (
    <div className="log-panel">
      <div className="log-row">
        <span>{t("log.sessionState")}</span>
        <strong>{sessionLabel}</strong>
      </div>
      {sessionState !== "connected" && sessionReason && (
        <div className="log-row">
          <span>{t("log.disconnectReason")}</span>
          <div className="log-actions">
            <strong>{reasonLabel}</strong>
            {canReconnect && (
              <button className="ghost" onClick={onReconnect}>
                {t("actions.reconnect")}
              </button>
            )}
          </div>
        </div>
      )}
      {reconnectInfo && (
        <div className="log-row">
          <span>{t("log.reconnect")}</span>
          <strong>
            {t("log.reconnectAttempt", {
              attempt: String(reconnectInfo.attempt),
              delay: String(Math.ceil(reconnectInfo.delayMs / 1000)),
            })}
          </strong>
        </div>
      )}
      <div className="log-row">
        <span>{t("log.currentTask")}</span>
        <strong>{busyMessage ?? t("log.idle")}</strong>
      </div>
      {progress && (
        <div className="log-progress">
          <div className="log-row">
            <span>
              {progress.op === "upload" ? t("log.upload") : t("log.download")}
            </span>
            <strong>{progress.path}</strong>
          </div>
          <div className="progress-bar">
            <span
              style={{
                width: progress.total
                  ? `${Math.min(100, (progress.transferred / progress.total) * 100)}%`
                  : "30%",
              }}
            />
          </div>
          <div className="log-row small">
            <span>{formatBytes(progress.transferred)}</span>
            <span>
              {progress.total
                ? formatBytes(progress.total)
                : t("log.unknownSize")}
            </span>
          </div>
        </div>
      )}
      {!!entries.length && (
        <div className="log-list">
          <div className="log-list-header">{t("log.history")}</div>
          <div className="log-list-body">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`log-item ${entry.level ?? "info"}`}
              >
                <span className="log-time">
                  {formatLogTime(entry.timestamp)}
                </span>
                <span className="log-message">{t(entry.key, entry.vars)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
