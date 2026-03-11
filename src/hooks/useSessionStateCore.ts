/**
 * 会话状态核心 Hook。
 * 职责：维护会话状态机、连接生命周期、日志与事件处理。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { error as logError, info as logInfo } from "@/shared/logging/telemetry";
import type { Translate, TranslationKey } from "@/i18n";
import type {
  DisconnectReason,
  HostProfile,
  LocalShellConfig,
  LocalShellProfile,
  LogEntry,
  LogLevel,
  Session,
  SessionInput,
  SessionStateUi,
  SessionWorkspaceState,
} from "@/types";
import {
  DEFAULT_LOCAL_SHELL_CONFIG,
  normalizeLocalShellConfig,
} from "@/constants/localShellConfig";
import { useNotices } from "@/hooks/useNotices";
import { inferDisconnectReason } from "@/features/session/core/disconnectReason";
import type { HostKeyVerificationRequiredPayload } from "@/features/session/core/listeners";
import { callTauri } from "@/shared/tauri/commands";
import { registerSessionListeners } from "@/features/session/core/listeners";
import { replaceSessionConnectionState } from "@/features/session/core/lifecycle";
import {
  attemptSessionReconnect,
  clearReconnectStateById,
  scheduleReconnectAttempt,
} from "@/features/session/core/reconnectRuntime";
import useSessionWorkspace from "@/hooks/useSessionWorkspace";
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
  localShellProfiles: Record<string, LocalShellConfig>;
  availableShells: LocalShellProfile[];
  settingsLoaded: boolean;
  getTerminalSize: () => TerminalSize;
};

type LocalSessionMeta = {
  shellId: string | null;
  label: string;
  launchConfig?: LocalShellConfig;
};

type UseSessionStateResult = {
  sessions: Session[];
  workspace: SessionWorkspaceState;
  activeSessionId: string | null;
  sessionStates: Record<string, SessionStateUi>;
  sessionReasons: Record<string, DisconnectReason>;
  localSessionMeta: Record<string, LocalSessionMeta>;
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
  localSessionMetaRef: React.RefObject<Record<string, LocalSessionMeta>>;
  localSessionIdsRef: React.RefObject<Set<string>>;
  activeSessionIdRef: React.RefObject<string | null>;
  appendLog: (
    key: TranslationKey,
    vars?: Record<string, string | number>,
    level?: LogLevel,
  ) => void;
  setBusyMessage: React.Dispatch<React.SetStateAction<string | null>>;
  isLocalSession: (sessionId: string | null) => boolean;
  setLastCommand: (sessionId: string, command: string) => void;
  sendSessionInput: (
    sessionId: string,
    input: SessionInput,
  ) => Promise<unknown>;
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
  focusPane: (paneId: string) => void;
  reorderPaneSessions: (
    paneId: string,
    sourceSessionId: string,
    targetSessionId: string,
  ) => void;
  splitActivePane: (axis: "horizontal" | "vertical") => Promise<void>;
  closePaneSession: (paneId: string, sessionId: string) => Promise<void>;
  resizePaneSplit: (paneId: string, ratio: number) => void;
  closeOtherSessionsInPane: (
    paneId: string,
    sessionId: string,
  ) => Promise<void>;
  closeSessionsToRightInPane: (
    paneId: string,
    sessionId: string,
  ) => Promise<void>;
  closeAllSessionsInPane: (paneId: string) => Promise<void>;
};

/** 会话与连接状态管理。 */
export default function useSessionState({
  profiles,
  t,
  shellId,
  localShellProfiles,
  availableShells,
  settingsLoaded,
  getTerminalSize,
}: UseSessionStateProps): UseSessionStateResult {
  const { openDialog } = useNotices();
  const sessionWorkspace = useSessionWorkspace();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionStates, setSessionStates] = useState<
    Record<string, SessionStateUi>
  >({});
  const [sessionReasons, setSessionReasons] = useState<
    Record<string, DisconnectReason>
  >({});
  const [localSessionMeta, setLocalSessionMeta] = useState<
    Record<string, LocalSessionMeta>
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
  const lastCommandRef = useRef<Record<string, string>>({});
  const reconnectTimersRef = useRef<Record<string, number>>({});
  const reconnectAttemptsRef = useRef<Record<string, number>>({});
  const sessionCloseHandledRef = useRef<Record<string, boolean>>({});
  const errorDialogShownRef = useRef<Record<string, boolean>>({});
  // 按 profile 记录待确认的 Host Key 重连链路。
  // Host Key 事件不带 sessionId，这里用 profileId 映射对应会话。
  const pendingHostKeyReconnectSessionByProfileRef = useRef<
    Record<string, string>
  >({});
  const pendingHostKeyDialogProfilesRef = useRef<Record<string, boolean>>({});
  const localSessionIdsRef = useRef<Set<string>>(new Set());
  const localShellStartedRef = useRef(false);
  const localSessionMetaRef = useRef<Record<string, LocalSessionMeta>>({});
  const profilesRef = useRef<HostProfile[]>([]);
  const connectProfileRef = useRef<(profile: HostProfile) => Promise<void>>(
    async () => {},
  );
  const disconnectSessionRef = useRef<(sessionId: string) => Promise<void>>(
    async () => {},
  );
  const reconnectSessionRef = useRef<(sessionId: string) => Promise<void>>(
    async () => {},
  );
  // Tauri 事件监听需要尽量保持单次注册，否则在 React 重渲染时频繁 unlisten/listen，
  // 容易让 Rust 侧的异步事件打到已经失效的 callback，出现 "Couldn't find callback id" 警告。
  // 这里用 ref 持有“最新的事件处理函数”，把监听器生命周期与 React 渲染解耦。
  const sessionEventHandlersRef = useRef<{
    handleSessionDisconnected: (sessionId: string) => void;
    handleSessionStatus: (payload: {
      sessionId: string;
      state: SessionStateUi;
      error?: {
        code: string;
        message: string;
        detail?: string | null;
        details?: string | null;
      };
    }) => void;
    handleHostKeyVerificationRequired: (
      payload: HostKeyVerificationRequiredPayload,
    ) => void;
  }>({
    handleSessionDisconnected: () => {},
    handleSessionStatus: () => {},
    handleHostKeyVerificationRequired: () => {},
  });

  const activeSession = useMemo(() => {
    const activeSessionId = sessionWorkspace.activeSessionId;
    if (!activeSessionId) return null;
    return sessions.find((item) => item.sessionId === activeSessionId) ?? null;
  }, [sessions, sessionWorkspace.activeSessionId]);

  const activeSessionId = sessionWorkspace.activeSessionId;

  const activeSessionState = activeSessionId
    ? (sessionStates[activeSessionId] ?? null)
    : null;

  const activeSessionReason = activeSessionId
    ? (sessionReasons[activeSessionId] ?? null)
    : null;

  const activeReconnectInfo = activeSessionId
    ? (reconnectInfoBySession[activeSessionId] ?? null)
    : null;

  const localSessionIdSet = useMemo(
    () => new Set(Object.keys(localSessionMeta)),
    [localSessionMeta],
  );
  const activeSessionIsLocal =
    !!activeSession && localSessionIdSet.has(activeSession.sessionId);

  const activeSessionProfile =
    activeSession && !activeSessionIsLocal
      ? (profiles.find((item) => item.id === activeSession.profileId) ?? null)
      : null;

  const isRemoteSession = !!activeSession && !activeSessionIsLocal;

  const isRemoteConnected =
    !!activeSession &&
    activeSessionState === "connected" &&
    !activeSessionIsLocal;

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

  /** 设置最近一次真正提交的命令，供断开原因推断复用。 */
  function setLastCommand(sessionId: string, command: string) {
    const normalized = command.trim();
    if (!normalized) return;
    lastCommandRef.current[sessionId] = normalized;
  }

  function clearReconnectState(sessionId: string) {
    clearReconnectStateById({
      sessionId,
      reconnectTimersRef,
      reconnectAttemptsRef,
      setReconnectInfoBySession,
    });
  }

  function clearPendingHostKeyForProfile(profileId: string) {
    delete pendingHostKeyReconnectSessionByProfileRef.current[profileId];
    delete pendingHostKeyDialogProfilesRef.current[profileId];
  }

  function replaceSessionConnection(
    oldSessionId: string,
    nextSession: Session,
    nextState: SessionStateUi = "connecting",
    nextLocalMeta?: LocalSessionMeta,
  ) {
    replaceSessionConnectionState({
      oldSessionId,
      nextSession,
      nextState,
      nextLocalMeta,
      localSessionIdsRef,
      clearReconnectState,
      replaceWorkspaceSession: sessionWorkspace.replaceSession,
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
    void logInfo(
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

  const createLocalShellSession = useCallback(
    async (
      shellOverride: string | null = null,
      launchConfig?: LocalShellConfig,
    ) => {
      const { cols, rows } = getTerminalSize();
      const payload: Record<string, unknown> = { size: { cols, rows } };
      const resolvedShell = shellOverride ?? shellId;
      if (resolvedShell) {
        payload.shellId = resolvedShell;
      }
      if (launchConfig) {
        payload.launchConfig = launchConfig;
      }
      return await callTauri<Session>("local_shell_connect", payload);
    },
    [getTerminalSize, shellId],
  );

  function sessionCommand(
    sessionId: string,
    sshCommand: string,
    localCommand: string,
  ) {
    return isLocalSession(sessionId) ? localCommand : sshCommand;
  }

  /** 统一发送会话输入；文本与二进制在此分流到对应命令。 */
  async function sendSessionInput(sessionId: string, input: SessionInput) {
    const command =
      input.kind === "binary"
        ? sessionCommand(
            sessionId,
            "ssh_write_binary",
            "local_shell_write_binary",
          )
        : sessionCommand(sessionId, "ssh_write", "local_shell_write");
    const payload =
      input.kind === "binary"
        ? { sessionId, data: input.data }
        : { sessionId, data: input.data };
    try {
      return await callTauri(command, payload);
    } catch (err) {
      // 本地 Shell 进程退出后，若 terminal:exit 事件未及时到达，
      // 这里以写入失败作为兜底信号，确保会话进入断开状态并可回车重连。
      if (isLocalSession(sessionId)) {
        handleSessionDisconnected(sessionId);
      }
      throw err;
    }
  }

  async function writeToSession(sessionId: string, data: string) {
    return sendSessionInput(sessionId, { kind: "text", data });
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
    const session = sessionsRef.current.find(
      (item) => item.sessionId === sessionId,
    );
    const profileId = session?.profileId ?? null;
    if (profileId) {
      // 记录当前重连会话，供 Host Key 确认后继续连接。
      pendingHostKeyReconnectSessionByProfileRef.current[profileId] = sessionId;
    }
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
    if (profileId && !pendingHostKeyDialogProfilesRef.current[profileId]) {
      delete pendingHostKeyReconnectSessionByProfileRef.current[profileId];
    }
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
          void logError(
            JSON.stringify({
              event: "ssh.session.error",
              sessionId: payload.sessionId,
              message: payload.error?.message ?? "unknown",
            }),
          );
          if (!isLocalSession(payload.sessionId)) {
            disconnectSessionRef.current(payload.sessionId).catch(() => {});
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
          void logInfo(
            JSON.stringify({
              event: "ssh.session.connected",
              sessionId: payload.sessionId,
            }),
          );
        }
        if (payload.state === "connecting") {
          void logInfo(
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
      handleHostKeyVerificationRequired: (payload) => {
        if (pendingHostKeyDialogProfilesRef.current[payload.profileId]) return;
        const profile = profilesRef.current.find(
          (item) => item.id === payload.profileId,
        );
        if (!profile) return;
        // 同一个 profile 同时只显示一个待确认弹窗。
        pendingHostKeyDialogProfilesRef.current[payload.profileId] = true;
        const isMismatch = !!payload.previousFingerprintSha256;
        openDialog({
          title: isMismatch
            ? t("dialog.sshHostKeyMismatchTitle")
            : t("dialog.sshHostKeyUnknownTitle"),
          message: isMismatch
            ? t("dialog.sshHostKeyMismatchBody", {
                host: `${payload.host}:${payload.port}`,
                algorithm: payload.keyAlgorithm,
                previous: payload.previousFingerprintSha256 ?? "-",
                next: payload.fingerprintSha256,
              })
            : t("dialog.sshHostKeyUnknownBody", {
                host: `${payload.host}:${payload.port}`,
                algorithm: payload.keyAlgorithm,
                fingerprint: payload.fingerprintSha256,
              }),
          confirmLabel: t("actions.save"),
          cancelLabel: t("actions.cancel"),
          onConfirm: () => {
            const reconnectTargetSessionId =
              pendingHostKeyReconnectSessionByProfileRef.current[
                payload.profileId
              ] ?? null;
            callTauri("ssh_host_key_confirm", {
              host: payload.host,
              port: payload.port,
              keyAlgorithm: payload.keyAlgorithm,
              publicKeyBase64: payload.publicKeyBase64,
            })
              .then(async () => {
                clearPendingHostKeyForProfile(payload.profileId);
                if (reconnectTargetSessionId) {
                  // 确认后继续当前重连会话。
                  clearReconnectState(reconnectTargetSessionId);
                  await reconnectSessionRef.current(reconnectTargetSessionId);
                  return;
                }
                await connectProfileRef.current(profile);
              })
              .catch(() => {
                clearPendingHostKeyForProfile(payload.profileId);
              });
          },
          onCancel: () => {
            const reconnectTargetSessionId =
              pendingHostKeyReconnectSessionByProfileRef.current[
                payload.profileId
              ] ?? null;
            clearPendingHostKeyForProfile(payload.profileId);
            if (reconnectTargetSessionId) {
              // 取消后终止当前重连链路。
              clearReconnectState(reconnectTargetSessionId);
              setSessionStates((prev) => ({
                ...prev,
                [reconnectTargetSessionId]: "disconnected",
              }));
            }
          },
        });
      },
    };
  });

  async function connectProfile(profile: HostProfile) {
    clearPendingHostKeyForProfile(profile.id);
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
      attachSessionToWorkspace: (sessionId) =>
        sessionWorkspace.attachSession(
          sessionId,
          true,
          sessionWorkspace.workspace.root
            ? { paneId: sessionWorkspace.getActivePaneId() ?? undefined }
            : undefined,
        ),
      setSessionStates,
      setSessionReasons,
      t,
      logInfo: (message) => {
        void logInfo(message);
      },
      logError: (message) => {
        void logError(message);
      },
      openDialog,
    });
  }

  const connectLocalShell = useCallback(
    async (shellProfile: LocalShellProfile | null, activate = false) => {
      const resolvedShellId = shellProfile?.id ?? shellId ?? null;
      const launchConfig = resolvedShellId
        ? normalizeLocalShellConfig(localShellProfiles[resolvedShellId])
        : DEFAULT_LOCAL_SHELL_CONFIG;
      await connectLocalShellCommand({
        shellProfile,
        activate,
        createLocalShellSession,
        localSessionIdsRef,
        setLocalSessionMeta,
        setSessions,
        attachSessionToWorkspace: (sessionId, nextActivate = activate) =>
          sessionWorkspace.attachSession(
            sessionId,
            nextActivate,
            sessionWorkspace.workspace.root
              ? { paneId: sessionWorkspace.getActivePaneId() ?? undefined }
              : undefined,
          ),
        setSessionStates,
        setSessionReasons,
        t,
        launchConfig,
      });
    },
    [createLocalShellSession, localShellProfiles, sessionWorkspace, shellId, t],
  );

  async function disconnectSession(sessionId: string) {
    const state = sessionStatesRef.current[sessionId];
    const localSession = isLocalSession(sessionId);
    await disconnectSessionCommand({
      sessionId,
      state,
      localSession,
      sendDisconnect: (id, local) =>
        callTauri(local ? "local_shell_disconnect" : "ssh_disconnect", {
          sessionId: id,
        }),
      detachSessionFromWorkspace: sessionWorkspace.detachSession,
      localSessionIdsRef,
      setLocalSessionMeta,
      setSessions,
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

  useEffect(() => {
    connectProfileRef.current = connectProfile;
    disconnectSessionRef.current = disconnectSession;
    reconnectSessionRef.current = reconnectSession;
  });

  function switchSession(sessionId: string) {
    sessionWorkspace.activateSession(sessionId);
  }

  function focusPane(paneId: string) {
    sessionWorkspace.focusPane(paneId);
  }

  function reorderPaneSessions(
    paneId: string,
    sourceSessionId: string,
    targetSessionId: string,
  ) {
    sessionWorkspace.reorderPaneSessions(
      paneId,
      sourceSessionId,
      targetSessionId,
    );
  }

  async function closeSessions(sessionIds: string[]) {
    for (const sessionId of sessionIds) {
      await disconnectSession(sessionId);
    }
  }

  function getPaneSessions(paneId: string) {
    const pane = sessionWorkspace
      .getLeafPanes()
      .find((item) => item.paneId === paneId);
    return pane?.sessionIds ?? [];
  }

  async function closePaneSession(paneId: string, sessionId: string) {
    const paneSessions = getPaneSessions(paneId);
    if (!paneSessions.includes(sessionId)) return;
    await disconnectSession(sessionId);
  }

  async function closeOtherSessionsInPane(paneId: string, sessionId: string) {
    const paneSessions = getPaneSessions(paneId);
    await closeSessions(paneSessions.filter((item) => item !== sessionId));
  }

  async function closeSessionsToRightInPane(paneId: string, sessionId: string) {
    const paneSessions = getPaneSessions(paneId);
    const sessionIndex = paneSessions.indexOf(sessionId);
    if (sessionIndex < 0) return;
    await closeSessions(paneSessions.slice(sessionIndex + 1));
  }

  async function closeAllSessionsInPane(paneId: string) {
    await closeSessions(getPaneSessions(paneId));
  }

  function resizePaneSplit(paneId: string, ratio: number) {
    sessionWorkspace.resizeSplit(paneId, ratio);
  }

  async function splitActivePane(axis: "horizontal" | "vertical") {
    const activePaneId = sessionWorkspace.getActivePaneId();
    const activeSessionId = sessionWorkspace.activeSessionId;
    if (!activePaneId || !activeSessionId) return;

    const currentSession = sessionsRef.current.find(
      (item) => item.sessionId === activeSessionId,
    );
    if (!currentSession) return;

    let nextSession: Session;
    if (isLocalSession(activeSessionId)) {
      const meta = localSessionMetaRef.current[activeSessionId];
      nextSession = await createLocalShellSession(meta?.shellId ?? null);
      localSessionIdsRef.current.add(nextSession.sessionId);
      setLocalSessionMeta((prev) => ({
        ...prev,
        [nextSession.sessionId]: {
          shellId: meta?.shellId ?? null,
          label: meta?.label ?? t("session.local"),
        },
      }));
      setSessionStates((prev) => ({
        ...prev,
        [nextSession.sessionId]: "connected",
      }));
    } else {
      const profile = profilesRef.current.find(
        (item) => item.id === currentSession.profileId,
      );
      if (!profile) return;
      nextSession = await createSshSession(profile);
      setSessionStates((prev) => ({
        ...prev,
        [nextSession.sessionId]: "connecting",
      }));
    }

    setSessions((prev) => prev.concat(nextSession));
    setSessionReasons((prev) => {
      const next = { ...prev };
      delete next[nextSession.sessionId];
      return next;
    });
    sessionWorkspace.splitPane(activePaneId, nextSession.sessionId, axis);
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
      true,
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
        onHostKeyVerificationRequired: (payload) => {
          sessionEventHandlersRef.current.handleHostKeyVerificationRequired(
            payload,
          );
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
    workspace: sessionWorkspace.workspace,
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
    setLastCommand,
    sendSessionInput,
    writeToSession,
    resizeSession,
    connectProfile,
    connectLocalShell,
    disconnectSession,
    reconnectSession,
    reconnectLocalShell,
    switchSession,
    focusPane,
    reorderPaneSessions,
    splitActivePane,
    closePaneSession,
    resizePaneSplit,
    closeOtherSessionsInPane,
    closeSessionsToRightInPane,
    closeAllSessionsInPane,
  };
}
