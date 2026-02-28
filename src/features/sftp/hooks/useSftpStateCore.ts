/**
 * SFTP 状态核心 Hook。
 * 职责：维护目录视图、传输进度与文件操作流程。
 */
import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Translate, TranslationKey } from "@/i18n";
import type {
  LogLevel,
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

  const activeFileView = useMemo(() => {
    if (!activeSessionId) return null;
    return fileViews[activeSessionId] ?? null;
  }, [fileViews, activeSessionId]);

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

  async function refreshList(path = currentPath, sessionId = activeSessionId) {
    if (!sessionId) return;
    if (isLocalSession(sessionId)) {
      const normalizedPath = normalizeLocalPath(path);
      const list = await localList(normalizedPath);
      updateFileView(sessionId, normalizedPath, list);
      return;
    }
    if (sessionStatesRef.current[sessionId] !== "connected") {
      updateFileView(sessionId, "", []);
      return;
    }
    // 远端目录不能为空。连接建立初期 currentPath 可能还是空串，此时先回退到 home，
    // 避免向后端发送 read_dir("") 导致无意义的 No such file 告警。
    if (!path.trim()) {
      await loadHomePath(sessionId);
      return;
    }
    const list = await sftpList(sessionId, path);
    updateFileView(sessionId, path, list);
  }

  async function loadHomePath(sessionId = activeSessionId) {
    if (!sessionId) return;
    if (isLocalSession(sessionId)) {
      const home = await localHome();
      await refreshList(home, sessionId);
      return;
    }
    if (sessionStatesRef.current[sessionId] !== "connected") {
      updateFileView(sessionId, "", []);
      return;
    }
    const home = await sftpHome(sessionId);
    await refreshList(home, sessionId);
  }

  async function openRemoteDir(path: string) {
    if (!activeSessionId) return;
    if (isLocalSession(activeSessionId)) {
      await refreshList(path, activeSessionId);
      return;
    }
    const resolvedPath = await sftpResolvePath(activeSessionId, path);
    await refreshList(resolvedPath, activeSessionId);
  }

  async function uploadFile() {
    if (!activeSession) return;
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
    if (!name) return;
    const path = currentPath.endsWith("/")
      ? `${currentPath}${name}`
      : `${currentPath}/${name}`;
    await sftpMkdir(activeSession.sessionId, path);
    await refreshList();
  }

  async function rename(entry: SftpEntry, name: string) {
    if (!activeSession) return;
    if (!name || name === entry.name) return;
    const base = currentPath.endsWith("/") ? currentPath : `${currentPath}/`;
    const to = `${base}${name}`;
    await sftpRename(activeSession.sessionId, entry.path, to);
    await refreshList();
  }

  async function remove(entry: SftpEntry) {
    if (!activeSession) return;
    await sftpRemove(activeSession.sessionId, entry.path);
    await refreshList();
  }

  useEffect(() => {
    if (!activeSessionId) return;
    loadHomePath(activeSessionId).catch(() => {});
  }, [activeSessionId, activeSessionState]);

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

  useEffect(() => {
    if (!activeSessionId) return;
    if (sessionStatesRef.current[activeSessionId] !== "connected") return;
    refreshList(currentPath, activeSessionId).catch(() => {});
  }, [activeSessionId, activeSessionState]);

  return {
    currentPath,
    entries,
    progressBySession,
    refreshList,
    openRemoteDir,
    uploadFile,
    downloadFile,
    createFolder,
    rename,
    remove,
  };
}
