import { useCallback, useMemo, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { error as logError, info as logInfo } from "@/shared/logging/telemetry";
import {
  checkForAppUpdate,
  downloadAndInstallUpdate,
} from "@/features/updater/core/updaterService";

export type AppUpdaterStatus =
  | "idle"
  | "checking"
  | "update-available"
  | "downloading";

export type AppUpdateIndicator = "none" | "success" | "error";

/** 主窗口更新编排状态。 */
export type AppUpdaterState = {
  status: AppUpdaterStatus;
  indicator: AppUpdateIndicator;
  hasAvailableUpdate: boolean;
  downloadProgressPercent: number | null;
  isChecking: boolean;
  isDownloading: boolean;
  triggerUpdateAction: () => Promise<void>;
  resetCheckState: () => void;
};

/** 管理应用更新检查与安装流程。 */
export default function useAppUpdater(): AppUpdaterState {
  const [status, setStatus] = useState<AppUpdaterStatus>("idle");
  const [indicator, setIndicator] = useState<AppUpdateIndicator>("none");
  const [downloadProgressPercent, setDownloadProgressPercent] = useState<
    number | null
  >(null);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const installRunningRef = useRef(false);

  const isChecking = status === "checking";
  const isDownloading = status === "downloading";
  const hasAvailableUpdate = status === "update-available" && !!pendingUpdate;

  const installAvailableUpdate = useCallback(async () => {
    if (
      !pendingUpdate ||
      isChecking ||
      isDownloading ||
      installRunningRef.current
    ) {
      return;
    }
    installRunningRef.current = true;
    setStatus("downloading");
    setDownloadProgressPercent(0);
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      await downloadAndInstallUpdate(pendingUpdate, (event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setDownloadProgressPercent(0);
          return;
        }
        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            const percent = Math.min(
              100,
              Math.round((downloadedBytes / totalBytes) * 100),
            );
            setDownloadProgressPercent(percent);
          }
          return;
        }
        setDownloadProgressPercent(100);
      });
      setPendingUpdate(null);
      setStatus("idle");
      await logInfo(
        JSON.stringify({
          event: "app.update.install",
          result: "success",
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("idle");
      setIndicator("error");
      await logError(
        JSON.stringify({
          event: "app.update.install.failed",
          message,
        }),
      );
    } finally {
      installRunningRef.current = false;
    }
  }, [isChecking, isDownloading, pendingUpdate]);

  const checkForUpdates = useCallback(async () => {
    if (isChecking || isDownloading || installRunningRef.current) return;
    setStatus("checking");
    setDownloadProgressPercent(null);
    try {
      const result = await checkForAppUpdate();
      if (!result.available || !result.update) {
        setPendingUpdate(null);
        setStatus("idle");
        await logInfo(
          JSON.stringify({
            event: "app.update.check",
            result: "up-to-date",
          }),
        );
        return;
      }
      setPendingUpdate(result.update);
      setIndicator("success");
      setStatus("update-available");
      await logInfo(
        JSON.stringify({
          event: "app.update.check",
          result: "update-available",
          version: result.version,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPendingUpdate(null);
      setStatus("idle");
      setIndicator("error");
      await logError(
        JSON.stringify({
          event: "app.update.check.failed",
          message,
        }),
      );
    }
  }, [isChecking, isDownloading]);

  const triggerUpdateAction = useCallback(async () => {
    if (hasAvailableUpdate) {
      await installAvailableUpdate();
      return;
    }
    await checkForUpdates();
  }, [checkForUpdates, hasAvailableUpdate, installAvailableUpdate]);

  const resetCheckState = useCallback(() => {
    setIndicator("none");
    setDownloadProgressPercent(null);
    if (!isDownloading) {
      setPendingUpdate(null);
      setStatus("idle");
    }
  }, [isDownloading]);

  return useMemo(
    () => ({
      status,
      indicator,
      hasAvailableUpdate,
      downloadProgressPercent,
      isChecking,
      isDownloading,
      triggerUpdateAction,
      resetCheckState,
    }),
    [
      indicator,
      hasAvailableUpdate,
      downloadProgressPercent,
      isChecking,
      isDownloading,
      triggerUpdateAction,
      resetCheckState,
      status,
    ],
  );
}
