/**
 * 会话生命周期状态迁移模块。
 * 职责：处理会话连接替换时的状态迁移与本地会话元数据同步。
 */
import type { Session, SessionStateUi } from "@/types";

type Setter<T> = (updater: (prev: T) => T) => void;

export type ReplaceSessionConnectionParams = {
  oldSessionId: string;
  nextSession: Session;
  nextState?: SessionStateUi;
  nextLocalMeta?: { shellId: string | null; label: string };
  activeSessionIdRef: React.RefObject<string | null>;
  localSessionIdsRef: React.RefObject<Set<string>>;
  clearReconnectState: (sessionId: string) => void;
  setActiveSessionId: (sessionId: string) => void;
  setSessions: Setter<Session[]>;
  setSessionStates: Setter<Record<string, SessionStateUi>>;
  setSessionReasons: Setter<Record<string, import("@/types").DisconnectReason>>;
  setReconnectInfoBySession: Setter<
    Record<string, { attempt: number; delayMs: number }>
  >;
  setLocalSessionMeta: Setter<
    Record<string, { shellId: string | null; label: string }>
  >;
  sessionCloseHandledRef: React.RefObject<Record<string, boolean>>;
};

/** 处理会话连接替换，并同步迁移关联状态。 */
export function replaceSessionConnectionState({
  oldSessionId,
  nextSession,
  nextState = "connecting",
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
}: ReplaceSessionConnectionParams) {
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
    prev.map((item) => (item.sessionId === oldSessionId ? nextSession : item)),
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
