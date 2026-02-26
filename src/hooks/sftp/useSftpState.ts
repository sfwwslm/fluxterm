import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Translate, TranslationKey } from "@/i18n";
import type {
  LogLevel,
  SftpEntry,
  SftpProgress,
  Session,
  SessionStateUi,
} from "@/types";

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
  createFolder: () => Promise<void>;
  rename: (entry: SftpEntry) => Promise<void>;
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

  function normalizeLocalPath(path: string) {
    if (!path) return path;
    if (path === "drives://") return path;
    if (/^[A-Za-z]:$/.test(path)) {
      return `${path}\\`;
    }
    return path;
  }

  async function refreshList(path = currentPath, sessionId = activeSessionId) {
    if (!sessionId) return;
    if (isLocalSession(sessionId)) {
      const normalizedPath = normalizeLocalPath(path);
      const list = await invoke<SftpEntry[]>("local_list", {
        path: normalizedPath,
      });
      updateFileView(sessionId, normalizedPath, list);
      return;
    }
    if (sessionStatesRef.current[sessionId] !== "connected") {
      updateFileView(sessionId, "", []);
      return;
    }
    const list = await invoke<SftpEntry[]>("sftp_list", {
      sessionId,
      path,
    });
    updateFileView(sessionId, path, list);
  }

  async function loadHomePath(sessionId = activeSessionId) {
    if (!sessionId) return;
    if (isLocalSession(sessionId)) {
      const home = await invoke<string>("local_home");
      await refreshList(home, sessionId);
      return;
    }
    if (sessionStatesRef.current[sessionId] !== "connected") {
      updateFileView(sessionId, "", []);
      return;
    }
    const home = await invoke<string>("sftp_home", { sessionId });
    await refreshList(home, sessionId);
  }

  async function openRemoteDir(path: string) {
    await refreshList(path);
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
      await invoke("sftp_upload", {
        sessionId: activeSession.sessionId,
        localPath: file,
        remotePath,
      });
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
      await invoke("sftp_download", {
        sessionId: activeSession.sessionId,
        remotePath: entry.path,
        localPath: target,
      });
      setBusyMessage(null);
      appendLog("log.event.downloadDone", { name: entry.name }, "success");
    } catch {
      setBusyMessage("下载失败");
      appendLog("log.event.downloadFailed", { name: entry.name }, "error");
    }
  }

  async function createFolder() {
    if (!activeSession) return;
    const name = window.prompt(t("prompts.newFolder"));
    if (!name) return;
    const path = currentPath.endsWith("/")
      ? `${currentPath}${name}`
      : `${currentPath}/${name}`;
    await invoke("sftp_mkdir", { sessionId: activeSession.sessionId, path });
    await refreshList();
  }

  async function rename(entry: SftpEntry) {
    if (!activeSession) return;
    const name = window.prompt(t("prompts.rename"), entry.name);
    if (!name || name === entry.name) return;
    const base = currentPath.endsWith("/") ? currentPath : `${currentPath}/`;
    const to = `${base}${name}`;
    await invoke("sftp_rename", {
      sessionId: activeSession.sessionId,
      from: entry.path,
      to,
    });
    await refreshList();
  }

  async function remove(entry: SftpEntry) {
    if (!activeSession) return;
    if (!window.confirm(t("prompts.confirmDelete", { name: entry.name }))) {
      return;
    }
    await invoke("sftp_remove", {
      sessionId: activeSession.sessionId,
      path: entry.path,
    });
    await refreshList();
  }

  useEffect(() => {
    if (!activeSessionId) return;
    loadHomePath(activeSessionId).catch(() => {});
  }, [activeSessionId, activeSessionState]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const registerListeners = async () => {
      const progressUnlisten = await listen<SftpProgress>(
        "sftp:progress",
        (event) => {
          setProgressBySession((prev) => ({
            ...prev,
            [event.payload.sessionId]: event.payload,
          }));
        },
      );
      if (cancelled) {
        progressUnlisten();
        return;
      }
      unlisteners.push(progressUnlisten);
    };
    registerListeners().catch(() => {});
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
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
