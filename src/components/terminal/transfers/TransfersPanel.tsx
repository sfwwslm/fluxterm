import type { Locale, Translate } from "@/i18n";
import type { LogEntry, SftpProgress } from "@/types";
import { formatBytes } from "@/utils/format";

type TransfersPanelProps = {
  progress: SftpProgress | null;
  busyMessage: string | null;
  entries: LogEntry[];
  locale: Locale;
  t: Translate;
};

const isTransferKey = (key: string) =>
  key.includes("upload") || key.includes("download");

/** 传输进度与记录面板。 */
export default function TransfersPanel({
  progress,
  busyMessage,
  entries,
  locale,
  t,
}: TransfersPanelProps) {
  const transferEntries = entries.filter((entry) => isTransferKey(entry.key));

  const formatLogTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  return (
    <div className="log-panel">
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
      {!!transferEntries.length && (
        <div className="log-list">
          <div className="log-list-header">{t("log.history")}</div>
          <div className="log-list-body">
            {transferEntries.map((entry) => (
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
