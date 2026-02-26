import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { error as logError, info as logInfo } from "@tauri-apps/plugin-log";
import type { Translate, TranslationKey } from "@/i18n";
import type {
  DisconnectReason,
  HostProfile,
  LocalShellProfile,
  LogEntry,
  LogLevel,
  Session,
  SessionStateUi,
} from "@/types";
import { useNotices } from "@/hooks/useNotices";

const logStorageKey = "fluxterm.logs";
const maxLogEntries = 10;

type TerminalSize = { cols: number; rows: number };

type UseSessionStateProps = {
  profiles: HostProfile[];
  t: Translate;
  shellId: string | null;
  availableShells: LocalShellProfile[];
  settingsLoaded: boolean;
  getTerminalSize: () => TerminalSize;
};

type UseSessionStateResult = {
  sessions: Session[];
  activeSessionId: string | null;
  sessionStates: Record<string, SessionStateUi>;
  sessionReasons: Record<string, DisconnectReason>;
  localSessionMeta: Record<string, { shellId: string | null; label: string }>;
  reconnectInfoBySession: Record<string, { attempt: number; delayMs: number }>;
  logEntries: LogEntry[];
  busyMessage: string | null;
  activeSession: Session | null;
  activeSessionState: SessionStateUi | null;
  activeSessionReason: DisconnectReason | null;
  activeReconnectInfo: { attempt: number; delayMs: number } | null;
  activeSessionProfile: HostProfile | null;
  isRemoteSession: boolean;
  isRemoteConnected: boolean;
  canReconnect: boolean;
  sessionRef: React.RefObject<Session | null>;
  sessionsRef: React.RefObject<Session[]>;
  sessionStatesRef: React.RefObject<Record<string, SessionStateUi>>;
  sessionReasonsRef: React.RefObject<Record<string, DisconnectReason>>;
  sessionBuffersRef: React.RefObject<Record<string, string>>;
  localSessionMetaRef: React.RefObject<
    Record<string, { shellId: string | null; label: string }>
  >;
  localSessionIdsRef: React.RefObject<Set<string>>;
  activeSessionIdRef: React.RefObject<string | null>;
  appendLog: (
    key: TranslationKey,
    vars?: Record<string, string | number>,
    level?: LogLevel,
  ) => void;
  setBusyMessage: React.Dispatch<React.SetStateAction<string | null>>;
  isLocalSession: (sessionId: string | null) => boolean;
  recordCommandInput: (sessionId: string, data: string) => void;
  writeToSession: (sessionId: string, data: string) => Promise<unknown>;
  resizeSession: (
    sessionId: string,
    cols: number,
    rows: number,
  ) => Promise<unknown>;
  connectProfile: (profile: HostProfile) => Promise<void>;
  connectLocalShell: (
    shell: LocalShellProfile | null,
    activate?: boolean,
  ) => Promise<void>;
  disconnectSession: (sessionId: string) => Promise<void>;
  reconnectSession: (sessionId: string) => Promise<void>;
  reconnectLocalShell: (sessionId: string) => Promise<void>;
  switchSession: (sessionId: string) => void;
};

