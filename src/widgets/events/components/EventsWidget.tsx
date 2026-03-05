import type { Locale, Translate } from "@/i18n";
import type { DisconnectReason, LogEntry, SessionStateUi } from "@/types";
import { formatDateTimeMs } from "@/utils/format";

type EventsWidgetProps = {
  sessionState: SessionStateUi;
  sessionReason: DisconnectReason | null;
  reconnectInfo: { attempt: number; delayMs: number } | null;
  entries: LogEntry[];
  locale: Locale;
  t: Translate;
};

const isTransferKey = (key: string) =>
  key.includes("upload") || key.includes("download");

/** 事件与连接状态面板。 */
export default function EventsWidget({
  sessionState,
  sessionReason,
  reconnectInfo,
  entries,
  locale,
  t,
}: EventsWidgetProps) {
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

  const eventEntries = entries.filter((entry) => !isTransferKey(entry.key));

  return (
    <div className="log-widget">
      <div className="log-row">
        <span>{t("log.sessionState")}</span>
        <strong>{sessionLabel}</strong>
      </div>
      {sessionState !== "connected" && sessionReason && (
        <div className="log-row">
          <span>{t("log.disconnectReason")}</span>
          <strong>{reasonLabel}</strong>
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
      {!!eventEntries.length && (
        <div className="log-list">
          <div className="log-list-header">{t("log.history")}</div>
          <div className="log-list-body">
            {eventEntries.map((entry) => (
              <div
                key={entry.id}
                className={`log-item ${entry.level ?? "info"}`}
              >
                <span className="log-time">
                  {formatDateTimeMs(entry.timestamp, locale)}
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
