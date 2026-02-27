/**
 * 会话事件监听模块。
 * 职责：统一注册 terminal:exit 与 session:status 监听并提供卸载能力。
 */
import type { SessionStateUi } from "@/types";
import { subscribeTauri } from "@/shared/tauri/events";

type SessionStatusPayload = {
  sessionId: string;
  state: SessionStateUi;
  error?: { message: string };
};

type RegisterSessionListenersProps = {
  onTerminalExit: (payload: { sessionId: string }) => void;
  onSessionStatus: (payload: SessionStatusPayload) => void;
};

/**
 * 注册会话相关事件监听，并返回统一卸载函数。
 */
export async function registerSessionListeners({
  onTerminalExit,
  onSessionStatus,
}: RegisterSessionListenersProps) {
  const unlisteners: Array<() => void> = [];

  const exitUnlisten = await subscribeTauri<{ sessionId: string }>(
    "terminal:exit",
    (event) => onTerminalExit(event.payload),
  );
  unlisteners.push(exitUnlisten);

  const statusUnlisten = await subscribeTauri<SessionStatusPayload>(
    "session:status",
    (event) => onSessionStatus(event.payload),
  );
  unlisteners.push(statusUnlisten);

  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
