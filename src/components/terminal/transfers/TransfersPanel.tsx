import { useEffect, useState } from "react";
import type { Locale, Translate } from "@/i18n";
import type { LogEntry, SftpProgress } from "@/types";
import { formatBytes, formatTime } from "@/utils/format";
import "./TransfersPanel.css";

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
  const [progressStartedAt, setProgressStartedAt] = useState<number | null>(
    null,
  );
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null);

  const formatLogTime = (timestamp: number) =>
    formatTime(timestamp / 1000, locale);

  const progressLabel = progress
    ? progress.op === "upload"
      ? t("log.upload")
      : t("log.download")
    : "";

  useEffect(() => {
    if (!progress) {
      setActiveTransferId(null);
      setProgressStartedAt(null);
      return;
    }
    if (progress.transferId !== activeTransferId) {
      setActiveTransferId(progress.transferId);
      setProgressStartedAt(Date.now());
      return;
    }
    setProgressStartedAt((prev) => prev ?? Date.now());
  }, [activeTransferId, progress]);

  return (
    <div className="log-panel">
      <div className="log-row">
        <span>{t("log.currentTask")}</span>
        <strong>{busyMessage ?? t("log.idle")}</strong>
      </div>
      {progress && (
        <div className="log-progress">
          <div className="log-row log-row-transfer">
            <span className="log-transfer-meta">
              [
              {progressStartedAt
                ? formatTime(progressStartedAt / 1000, locale)
                : "--"}
              ] [{progressLabel}]{" "}
            </span>
            <strong className="log-transfer-path" title={progress.path}>
              {progress.path}
            </strong>
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
