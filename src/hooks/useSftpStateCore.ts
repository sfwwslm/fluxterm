/**
 * SFTP 状态核心 Hook。
 * 职责：维护目录视图、传输进度与文件操作流程。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { info } from "@/shared/logging/telemetry";
import type { Translate, TranslationKey } from "@/i18n";
import type {
  HostProfile,
  LogLevel,
  SftpAvailability,
  SftpEntry,
  SftpProgress,
  Session,
  SessionStateUi,
} from "@/types";
import { normalizeLocalPath } from "@/features/sftp/core/path";
import { extractErrorMessage } from "@/shared/errors/appError";
import {
  localHome,
  localList,
  sftpCancelTransfer,
  sftpDownload,
  sftpDownloadDir,
  sftpHome,
  sftpList,
  sftpMkdir,
  sftpRemove,
  sftpResolvePath,
  sftpRename,
  sftpUploadBatch,
} from "@/features/sftp/core/commands";
import { registerSftpProgressListener } from "@/features/sftp/core/listeners";

type UseSftpStateProps = {
  enabled: boolean;
  active: boolean;
  activeSessionId: string | null;
  activeSession: Session | null;
  activeSessionProfile: HostProfile | null;
  activeSessionState: SessionStateUi | null;
  sessionStatesRef: React.RefObject<Record<string, SessionStateUi>>;
  isLocalSession: (sessionId: string | null) => boolean;
  appendLog: (
    key: TranslationKey,
    vars?: Record<string, string | number>,
    level?: LogLevel,
  ) => void;
  setBusyMessage: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
};

type UseSftpStateResult = {
  currentPath: string;
  entries: SftpEntry[];
  progressBySession: Record<string, SftpProgress>;
  availabilityBySession: Record<string, SftpAvailability>;
  refreshList: (path?: string, sessionId?: string | null) => Promise<void>;
  openRemoteDir: (path: string) => Promise<void>;
  uploadFile: () => Promise<void>;
  uploadDroppedPaths: (paths: string[]) => Promise<void>;
  downloadFile: (entry: SftpEntry) => Promise<void>;
  cancelTransfer: () => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  rename: (entry: SftpEntry, name: string) => Promise<void>;
  remove: (entry: SftpEntry) => Promise<void>;
};

/** SFTP 目录与传输状态管理。 */
export default function useSftpState({
  enabled,
  active,
  activeSessionId,
  activeSession,
  activeSessionProfile,
  activeSessionState,
  sessionStatesRef,
  isLocalSession,
  appendLog,
  setBusyMessage,
  t,
}: UseSftpStateProps): UseSftpStateResult {
  const [fileViews, setFileViews] = useState<
    Record<string, { path: string; entries: SftpEntry[] }>
  >({});
  const [progressBySession, setProgressBySession] = useState<
    Record<string, SftpProgress>
  >({});
  const [availabilityBySession, setAvailabilityBySession] = useState<
    Record<string, SftpAvailability>
  >({});
  const unsupportedLoggedRef = useRef<Record<string, boolean>>({});
  const progressBySessionRef = useRef<Record<string, SftpProgress>>({});
  const clearFileViewRef = useRef<(sessionId: string) => void>(() => {});
  const loadHomePathRef = useRef<
    (sessionId?: string | null) => Promise<void>
  >(async () => {});

  const activeFileView = useMemo(() => {
    if (!activeSessionId) return null;
    return fileViews[activeSessionId] ?? null;
  }, [fileViews, activeSessionId]);
  const activeSessionIsLocal = useMemo(
    () => isLocalSession(activeSessionId),
    [activeSessionId, isLocalSession],
  );

  const currentPath = activeFileView?.path ?? "";
  const entries = activeFileView?.entries ?? [];

  function joinLocalTargetPath(directory: string, name: string) {
    const normalizedDirectory = normalizeLocalPath(directory);
    if (
      normalizedDirectory.endsWith("\\") ||
      normalizedDirectory.endsWith("/")
    ) {
      return `${normalizedDirectory}${name}`;
    }
    return `${normalizedDirectory}\\${name}`;
  }

  function updateFileView(
    sessionId: string,
    path: string,
    entries: SftpEntry[],
  ) {
    setFileViews((prev) => ({
      ...prev,
      [sessionId]: { path, entries },
    }));
  }

  function setSessionAvailability(
    sessionId: string,
    availability: SftpAvailability,
  ) {
    setAvailabilityBySession((prev) =>
      prev[sessionId] === availability
        ? prev
        : { ...prev, [sessionId]: availability },
    );
  }

  /** 同步最近一次传输进度，供传输面板展示与下载完成日志复用。 */
  function syncProgressEntry(payload: SftpProgress) {
    progressBySessionRef.current = {
      ...progressBySessionRef.current,
      [payload.sessionId]: payload,
    };
    setProgressBySession((prev) => ({
      ...prev,
      [payload.sessionId]: payload,
    }));
  }

  function clearFileView(sessionId: string) {
    updateFileView(sessionId, "", []);
  }

  function isSftpInitUnsupported(error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "";
    return code === "sftp_init_failed";
  }

  function markUnsupported(sessionId: string, error: unknown) {
    setSessionAvailability(sessionId, "unsupported");
    clearFileView(sessionId);
    // 服务器不支持 SFTP 时，只在当前会话首次失败时记录一次，
    // 后续直接保持 unsupported 状态，避免自动初始化反复刷日志。
    if (!unsupportedLoggedRef.current[sessionId]) {
      unsupportedLoggedRef.current[sessionId] = true;
      appendLog("log.event.sftpUnsupported");
      info(
        JSON.stringify({
          event: "sftp:unsupported",
          sessionId,
          profileId: activeSessionProfile?.id ?? null,
          host: activeSessionProfile?.host ?? null,
          port: activeSessionProfile?.port ?? null,
          error:
            typeof error === "object" && error !== null
              ? {
                  code:
                    "code" in error && typeof error.code === "string"
                      ? error.code
                      : null,
                  message: extractErrorMessage(error),
                  detail:
                    "details" in error && typeof error.details === "string"
                      ? error.details
                      : "detail" in error && typeof error.detail === "string"
                        ? error.detail
                        : null,
                }
              : {
                  code: null,
                  message: extractErrorMessage(error),
                  detail: null,
                },
        }),
      ).catch(() => {});
    }
  }

  async function refreshList(path = currentPath, sessionId = activeSessionId) {
    if (!sessionId) return;
    if (isLocalSession(sessionId)) {
      setSessionAvailability(sessionId, "ready");
      const normalizedPath = normalizeLocalPath(path);
      const list = await localList(normalizedPath);
      updateFileView(sessionId, normalizedPath, list);
      return;
    }
    if (!enabled || !active) {
      setSessionAvailability(sessionId, "disabled");
      clearFileView(sessionId);
      return;
    }
    if (availabilityBySession[sessionId] === "unsupported") {
      clearFileView(sessionId);
      return;
    }
    if (sessionStatesRef.current[sessionId] !== "connected") {
      clearFileView(sessionId);
      return;
    }
    // 远端目录不能为空。连接建立初期 currentPath 可能还是空串，此时先回退到 home，
    // 避免向后端发送 read_dir("") 导致无意义的 No such file 告警。
    if (!path.trim()) {
      await loadHomePath(sessionId);
      return;
    }
    try {
      const list = await sftpList(sessionId, path);
      setSessionAvailability(sessionId, "ready");
      updateFileView(sessionId, path, list);
    } catch (error) {
      if (isSftpInitUnsupported(error)) {
        markUnsupported(sessionId, error);
        return;
      }
      throw error;
    }
  }

  async function loadHomePath(sessionId = activeSessionId) {
    if (!sessionId) return;
    if (isLocalSession(sessionId)) {
      setSessionAvailability(sessionId, "ready");
      const home = await localHome();
      await refreshList(home, sessionId);
      return;
    }
    if (!enabled || !active) {
      setSessionAvailability(sessionId, "disabled");
      clearFileView(sessionId);
      return;
    }
    if (availabilityBySession[sessionId] === "unsupported") {
      clearFileView(sessionId);
      return;
    }
    if (sessionStatesRef.current[sessionId] !== "connected") {
      clearFileView(sessionId);
      return;
    }
    // 远端会话开始初始化 SFTP 但尚未拿到结果前，先标记为 checking，
    // 让文件面板和联动图标都能显示“正在检测”而不是误导成空目录或已可用。
    setSessionAvailability(sessionId, "checking");
    try {
      const home = await sftpHome(sessionId);
      setSessionAvailability(sessionId, "ready");
      await refreshList(home, sessionId);
    } catch (error) {
      if (isSftpInitUnsupported(error)) {
        markUnsupported(sessionId, error);
        return;
      }
      throw error;
    }
  }

  useEffect(() => {
    clearFileViewRef.current = clearFileView;
    loadHomePathRef.current = loadHomePath;
  });

  async function openRemoteDir(path: string) {
    if (!activeSessionId) return;
    if (isLocalSession(activeSessionId)) {
      await refreshList(path, activeSessionId);
      return;
    }
    if (!enabled || !active) {
      setSessionAvailability(activeSessionId, "disabled");
      clearFileView(activeSessionId);
      return;
    }
    if (availabilityBySession[activeSessionId] === "unsupported") {
      clearFileView(activeSessionId);
      return;
    }
    setSessionAvailability(activeSessionId, "checking");
    try {
      const resolvedPath = await sftpResolvePath(activeSessionId, path);
      setSessionAvailability(activeSessionId, "ready");
      await refreshList(resolvedPath, activeSessionId);
    } catch (error) {
      if (isSftpInitUnsupported(error)) {
        markUnsupported(activeSessionId, error);
        return;
      }
      throw error;
    }
  }

  async function uploadFile() {
    if (!activeSession) return;
    if (!enabled && !isLocalSession(activeSession.sessionId)) return;
    const file = await open({ multiple: false });
    if (!file || Array.isArray(file)) return;
    const fileName = file.split(/[\\/]/).pop() ?? "upload.bin";
    appendLog("log.event.uploadStart", { name: fileName });
    setBusyMessage(t("messages.uploading"));
    try {
      await sftpUploadBatch(activeSession.sessionId, [file], currentPath);
      await refreshList();
      setBusyMessage(null);
      const latestProgress =
        progressBySessionRef.current[activeSession.sessionId] ?? null;
      if (latestProgress?.status === "cancelled") {
        appendLog("log.event.uploadCancelled", { name: fileName });
      } else {
        appendLog("log.event.uploadDone", { name: fileName }, "success");
      }
    } catch {
      setBusyMessage("上传失败");
      appendLog("log.event.uploadFailed", { name: fileName }, "error");
    }
  }

  async function uploadDroppedPaths(paths: string[]) {
    if (!activeSession) return;
    if (!enabled && !isLocalSession(activeSession.sessionId)) return;
    const normalizedPaths = paths.filter((path) => path.trim().length > 0);
    if (!normalizedPaths.length) return;
    const uploadLabel =
      normalizedPaths.length > 1
        ? t("log.itemsCount", { count: normalizedPaths.length })
        : (normalizedPaths[0]?.split(/[\\/]/).pop() ?? "upload.bin");
    appendLog("log.event.uploadStart", { name: uploadLabel });
    setBusyMessage(t("messages.uploading"));
    try {
      await sftpUploadBatch(
        activeSession.sessionId,
        normalizedPaths,
        currentPath,
      );
      await refreshList();
      setBusyMessage(null);
      const latestProgress =
        progressBySessionRef.current[activeSession.sessionId] ?? null;
      if (latestProgress?.status === "cancelled") {
        appendLog("log.event.uploadCancelled", { name: uploadLabel });
      } else if (latestProgress?.status === "partial_success") {
        appendLog("log.event.uploadFailed", { name: uploadLabel }, "error");
      } else {
        appendLog("log.event.uploadDone", { name: uploadLabel }, "success");
      }
    } catch {
      setBusyMessage("上传失败");
      appendLog("log.event.uploadFailed", { name: uploadLabel }, "error");
    }
  }

  /**
   * 下载文件或目录条目。
   *
   * 单文件和目录下载都使用“选择目录”对话框，
   * 由后端统一决定最终落地文件名和重名避让策略。
   */
  async function downloadFile(entry: SftpEntry) {
    if (!activeSession) return;
    if (!enabled && !isLocalSession(activeSession.sessionId)) return;
    const target = await open({ directory: true, multiple: false });
    if (!target) return;
    appendLog("log.event.downloadStart", { name: entry.name });
    setBusyMessage(t("messages.downloading"));
    try {
      if (entry.kind === "dir") {
        if (Array.isArray(target)) return;
        await sftpDownloadDir(activeSession.sessionId, entry.path, target);
      } else {
        if (Array.isArray(target)) return;
        await sftpDownload(
          activeSession.sessionId,
          entry.path,
          joinLocalTargetPath(target, entry.name),
        );
      }
      setBusyMessage(null);
      const latestProgress =
        progressBySessionRef.current[activeSession.sessionId] ?? null;
      if (latestProgress?.status === "cancelled") {
        appendLog("log.event.downloadCancelled", {
          name:
            latestProgress.totalItems && latestProgress.totalItems > 1
              ? t("log.itemsCount", { count: latestProgress.totalItems })
              : entry.name,
        });
      } else if (latestProgress?.status === "partial_success") {
        appendLog(
          "log.event.downloadPartial",
          {
            name:
              latestProgress.totalItems && latestProgress.totalItems > 1
                ? t("log.itemsCount", { count: latestProgress.totalItems })
                : entry.name,
            failed: latestProgress.failedItems,
          },
          "error",
        );
      } else {
        appendLog(
          "log.event.downloadDone",
          {
            name:
              latestProgress?.totalItems && latestProgress.totalItems > 1
                ? t("log.itemsCount", { count: latestProgress.totalItems })
                : entry.name,
          },
          "success",
        );
      }
    } catch {
      setBusyMessage("下载失败");
      appendLog("log.event.downloadFailed", { name: entry.name }, "error");
    }
  }

  /**
   * 取消当前活动会话最近一个运行中的传输任务。
   *
   * 取消请求会发给后端真实传输任务，而不是只在前端隐藏进度。
   * 任务最终状态会由后端进度事件回写为 `cancelled`。
   */
  async function cancelTransfer() {
    if (!activeSessionId) return;
    const progress = progressBySessionRef.current[activeSessionId];
    if (!progress || progress.status !== "running") return;
    await sftpCancelTransfer(activeSessionId, progress.transferId);
    setBusyMessage(null);
  }

  async function createFolder(name: string) {
    if (!activeSession) return;
    if (!enabled && !isLocalSession(activeSession.sessionId)) return;
    if (!name) return;
    const path = currentPath.endsWith("/")
      ? `${currentPath}${name}`
      : `${currentPath}/${name}`;
    await sftpMkdir(activeSession.sessionId, path);
    await refreshList();
  }

  async function rename(entry: SftpEntry, name: string) {
    if (!activeSession) return;
    if (!enabled && !isLocalSession(activeSession.sessionId)) return;
    if (!name || name === entry.name) return;
    const base = currentPath.endsWith("/") ? currentPath : `${currentPath}/`;
    const to = `${base}${name}`;
    await sftpRename(activeSession.sessionId, entry.path, to);
    await refreshList();
  }

  async function remove(entry: SftpEntry) {
    if (!activeSession) return;
    if (!enabled && !isLocalSession(activeSession.sessionId)) return;
    await sftpRemove(activeSession.sessionId, entry.path);
    await refreshList();
  }

  useEffect(() => {
    if (!activeSessionId) return;
    if ((!enabled || !active) && !activeSessionIsLocal) {
      queueMicrotask(() => {
        setSessionAvailability(activeSessionId, "disabled");
        clearFileViewRef.current(activeSessionId);
      });
      return;
    }
    // 初始化只由会话/连接状态驱动；避免函数 identity 变化导致重复触发。
    loadHomePathRef.current(activeSessionId).catch(() => {});
  }, [
    active,
    activeSessionId,
    activeSessionIsLocal,
    activeSessionState,
    enabled,
  ]);

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | null = null;
    const registerListeners = async () => {
      const progressUnlisten = await registerSftpProgressListener((payload) => {
        syncProgressEntry(payload);
      });
      if (cancelled) {
        progressUnlisten();
        return;
      }
      teardown = progressUnlisten;
    };
    registerListeners().catch(() => {});
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  // 会话建立后的目录初始化统一走 loadHomePath -> refreshList(home) 这条链路，
  // 不能再额外监听 currentPath 自动 refresh，否则首连时会把同一路径重复 list 一次。

  return {
    currentPath,
    entries,
    progressBySession,
    availabilityBySession,
    refreshList,
    openRemoteDir,
    uploadFile,
    uploadDroppedPaths,
    downloadFile,
    cancelTransfer,
    createFolder,
    rename,
    remove,
  };
}
