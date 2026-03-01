/**
 * 会话状态核心 Hook。
 * 职责：维护会话状态机、连接生命周期、日志与事件处理。
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
import { inferDisconnectReason } from "@/features/session/core/disconnectReason";
import { callTauri } from "@/shared/tauri/commands";
import { registerSessionListeners } from "@/features/session/core/listeners";
import { replaceSessionConnectionState } from "@/features/session/core/lifecycle";
import {
  attemptSessionReconnect,
  clearReconnectStateById,
  scheduleReconnectAttempt,
} from "@/features/session/core/reconnectRuntime";
import {
  connectLocalShellCommand,
  connectProfileCommand,
  disconnectSessionCommand,
  reconnectLocalShellCommand,
} from "@/features/session/core/commands";

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
  // Tauri 事件监听需要尽量保持单次注册，否则在 React 重渲染时频繁 unlisten/listen，
  // 容易让 Rust 侧的异步事件打到已经失效的 callback，出现 "Couldn't find callback id" 警告。
  // 这里用 ref 持有“最新的事件处理函数”，把监听器生命周期与 React 渲染解耦。
  const sessionEventHandlersRef = useRef<{
    handleSessionDisconnected: (sessionId: string) => void;
    handleSessionStatus: (payload: {
      sessionId: string;
      state: SessionStateUi;
      error?: { message: string };
    }) => void;
  }>({
    handleSessionDisconnected: () => {},
    handleSessionStatus: () => {},
  });

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

  function resolveProfileLabel(profile: HostProfile) {
    return profile.name || profile.host || t("session.defaultName");
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

  function clearReconnectState(sessionId: string) {
    clearReconnectStateById({
      sessionId,
      reconnectTimersRef,
      reconnectAttemptsRef,
      setReconnectInfoBySession,
    });
  }

  function replaceSessionConnection(
    oldSessionId: string,
    nextSession: Session,
    nextState: SessionStateUi = "connecting",
    nextLocalMeta?: { shellId: string | null; label: string },
  ) {
    replaceSessionConnectionState({
      oldSessionId,
      nextSession,
      nextState,
      nextLocalMeta,
      activeSessionIdRef,
      localSessionIdsRef,
      clearReconnectState,
      setActiveSessionId,
      setSessions,
      setSessionStates,
      setSessionReasons,
      setReconnectInfoBySession,
      setLocalSessionMeta,
      sessionCloseHandledRef,
    });
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
    return await callTauri<Session>("ssh_connect", {
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
    return await callTauri<Session>("local_shell_connect", payload);
  }

  function sessionCommand(
    sessionId: string,
    sshCommand: string,
    localCommand: string,
  ) {
    return isLocalSession(sessionId) ? localCommand : sshCommand;
  }

  async function writeToSession(sessionId: string, data: string) {
    try {
      return await callTauri(
        sessionCommand(sessionId, "ssh_write", "local_shell_write"),
        {
          sessionId,
          data,
        },
      );
    } catch (err) {
      // 本地 Shell 进程退出后，若 terminal:exit 事件未及时到达，
      // 这里以写入失败作为兜底信号，确保会话进入断开状态并可回车重连。
      if (isLocalSession(sessionId)) {
        handleSessionDisconnected(sessionId);
      }
      throw err;
    }
  }

  function resizeSession(sessionId: string, cols: number, rows: number) {
    return callTauri(
      sessionCommand(sessionId, "ssh_resize", "local_shell_resize"),
      {
        sessionId,
        cols,
        rows,
      },
    );
  }

  async function attemptReconnect(sessionId: string) {
    await attemptSessionReconnect({
      sessionId,
      sessionsRef,
      profilesRef,
      reconnectAttemptsRef,
      clearReconnectState,
      scheduleReconnect,
      createSshSession,
      replaceSessionConnection,
      setSessionStates,
    });
  }

  function scheduleReconnect(sessionId: string) {
    scheduleReconnectAttempt({
      sessionId,
      reconnectAttemptsRef,
      reconnectTimersRef,
      setReconnectInfoBySession,
      setSessionStates,
      onAttemptReconnect: attemptReconnect,
    });
  }

  function handleSessionDisconnected(sessionId: string) {
    if (sessionCloseHandledRef.current[sessionId]) return;
    const session = sessionsRef.current.find(
      (item) => item.sessionId === sessionId,
    );
    if (!session) return;
    sessionCloseHandledRef.current[sessionId] = true;
    const reason = inferDisconnectReason(
      lastCommandRef.current[sessionId],
      isLocalSession(sessionId),
    );
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

  // 监听器本身只注册一次，但里面执行的逻辑需要始终拿到最新的 t/openDialog/appendLog 等闭包。
  // 因此每次渲染后都把最新处理函数写回 ref，事件到达时再间接转发给它。
  useEffect(() => {
    sessionEventHandlersRef.current = {
      handleSessionDisconnected,
      handleSessionStatus: (payload) => {
        const label = resolveSessionLabel(payload.sessionId);
        setSessionStates((prev) => ({
          ...prev,
          [payload.sessionId]: payload.state,
        }));
        if (payload.state === "error" && payload.error?.message) {
          setBusyMessage(payload.error.message);
        }
        if (payload.state === "error") {
          setSessionReasons((prev) => ({
            ...prev,
            [payload.sessionId]: "network",
          }));
          appendLog(
            "log.event.error",
            {
              name: label,
              detail: payload.error?.message ?? t("log.unknownError"),
            },
            "error",
          );
          logError(
            JSON.stringify({
              event: "ssh.session.error",
              sessionId: payload.sessionId,
              message: payload.error?.message ?? "unknown",
            }),
          );
          if (!isLocalSession(payload.sessionId)) {
            disconnectSession(payload.sessionId).catch(() => {});
          }
          if (!errorDialogShownRef.current[payload.sessionId]) {
            errorDialogShownRef.current[payload.sessionId] = true;
            openDialog({
              title: t("dialog.sshErrorTitle"),
              message: payload.error?.message ?? t("dialog.sshErrorBody"),
              confirmLabel: t("actions.close"),
            });
          }
        }
        if (payload.state === "connected") {
          appendLog("log.event.connected", { name: label }, "success");
          logInfo(
            JSON.stringify({
              event: "ssh.session.connected",
              sessionId: payload.sessionId,
            }),
          );
        }
        if (payload.state === "connecting") {
          logInfo(
            JSON.stringify({
              event: "ssh.session.connecting",
              sessionId: payload.sessionId,
            }),
          );
        }
        if (payload.state === "disconnected") {
          handleSessionDisconnected(payload.sessionId);
        }
      },
    };
  });

  async function connectProfile(profile: HostProfile) {
    // “正在连接”在发起连接时就记录，避免状态事件先到、会话元数据尚未写入前端时，
    // 日志对象退化成默认的“会话”占位文案。
    appendLog("log.event.connecting", {
      name: resolveProfileLabel(profile),
    });
    await connectProfileCommand({
      profile,
      createSshSession,
      sessionStatesRef,
      setSessions,
      setActiveSessionId,
      setSessionStates,
      setSessionReasons,
      t,
      logInfo,
      logError,
      openDialog,
    });
  }

  async function connectLocalShell(
    shellProfile: LocalShellProfile | null,
    activate = false,
  ) {
    await connectLocalShellCommand({
      shellProfile,
      activate,
      createLocalShellSession,
      localSessionIdsRef,
      setLocalSessionMeta,
      setSessions,
      setActiveSessionId,
      setSessionStates,
      setSessionReasons,
      t,
    });
  }

  async function disconnectSession(sessionId: string) {
    const state = sessionStatesRef.current[sessionId];
    const localSession = isLocalSession(sessionId);
    await disconnectSessionCommand({
      sessionId,
      state,
      localSession,
      activeSessionId,
      sendDisconnect: (id, local) =>
        callTauri(local ? "local_shell_disconnect" : "ssh_disconnect", {
          sessionId: id,
        }),
      localSessionIdsRef,
      setLocalSessionMeta,
      setSessions,
      setActiveSessionId,
      setSessionStates,
      setSessionReasons,
      setReconnectInfoBySession,
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
    await reconnectLocalShellCommand({
      sessionId,
      createLocalShellSession,
      localSessionMetaRef,
      setSessionStates,
      replaceSessionConnection,
      t,
    });
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
    let teardown: (() => void) | null = null;

    // 会话级 Tauri listener 必须保持单次注册。
    // 如果跟着 render 反复重建，terminal:exit / session:status 这类异步事件就可能命中旧 callback，
    // 从而在控制台出现 callback id 丢失警告。
    const registerListeners = async () => {
      const unlisten = await registerSessionListeners({
        onTerminalExit: ({ sessionId }) => {
          sessionEventHandlersRef.current.handleSessionDisconnected(sessionId);
        },
        onSessionStatus: (payload) => {
          sessionEventHandlersRef.current.handleSessionStatus(payload);
        },
      });
      if (cancelled) {
        unlisten();
        return;
      }
      teardown = unlisten;
    };

    registerListeners().catch(() => {});

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

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
