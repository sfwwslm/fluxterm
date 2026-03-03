/**
 * 会话命令编排模块。
 * 职责：封装连接、断开、重连等会话命令流程，降低 Hook 主体复杂度。
 */
import type { Translate } from "@/i18n";
import type {
  DisconnectReason,
  HostProfile,
  LocalShellProfile,
  Session,
  SessionStateUi,
} from "@/types";
import { warn as logWarn } from "@tauri-apps/plugin-log";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type ConnectProfileCommandParams = {
  profile: HostProfile;
  createSshSession: (profile: HostProfile) => Promise<Session>;
  sessionStatesRef: React.RefObject<Record<string, SessionStateUi>>;
  setSessions: Setter<Session[]>;
  attachSessionToWorkspace: (sessionId: string) => void;
  setSessionStates: Setter<Record<string, SessionStateUi>>;
  setSessionReasons: Setter<Record<string, DisconnectReason>>;
  t: Translate;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
  openDialog: (payload: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }) => void;
};

/** 建立远端会话并写入前端状态。 */
export async function connectProfileCommand({
  profile,
  createSshSession,
  sessionStatesRef,
  setSessions,
  attachSessionToWorkspace,
  setSessionStates,
  setSessionReasons,
  t,
  logInfo,
  logError,
  openDialog,
}: ConnectProfileCommandParams) {
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
    attachSessionToWorkspace(result.sessionId);
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
    const code = err?.code ?? "";
    if (code === "ssh_host_key_unknown" || code === "ssh_host_key_mismatch") {
      logWarn(
        JSON.stringify({
          event: "ssh.connect.pending-host-key-confirmation",
          profileId: profile.id,
          host: profile.host,
          error: err?.message ?? String(err),
        }),
      );
      throw err;
    }
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

type ConnectLocalShellCommandParams = {
  shellProfile: LocalShellProfile | null;
  activate?: boolean;
  createLocalShellSession: (shellOverride?: string | null) => Promise<Session>;
  localSessionIdsRef: React.RefObject<Set<string>>;
  setLocalSessionMeta: Setter<
    Record<string, { shellId: string | null; label: string }>
  >;
  setSessions: Setter<Session[]>;
  attachSessionToWorkspace: (sessionId: string, activate?: boolean) => void;
  setSessionStates: Setter<Record<string, SessionStateUi>>;
  setSessionReasons: Setter<Record<string, DisconnectReason>>;
  t: Translate;
};

/** 建立本地 shell 会话并写入前端状态。 */
export async function connectLocalShellCommand({
  shellProfile,
  activate = false,
  createLocalShellSession,
  localSessionIdsRef,
  setLocalSessionMeta,
  setSessions,
  attachSessionToWorkspace,
  setSessionStates,
  setSessionReasons,
  t,
}: ConnectLocalShellCommandParams) {
  const session = await createLocalShellSession(shellProfile?.id ?? null);
  localSessionIdsRef.current.add(session.sessionId);
  setLocalSessionMeta((prev) => ({
    ...prev,
    [session.sessionId]: {
      shellId: shellProfile?.id ?? null,
      label: shellProfile?.label ?? t("session.local"),
    },
  }));
  setSessions((prev) => prev.concat(session));
  attachSessionToWorkspace(session.sessionId, activate);
  setSessionStates((prev) => ({ ...prev, [session.sessionId]: "connected" }));
  setSessionReasons((prev) => {
    const next = { ...prev };
    delete next[session.sessionId];
    return next;
  });
}

type DisconnectSessionCommandParams = {
  sessionId: string;
  state: SessionStateUi | undefined;
  localSession: boolean;
  sendDisconnect: (sessionId: string, localSession: boolean) => Promise<void>;
  detachSessionFromWorkspace: (sessionId: string) => void;
  localSessionIdsRef: React.RefObject<Set<string>>;
  setLocalSessionMeta: Setter<
    Record<string, { shellId: string | null; label: string }>
  >;
  setSessions: Setter<Session[]>;
  setSessionStates: Setter<Record<string, SessionStateUi>>;
  setSessionReasons: Setter<Record<string, DisconnectReason>>;
  setReconnectInfoBySession: Setter<
    Record<string, { attempt: number; delayMs: number }>
  >;
};

/** 关闭会话并清理关联状态。 */
export async function disconnectSessionCommand({
  sessionId,
  state,
  localSession,
  sendDisconnect,
  detachSessionFromWorkspace,
  localSessionIdsRef,
  setLocalSessionMeta,
  setSessions,
  setSessionStates,
  setSessionReasons,
  setReconnectInfoBySession,
}: DisconnectSessionCommandParams) {
  if (
    state === "connected" ||
    state === "connecting" ||
    state === "reconnecting"
  ) {
    try {
      await sendDisconnect(sessionId, localSession);
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
    return prev.filter((item) => item.sessionId !== sessionId);
  });
  detachSessionFromWorkspace(sessionId);
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

type ReconnectLocalShellCommandParams = {
  sessionId: string;
  createLocalShellSession: (shellOverride?: string | null) => Promise<Session>;
  localSessionMetaRef: React.RefObject<
    Record<string, { shellId: string | null; label: string }>
  >;
  setSessionStates: Setter<Record<string, SessionStateUi>>;
  replaceSessionConnection: (
    oldSessionId: string,
    nextSession: Session,
    nextState?: SessionStateUi,
    nextLocalMeta?: { shellId: string | null; label: string },
  ) => void;
  t: Translate;
};

/** 重连本地 shell 会话。 */
export async function reconnectLocalShellCommand({
  sessionId,
  createLocalShellSession,
  localSessionMetaRef,
  setSessionStates,
  replaceSessionConnection,
  t,
}: ReconnectLocalShellCommandParams) {
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