/** 会话与连接状态管理。 */
export default function useSessionState({
  profiles,
  t,
  shellId,
  availableShells,
  settingsLoaded,
  getTerminalSize,
}: UseSessionStateProps): UseSessionStateResult {
  const { openDialog } = useNotices();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionStates, setSessionStates] = useState<
    Record<string, SessionStateUi>
  >({});
  const [sessionReasons, setSessionReasons] = useState<
    Record<string, DisconnectReason>
  >({});
  const [localSessionMeta, setLocalSessionMeta] = useState<
    Record<string, { shellId: string | null; label: string }>
  >({});
  const [reconnectInfoBySession, setReconnectInfoBySession] = useState<
    Record<string, { attempt: number; delayMs: number }>
  >({});
  const [logEntries, setLogEntries] = useState<LogEntry[]>(() => {
    const raw = localStorage.getItem(logStorageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is LogEntry =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as LogEntry).id === "string" &&
            typeof (item as LogEntry).timestamp === "number" &&
            typeof (item as LogEntry).key === "string",
        )
        .slice(0, maxLogEntries);
    } catch {
      return [];
    }
  });
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const sessionsRef = useRef<Session[]>([]);
  const sessionStatesRef = useRef<Record<string, SessionStateUi>>({});
  const sessionReasonsRef = useRef<Record<string, DisconnectReason>>({});
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionBuffersRef = useRef<Record<string, string>>({});
  const inputBufferRef = useRef<Record<string, string>>({});
  const lastCommandRef = useRef<Record<string, string>>({});
  const reconnectTimersRef = useRef<Record<string, number>>({});
  const reconnectAttemptsRef = useRef<Record<string, number>>({});
  const sessionCloseHandledRef = useRef<Record<string, boolean>>({});
  const errorDialogShownRef = useRef<Record<string, boolean>>({});
  const localSessionIdsRef = useRef<Set<string>>(new Set());
  const localShellStartedRef = useRef(false);
  const localSessionMetaRef = useRef<
    Record<string, { shellId: string | null; label: string }>
  >({});
  const profilesRef = useRef<HostProfile[]>([]);

  const maxReconnectAttempts = 6;
  const baseReconnectDelayMs = 2000;
  const maxReconnectDelayMs = 30000;

  const activeSession = useMemo(() => {
    if (!activeSessionId) return null;
    return sessions.find((item) => item.sessionId === activeSessionId) ?? null;
  }, [sessions, activeSessionId]);

  const activeSessionState = activeSessionId
    ? (sessionStates[activeSessionId] ?? null)
    : null;

  const activeSessionReason = activeSessionId
    ? (sessionReasons[activeSessionId] ?? null)
    : null;

  const activeReconnectInfo = activeSessionId
    ? (reconnectInfoBySession[activeSessionId] ?? null)
    : null;

  const activeSessionProfile =
    activeSession && !isLocalSession(activeSession.sessionId)
      ? (profiles.find((item) => item.id === activeSession.profileId) ?? null)
      : null;

  const isRemoteSession =
    !!activeSession && !isLocalSession(activeSession.sessionId);

  const isRemoteConnected =
    !!activeSession &&
    activeSessionState === "connected" &&
    !isLocalSession(activeSession.sessionId);

  const canReconnect =
    !!activeSessionProfile &&
    activeSessionState !== "connected" &&
    activeSessionState !== "connecting" &&
    activeSessionState !== "reconnecting";

  function appendLog(
    key: TranslationKey,
    vars?: Record<string, string | number>,
    level: LogLevel = "info",
  ) {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      key,
      vars,
      level,
    };
    setLogEntries((prev) => [entry, ...prev].slice(0, maxLogEntries));
  }

  function isLocalSession(sessionId: string | null) {
    return !!sessionId && localSessionIdsRef.current.has(sessionId);
  }

  function resolveSessionLabel(sessionId: string) {
    const session = sessionsRef.current.find(
      (item) => item.sessionId === sessionId,
    );
    if (!session) return t("session.defaultName");
    if (isLocalSession(sessionId)) {
      return (
        localSessionMetaRef.current[sessionId]?.label ?? t("session.local")
      );
    }
    const profile =
      profilesRef.current.find((item) => item.id === session.profileId) ?? null;
    return profile?.name || profile?.host || t("session.defaultName");
  }

  function normalizeCommand(command: string) {
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return "";
    if (tokens[0] === "sudo" && tokens.length > 1) {
      return tokens[1];
    }
    return tokens[0];
  }

  function recordCommandInput(sessionId: string, data: string) {
    const cleaned = data.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
    let buffer = inputBufferRef.current[sessionId] ?? "";
    for (const char of cleaned) {
      if (char === "\r" || char === "\n") {
        const command = buffer.trim();
        if (command) {
          lastCommandRef.current[sessionId] = command;
        }
        buffer = "";
      } else if (char === "\u007f" || char === "\b") {
        buffer = buffer.slice(0, -1);
      } else if (char >= " ") {
        buffer += char;
      }
    }
    inputBufferRef.current[sessionId] = buffer;
  }

  function inferDisconnectReason(sessionId: string): DisconnectReason {
    const lastCommand = lastCommandRef.current[sessionId];
    if (!lastCommand) return "network";
    const command = normalizeCommand(lastCommand);
    if (command === "exit") return "exit";
    if (command === "poweroff") return "poweroff";
    if (command === "reboot") return "reboot";
    return "network";
  }

  function clearReconnectState(sessionId: string) {
    const timer = reconnectTimersRef.current[sessionId];
    if (timer) {
      window.clearTimeout(timer);
    }
    delete reconnectTimersRef.current[sessionId];
    delete reconnectAttemptsRef.current[sessionId];
    setReconnectInfoBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }

  function replaceSessionConnection(
    oldSessionId: string,
    nextSession: Session,
    nextState: SessionStateUi = "connecting",
    nextLocalMeta?: { shellId: string | null; label: string },
  ) {
    clearReconnectState(oldSessionId);
    delete sessionCloseHandledRef.current[oldSessionId];
    if (localSessionIdsRef.current.has(oldSessionId)) {
      localSessionIdsRef.current.delete(oldSessionId);
      localSessionIdsRef.current.add(nextSession.sessionId);
      setLocalSessionMeta((prev) => {
        const next = { ...prev };
        const meta = nextLocalMeta ?? next[oldSessionId];
        delete next[oldSessionId];
        if (meta) {
          next[nextSession.sessionId] = meta;
        }
        return next;
      });
    }
    setSessions((prev) =>
      prev.map((item) =>
        item.sessionId === oldSessionId ? nextSession : item,
      ),
    );
    setSessionStates((prev) => {
      const next = { ...prev };
      delete next[oldSessionId];
      next[nextSession.sessionId] = nextState;
      return next;
    });
    setSessionReasons((prev) => {
      const next = { ...prev };
      delete next[oldSessionId];
      return next;
    });
    setReconnectInfoBySession((prev) => {
      const next = { ...prev };
      delete next[oldSessionId];
      return next;
    });
    if (activeSessionIdRef.current === oldSessionId) {
      setActiveSessionId(nextSession.sessionId);
    }
  }

  async function createSshSession(profile: HostProfile) {
    const { cols, rows } = getTerminalSize();
    logInfo(
      JSON.stringify({
        event: "ssh.connect.invoke",
        profileId: profile.id,
        host: profile.host,
        authType: profile.authType,
      }),
    );
    return await invoke<Session>("ssh_connect", {
      profile,
      size: { cols, rows },
    });
  }

  async function createLocalShellSession(shellOverride: string | null = null) {
    const { cols, rows } = getTerminalSize();
    const payload: Record<string, unknown> = { size: { cols, rows } };
    const resolvedShell = shellOverride ?? shellId;
    if (resolvedShell) {
      payload.shellId = resolvedShell;
    }
    return await invoke<Session>("local_shell_connect", payload);
  }

  function sessionCommand(
    sessionId: string,
    sshCommand: string,
    localCommand: string,
  ) {
    return isLocalSession(sessionId) ? localCommand : sshCommand;
  }

  function writeToSession(sessionId: string, data: string) {
    return invoke(sessionCommand(sessionId, "ssh_write", "local_shell_write"), {
      sessionId,
      data,
    });
  }

  function resizeSession(sessionId: string, cols: number, rows: number) {
    return invoke(
      sessionCommand(sessionId, "ssh_resize", "local_shell_resize"),
      {
        sessionId,
        cols,
        rows,
      },
    );
  }

  async function attemptReconnect(sessionId: string) {
    const session = sessionsRef.current.find(
      (item) => item.sessionId === sessionId,
    );
    if (!session) {
      clearReconnectState(sessionId);
      return;
    }
    const profile = profilesRef.current.find(
      (item) => item.id === session.profileId,
    );
    if (!profile) {
      clearReconnectState(sessionId);
      return;
    }
    try {
      const result = await createSshSession(profile);
      replaceSessionConnection(sessionId, result);
    } catch {
      const attempts = reconnectAttemptsRef.current[sessionId] ?? 0;
      if (attempts >= maxReconnectAttempts) {
        clearReconnectState(sessionId);
        setSessionStates((prev) => ({
          ...prev,
          [sessionId]: "disconnected",
        }));
        return;
      }
      scheduleReconnect(sessionId);
    }
  }

  function scheduleReconnect(sessionId: string) {
    const attempts = (reconnectAttemptsRef.current[sessionId] ?? 0) + 1;
    reconnectAttemptsRef.current[sessionId] = attempts;
    const delayMs = Math.min(
      maxReconnectDelayMs,
      baseReconnectDelayMs * 2 ** (attempts - 1),
    );
    setReconnectInfoBySession((prev) => ({
      ...prev,
      [sessionId]: { attempt: attempts, delayMs },
    }));
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: "reconnecting",
    }));
    const timer = window.setTimeout(() => {
      delete reconnectTimersRef.current[sessionId];
      attemptReconnect(sessionId).catch(() => {});
    }, delayMs);
    reconnectTimersRef.current[sessionId] = timer;
  }

  function handleSessionDisconnected(sessionId: string) {
    if (sessionCloseHandledRef.current[sessionId]) return;
    const session = sessionsRef.current.find(
      (item) => item.sessionId === sessionId,
    );
    if (!session) return;
    sessionCloseHandledRef.current[sessionId] = true;
    const reason = inferDisconnectReason(sessionId);
    setSessionReasons((prev) => ({ ...prev, [sessionId]: reason }));
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: "disconnected",
    }));
    appendLog(
      "log.event.disconnected",
      { name: resolveSessionLabel(sessionId) },
      "error",
    );
    if (reason === "poweroff" || reason === "reboot") {
      scheduleReconnect(sessionId);
    }
  }

  async function connectProfile(profile: HostProfile) {
    logInfo(
      JSON.stringify({
        event: "ssh.connect.start",
        profileId: profile.id,
        host: profile.host,
        authType: profile.authType,
      }),
    );
    try {
      const result = await createSshSession(profile);
      const existingState = sessionStatesRef.current[result.sessionId];
      logInfo(
        JSON.stringify({
          event: "ssh.connect.session-created",
          profileId: profile.id,
          sessionId: result.sessionId,
        }),
      );
      setSessions((prev) => prev.concat(result));
      setActiveSessionId(result.sessionId);
      if (existingState !== "error" && existingState !== "disconnected") {
        setSessionStates((prev) => ({
          ...prev,
          [result.sessionId]: "connecting",
        }));
      }
      setSessionReasons((prev) => {
        const next = { ...prev };
        delete next[result.sessionId];
        return next;
      });
    } catch (err: any) {
      logError(
        JSON.stringify({
          event: "ssh.connect.failed",
          profileId: profile.id,
          host: profile.host,
          error: err?.message ?? String(err),
        }),
      );
      openDialog({
        title: t("dialog.sshErrorTitle"),
        message: err?.message ?? t("dialog.sshErrorBody"),
        confirmLabel: t("actions.close"),
      });
      throw err;
    }
  }

  async function connectLocalShell(
    shellProfile: LocalShellProfile | null,
    activate = false,
  ) {
    const session = await createLocalShellSession(shellProfile?.id ?? null);
    localSessionIdsRef.current.add(session.sessionId);
    setLocalSessionMeta((prev) => ({
      ...prev,
      [session.sessionId]: {
        shellId: shellProfile?.id ?? null,
        label: shellProfile?.label ?? t("session.local"),
      },
    }));
    setSessions((prev) => [session, ...prev]);
    if (activate) {
      setActiveSessionId(session.sessionId);
    } else {
      setActiveSessionId((prev) => prev ?? session.sessionId);
    }
    setSessionStates((prev) => ({ ...prev, [session.sessionId]: "connected" }));
    setSessionReasons((prev) => {
      const next = { ...prev };
      delete next[session.sessionId];
      return next;
    });
  }

  async function disconnectSession(sessionId: string) {
    const state = sessionStatesRef.current[sessionId];
    const localSession = isLocalSession(sessionId);
    if (
      state === "connected" ||
      state === "connecting" ||
      state === "reconnecting"
    ) {
      try {
        await invoke(
          localSession ? "local_shell_disconnect" : "ssh_disconnect",
          { sessionId },
        );
      } catch {
        // Ignore if the backend session is already closed.
      }
    }
    if (localSession) {
      localSessionIdsRef.current.delete(sessionId);
      setLocalSessionMeta((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    }
    setSessions((prev) => {
      const remaining = prev.filter((item) => item.sessionId !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[0]?.sessionId ?? null);
      }
      return remaining;
    });
    setSessionStates((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setSessionReasons((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setReconnectInfoBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }

  async function reconnectSession(sessionId: string) {
    if (isLocalSession(sessionId)) {
      await reconnectLocalShell(sessionId);
      return;
    }
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: "reconnecting",
    }));
    await attemptReconnect(sessionId);
  }

  async function reconnectLocalShell(sessionId: string) {
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: "reconnecting",
    }));
    try {
      const meta = localSessionMetaRef.current[sessionId];
      const result = await createLocalShellSession(meta?.shellId ?? null);
      replaceSessionConnection(sessionId, result, "connected", {
        shellId: meta?.shellId ?? null,
        label: meta?.label ?? t("session.local"),
      });
    } catch {
      setSessionStates((prev) => ({
        ...prev,
        [sessionId]: "disconnected",
      }));
    }
  }

  function switchSession(sessionId: string) {
    setActiveSessionId(sessionId);
  }

  useEffect(() => {
    try {
      localStorage.setItem(logStorageKey, JSON.stringify(logEntries));
    } catch {
      // Ignore localStorage write errors.
    }
  }, [logEntries]);

  useEffect(() => {
    sessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    sessionStatesRef.current = sessionStates;
  }, [sessionStates]);

  useEffect(() => {
    sessionReasonsRef.current = sessionReasons;
  }, [sessionReasons]);

  useEffect(() => {
    localSessionMetaRef.current = localSessionMeta;
  }, [localSessionMeta]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    if (!settingsLoaded || localShellStartedRef.current) return;
    if (!availableShells.length) return;
    localShellStartedRef.current = true;
    connectLocalShell(
      availableShells.find((shell) => shell.id === shellId) ?? null,
      false,
    ).catch(() => {});
  }, [availableShells, connectLocalShell, settingsLoaded, shellId]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const registerListeners = async () => {
      const exitUnlisten = await listen<{ sessionId: string }>(
        "terminal:exit",
        (event) => {
          handleSessionDisconnected(event.payload.sessionId);
        },
      );
      if (cancelled) {
        exitUnlisten();
        return;
      }
      unlisteners.push(exitUnlisten);

      const statusUnlisten = await listen<{
        sessionId: string;
        state: SessionStateUi;
        error?: { message: string };
      }>("session:status", (event) => {
        const label = resolveSessionLabel(event.payload.sessionId);
        setSessionStates((prev) => ({
          ...prev,
          [event.payload.sessionId]: event.payload.state,
        }));
        if (event.payload.state === "error" && event.payload.error?.message) {
          setBusyMessage(event.payload.error.message);
        }
        if (event.payload.state === "error") {
          setSessionReasons((prev) => ({
            ...prev,
            [event.payload.sessionId]: "network",
          }));
          appendLog(
            "log.event.error",
            {
              name: label,
              detail: event.payload.error?.message ?? t("log.unknownError"),
            },
            "error",
          );
          logError(
            JSON.stringify({
              event: "ssh.session.error",
              sessionId: event.payload.sessionId,
              message: event.payload.error?.message ?? "unknown",
            }),
          );
          if (!isLocalSession(event.payload.sessionId)) {
            disconnectSession(event.payload.sessionId).catch(() => {});
          }
          if (!errorDialogShownRef.current[event.payload.sessionId]) {
            errorDialogShownRef.current[event.payload.sessionId] = true;
            openDialog({
              title: t("dialog.sshErrorTitle"),
              message: event.payload.error?.message ?? t("dialog.sshErrorBody"),
              confirmLabel: t("actions.close"),
            });
          }
        }
        if (event.payload.state === "connected") {
          appendLog("log.event.connected", { name: label }, "success");
          logInfo(
            JSON.stringify({
              event: "ssh.session.connected",
              sessionId: event.payload.sessionId,
            }),
          );
        }
        if (event.payload.state === "connecting") {
          appendLog("log.event.connecting", { name: label });
          logInfo(
            JSON.stringify({
              event: "ssh.session.connecting",
              sessionId: event.payload.sessionId,
            }),
          );
        }
        if (event.payload.state === "disconnected") {
          handleSessionDisconnected(event.payload.sessionId);
        }
      });
      if (cancelled) {
        statusUnlisten();
        return;
      }
      unlisteners.push(statusUnlisten);
    };

    registerListeners().catch(() => {});

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [appendLog, openDialog, t]);

  return {
    sessions,
    activeSessionId,
    sessionStates,
    sessionReasons,
    localSessionMeta,
    reconnectInfoBySession,
    logEntries,
    busyMessage,
    activeSession,
    activeSessionState,
    activeSessionReason,
    activeReconnectInfo,
    activeSessionProfile,
    isRemoteSession,
    isRemoteConnected,
    canReconnect,
    sessionRef,
    sessionsRef,
    sessionStatesRef,
    sessionReasonsRef,
    sessionBuffersRef,
    localSessionMetaRef,
    localSessionIdsRef,
    activeSessionIdRef,
    appendLog,
    setBusyMessage,
    isLocalSession,
    recordCommandInput,
    writeToSession,
    resizeSession,
    connectProfile,
    connectLocalShell,
    disconnectSession,
    reconnectSession,
    reconnectLocalShell,
    switchSession,
  };
}
