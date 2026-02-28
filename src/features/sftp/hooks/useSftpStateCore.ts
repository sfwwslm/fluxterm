/**
 * SFTP 状态核心 Hook。
 * 职责：维护目录视图、传输进度与文件操作流程。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { warn } from "@tauri-apps/plugin-log";
import type { Translate, TranslationKey } from "@/i18n";
import type {
  LogLevel,
  SftpAvailability,
  SftpEntry,
  SftpProgress,
  Session,
  SessionStateUi,
} from "@/types";
import { normalizeLocalPath } from "@/features/sftp/core/path";
import {
  localHome,
  localList,
  sftpDownload,
  sftpHome,
  sftpList,
  sftpMkdir,
  sftpRemove,
  sftpResolvePath,
  sftpRename,
  sftpUpload,
} from "@/features/sftp/core/commands";
import { registerSftpProgressListener } from "@/features/sftp/core/listeners";

type UseSftpStateProps = {
  enabled: boolean;
  active: boolean;
  activeSessionId: string | null;
  activeSession: Session | null;
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
  downloadFile: (entry: SftpEntry) => Promise<void>;
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
      warn(
        JSON.stringify({
          event: "sftp:unsupported",
          sessionId,
          error:
            typeof error === "object" && error !== null
              ? {
                  code:
                    "code" in error && typeof error.code === "string"
                      ? error.code
                      : null,
                  message:
                    "message" in error && typeof error.message === "string"
                      ? error.message
                      : String(error),
                  detail:
                    "detail" in error && typeof error.detail === "string"
                      ? error.detail
                      : null,
                }
              : { code: null, message: String(error), detail: null },
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
    const remotePath = currentPath.endsWith("/")
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`;
    appendLog("log.event.uploadStart", { name: fileName });
    setBusyMessage(t("messages.uploading"));
    try {
      await sftpUpload(activeSession.sessionId, file, remotePath);
      await refreshList();
      setBusyMessage(null);
      appendLog("log.event.uploadDone", { name: fileName }, "success");
    } catch {
      setBusyMessage("上传失败");
      appendLog("log.event.uploadFailed", { name: fileName }, "error");
    }
  }

  async function downloadFile(entry: SftpEntry) {
    if (!activeSession) return;
    if (!enabled && !isLocalSession(activeSession.sessionId)) return;
    const target = await save({ defaultPath: entry.name });
    if (!target) return;
    appendLog("log.event.downloadStart", { name: entry.name });
    setBusyMessage(t("messages.downloading"));
    try {
      await sftpDownload(activeSession.sessionId, entry.path, target);
      setBusyMessage(null);
      appendLog("log.event.downloadDone", { name: entry.name }, "success");
    } catch {
      setBusyMessage("下载失败");
      appendLog("log.event.downloadFailed", { name: entry.name }, "error");
    }
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
      setSessionAvailability(activeSessionId, "disabled");
      clearFileView(activeSessionId);
      return;
    }
    // 这里不能把 isLocalSession 函数引用直接作为初始化触发条件，
    // 否则上层 render 时函数 identity 变化会让目录初始化 effect 反复重跑。
    loadHomePath(activeSessionId).catch(() => {});
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
        setProgressBySession((prev) => ({
          ...prev,
          [payload.sessionId]: payload,
        }));
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
    downloadFile,
    createFolder,
    rename,
    remove,
  };
}
