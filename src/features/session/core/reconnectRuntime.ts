/**
 * 会话重连运行时模块。
 * 职责：管理重连计时器、重试次数与重连尝试执行流程。
 */
import {
  computeReconnectDelayMs,
  maxReconnectAttempts,
} from "@/features/session/core/reconnectPolicy";
import type {
  HostProfile,
  LocalShellConfig,
  Session,
  SessionStateUi,
} from "@/types";

type LocalSessionMeta = {
  shellId: string | null;
  label: string;
  launchConfig?: LocalShellConfig;
};

type Setter<T> = (updater: (prev: T) => T) => void;

type ClearReconnectStateParams = {
  sessionId: string;
  reconnectTimersRef: React.RefObject<Record<string, number>>;
  reconnectAttemptsRef: React.RefObject<Record<string, number>>;
  setReconnectInfoBySession: Setter<
    Record<string, { attempt: number; delayMs: number }>
  >;
};

/** 清理指定会话的重连计时与状态。 */
export function clearReconnectStateById({
  sessionId,
  reconnectTimersRef,
  reconnectAttemptsRef,
  setReconnectInfoBySession,
}: ClearReconnectStateParams) {
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

type AttemptSessionReconnectParams = {
  sessionId: string;
  sessionsRef: React.RefObject<Session[]>;
  profilesRef: React.RefObject<HostProfile[]>;
  reconnectAttemptsRef: React.RefObject<Record<string, number>>;
  clearReconnectState: (sessionId: string) => void;
  scheduleReconnect: (sessionId: string) => void;
  createSshSession: (profile: HostProfile) => Promise<Session>;
  replaceSessionConnection: (
    oldSessionId: string,
    nextSession: Session,
    nextState?: SessionStateUi,
    nextLocalMeta?: LocalSessionMeta,
  ) => void;
  setSessionStates: Setter<Record<string, SessionStateUi>>;
};

/** 执行一次远端会话重连尝试。 */
export async function attemptSessionReconnect({
  sessionId,
  sessionsRef,
  profilesRef,
  reconnectAttemptsRef,
  clearReconnectState,
  scheduleReconnect,
  createSshSession,
  replaceSessionConnection,
  setSessionStates,
}: AttemptSessionReconnectParams) {
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
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "";
    if (code === "ssh_host_key_unknown" || code === "ssh_host_key_mismatch") {
      setSessionStates((prev) => ({
        ...prev,
        [sessionId]: "disconnected",
      }));
      return;
    }
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

type ScheduleReconnectParams = {
  sessionId: string;
  reconnectAttemptsRef: React.RefObject<Record<string, number>>;
  reconnectTimersRef: React.RefObject<Record<string, number>>;
  setReconnectInfoBySession: Setter<
    Record<string, { attempt: number; delayMs: number }>
  >;
  setSessionStates: Setter<Record<string, SessionStateUi>>;
  onAttemptReconnect: (sessionId: string) => Promise<void>;
};

/** 安排下一次重连尝试。 */
export function scheduleReconnectAttempt({
  sessionId,
  reconnectAttemptsRef,
  reconnectTimersRef,
  setReconnectInfoBySession,
  setSessionStates,
  onAttemptReconnect,
}: ScheduleReconnectParams) {
  const attempts = (reconnectAttemptsRef.current[sessionId] ?? 0) + 1;
  reconnectAttemptsRef.current[sessionId] = attempts;
  const delayMs = computeReconnectDelayMs(attempts);

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
    onAttemptReconnect(sessionId).catch(() => {});
  }, delayMs);
  reconnectTimersRef.current[sessionId] = timer;
}
