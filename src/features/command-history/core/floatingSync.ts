/**
 * 历史命令浮动面板同步协议。
 * 职责：
 * 1. 约束主窗口与浮动窗口之间的最小消息模型。
 * 2. 避免浮动面板直接依赖主窗口的局部 React 状态。
 */
import type { CommandHistoryItem, CommandHistoryLiveCapture } from "@/types";

/** 浮动历史命令面板与主窗口之间共享的 BroadcastChannel 名称。 */
export const FLOATING_HISTORY_CHANNEL = "fluxterm-history-sync";

/** 历史命令面板快照：描述当前活动会话的历史列表最小状态。 */
export type FloatingHistorySnapshot = {
  activeSessionId: string | null;
  hasActiveSession: boolean;
  liveCapture: CommandHistoryLiveCapture | null;
  items: CommandHistoryItem[];
};

/** 浮动历史命令面板发往主窗口的操作消息。 */
export type FloatingHistoryActionMessage =
  | { type: "history:request-snapshot" }
  | { type: "history:execute"; command: string };

/** 主窗口发往浮动历史命令面板的状态快照消息。 */
export type FloatingHistorySnapshotMessage = {
  type: "history:snapshot";
  payload: FloatingHistorySnapshot;
};

/** 浮动历史命令面板同步协议的完整消息集合。 */
export type FloatingHistoryMessage =
  | FloatingHistoryActionMessage
  | FloatingHistorySnapshotMessage;
