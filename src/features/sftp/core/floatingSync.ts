/**
 * 浮动文件面板同步协议。
 * 职责：定义主窗口与浮动文件管理器之间共享的状态快照与操作消息类型。
 */
import type { SftpAvailability, SftpEntry } from "@/types";

/** 浮动文件面板与主窗口之间共享的 BroadcastChannel 名称。 */
export const FLOATING_FILES_CHANNEL = "fluxterm-files-sync";

/** 文件面板快照：描述当前会话下文件管理器可渲染的最小状态。 */
export type FloatingFilesSnapshot = {
  activeSessionId: string | null;
  isRemoteSession: boolean;
  isRemoteConnected: boolean;
  sftpAvailability: SftpAvailability;
  terminalPathSyncStatus:
    | "active"
    | "paused"
    | "checking"
    | "unsupported"
    | "disabled";
  currentPath: string;
  entries: SftpEntry[];
};

/** 浮动文件面板发往主窗口的操作消息。 */
export type FloatingFilesActionMessage =
  | { type: "files:request-snapshot" }
  | { type: "files:refresh"; path?: string }
  | { type: "files:open"; path: string }
  | { type: "files:open-file"; entry: SftpEntry }
  | { type: "files:upload" }
  | { type: "files:download"; entry: SftpEntry }
  | { type: "files:mkdir"; name: string }
  | { type: "files:rename"; entry: SftpEntry; name: string }
  | { type: "files:remove"; entry: SftpEntry };

/** 主窗口发往浮动文件面板的状态快照消息。 */
export type FloatingFilesSnapshotMessage = {
  type: "files:snapshot";
  payload: FloatingFilesSnapshot;
};

/** 浮动文件面板同步协议的完整消息集合。 */
export type FloatingFilesMessage =
  | FloatingFilesActionMessage
  | FloatingFilesSnapshotMessage;
