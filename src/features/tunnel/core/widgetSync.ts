/**
 * 浮动隧道面板同步协议。
 * 职责：定义主窗口与浮动隧道面板之间共享的最小状态快照与动作消息。
 */
import type { SshTunnelRuntime, SshTunnelSpec } from "@/types";
import type { SessionStateUi } from "@/types";

/** 浮动隧道面板与主窗口之间共享的 BroadcastChannel 名称。 */
export const WIDGET_TUNNELS_CHANNEL = "fluxterm-tunnels-sync";

/** 隧道面板快照：描述当前活动会话的可渲染最小状态。 */
export type FloatingTunnelsSnapshot = {
  activeSessionId: string | null;
  supportsSshTunnel: boolean;
  sessionState: SessionStateUi;
  sessionLabel: string | null;
  sessionHost: string | null;
  sessionUsername: string | null;
  tunnels: SshTunnelRuntime[];
};

/** 浮动隧道面板发往主窗口的操作消息。 */
export type FloatingTunnelsActionMessage =
  | { type: "tunnels:request-snapshot" }
  | { type: "tunnels:open"; spec: SshTunnelSpec }
  | { type: "tunnels:close"; tunnelId: string }
  | { type: "tunnels:close-all" };

/** 主窗口发往浮动隧道面板的状态快照消息。 */
export type FloatingTunnelsSnapshotMessage = {
  type: "tunnels:snapshot";
  payload: FloatingTunnelsSnapshot;
};

/** 浮动隧道面板同步协议的完整消息集合。 */
export type FloatingTunnelsMessage =
  | FloatingTunnelsActionMessage
  | FloatingTunnelsSnapshotMessage;
