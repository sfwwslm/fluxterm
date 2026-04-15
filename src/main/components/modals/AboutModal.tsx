import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  FiClock,
  FiCopy,
  FiCpu,
  FiGitCommit,
  FiLayers,
  FiMonitor,
  FiTag,
} from "react-icons/fi";
import type { Translate } from "@/i18n";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import type {
  AppUpdateIndicator,
  AppUpdaterStatus,
} from "@/main/hooks/useAppUpdater";
import { getSystemInfo } from "@/shared/tauri/commands";
import {
  APP_VERSION,
  BUILD_TIME,
  COMMIT_HASH,
  PLATFORM_ARCH,
  RUNTIME_INFO,
  TECH_STACK_INFO,
} from "@/appInfo";
import "./AboutModal.css";

type AboutModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenDevtools?: () => void;
  onUpdateAction?: () => Promise<void> | void;
  updateStatus?: AppUpdaterStatus;
  hasAvailableUpdate?: boolean;
  updateIndicator?: AppUpdateIndicator;
  downloadProgressPercent?: number | null;
  updateBusy?: boolean;
  showUpdateAction?: boolean;
  t: Translate;
};

/** 关于弹窗。 */
export default function AboutModal({
  open,
  onClose,
  onOpenDevtools,
  onUpdateAction,
  updateStatus = "idle",
  hasAvailableUpdate = false,
  updateIndicator = "none",
  downloadProgressPercent = null,
  updateBusy = false,
  showUpdateAction = true,
  t,
}: AboutModalProps) {
  const [version, setVersion] = useState(APP_VERSION);
  const [platformArch, setPlatformArch] = useState(PLATFORM_ARCH);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">(
    "idle",
  );
  const displayVersion = version.startsWith("v") ? version : `v${version}`;
  const canOpenDevtools = import.meta.env.DEV && !!onOpenDevtools;
  const actionText =
    updateStatus === "downloading" &&
    typeof downloadProgressPercent === "number"
      ? t("about.updating")
      : updateStatus === "checking"
        ? t("about.checkingForUpdates")
        : updateStatus === "up-to-date"
          ? t("about.upToDate")
          : hasAvailableUpdate
            ? t("about.updateNow")
            : t("about.checkForUpdates");
  const diagnosticInfo = [
    `${t("about.version")}: ${displayVersion}`,
    `${t("about.hash")}: ${COMMIT_HASH}`,
    `${t("about.buildTime")}: ${BUILD_TIME}`,
    `${t("about.platformArch")}: ${platformArch}`,
    `${t("about.runtimeInfo")}: ${RUNTIME_INFO}`,
    `${t("about.techStackInfo")}: ${TECH_STACK_INFO}`,
  ].join("\n");

  useEffect(() => {
    const hasTauriRuntime =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!hasTauriRuntime) return;
    getVersion()
      .then((value) => setVersion(value))
      .catch(() => {});

    getSystemInfo()
      .then((value) =>
        setPlatformArch(
          `${value.osName} ${value.osVersion} (${value.arch})`.trim(),
        ),
      )
      .catch(() => {});
  }, []);

  const handleCopyDiagnostics = async () => {
    try {
      await writeText(diagnosticInfo);
      setCopyState("done");
    } catch {
      try {
        await navigator.clipboard.writeText(diagnosticInfo);
        setCopyState("done");
      } catch {
        setCopyState("failed");
      }
    }
    setTimeout(() => setCopyState("idle"), 1800);
  };

  return (
    <Modal
      open={open}
      title={t("about.title")}
      closeLabel={t("actions.close")}
      actions={
        <>
          {canOpenDevtools && (
            <Button variant="ghost" onClick={onOpenDevtools}>
              {t("about.openConsole")}
            </Button>
          )}
          {showUpdateAction && onUpdateAction && (
            <Button
              variant="ghost"
              onClick={() => {
                void onUpdateAction();
              }}
              disabled={updateBusy}
            >
              {typeof downloadProgressPercent === "number" && (
                <span className="about-update-progress">
                  {downloadProgressPercent}%
                </span>
              )}
              {updateIndicator !== "none" && (
                <span
                  className={`about-update-indicator about-update-indicator--${updateIndicator}`}
                  aria-hidden="true"
                />
              )}
              {actionText}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              void handleCopyDiagnostics();
            }}
          >
            <FiCopy size={14} />
            {copyState === "done"
              ? t("about.copyDiagnosticsDone")
              : copyState === "failed"
                ? t("about.copyDiagnosticsFailed")
                : t("about.copyDiagnostics")}
          </Button>
        </>
      }
      onClose={onClose}
    >
      <div className="about-list">
        <div className="about-row">
          <span className="about-label">
            <FiTag size={14} />
            {t("about.version")}
          </span>
          <strong>{displayVersion}</strong>
        </div>
        <div className="about-row">
          <span className="about-label">
            <FiGitCommit size={14} />
            {t("about.hash")}
          </span>
          <strong>{COMMIT_HASH}</strong>
        </div>
        <div className="about-row">
          <span className="about-label">
            <FiClock size={14} />
            {t("about.buildTime")}
          </span>
          <strong>{BUILD_TIME}</strong>
        </div>
        <div className="about-row">
          <span className="about-label">
            <FiCpu size={14} />
            {t("about.platformArch")}
          </span>
          <strong>{platformArch}</strong>
        </div>
        <div className="about-row">
          <span className="about-label">
            <FiMonitor size={14} />
            {t("about.runtimeInfo")}
          </span>
          <strong>{RUNTIME_INFO}</strong>
        </div>
        <div className="about-row">
          <span className="about-label">
            <FiLayers size={14} />
            {t("about.techStackInfo")}
          </span>
          <strong>{TECH_STACK_INFO}</strong>
        </div>
      </div>
    </Modal>
  );
}
