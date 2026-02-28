/** 认证方式。 */
export type AuthType = "password" | "privateKey" | "agent";

/** 主机配置数据。 */
export type HostProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string | null;
  privateKeyPassphraseRef?: string | null;
  passwordRef?: string | null;
  knownHost?: string | null;
  tags?: string[] | null;
};

/** SSH 会话元数据。 */
export type Session = {
  sessionId: string;
  profileId: string;
  state: "connecting" | "connected" | "disconnected" | "error";
  createdAt: number;
  lastError?: { code: string; message: string; detail?: string | null } | null;
};

/** SFTP 文件条目。 */
export type SftpEntry = {
  path: string;
  name: string;
  kind: "file" | "dir" | "link";
  size?: number | null;
  mtime?: number | null;
  permissions?: string | null;
  owner?: string | null;
  group?: string | null;
};

/** SFTP 传输进度。 */
export type SftpProgress = {
  sessionId: string;
  op: "upload" | "download";
  path: string;
  transferred: number;
  total?: number | null;
};

/** SFTP 可用性状态。 */
export type SftpAvailability =
  | "ready"
  | "checking"
  | "disabled"
  | "unsupported";

/** 日志级别。 */
export type LogLevel = "info" | "success" | "error";

/** 日志条目。 */
export type LogEntry = {
  id: string;
  timestamp: number;
  key: import("./i18n").TranslationKey;
  vars?: Record<string, string | number>;
  level?: LogLevel;
};

/** 功能面板类型。 */
export type PanelKey = "profiles" | "files" | "transfers" | "events";
/** 功能面板区域。 */
export type PanelArea = "left" | "right" | "bottom";

/** 主题标识。 */
export type ThemeId = "dark" | "light";
/** 会话 UI 状态。 */
export type SessionStateUi =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "reconnecting";
/** 断开连接原因。 */
export type DisconnectReason =
  | "exit"
  | "poweroff"
  | "reboot"
  | "network"
  | "unknown";

/** 本地 Shell 配置。 */
export type LocalShellProfile = {
  id: string;
  label: string;
  path: string;
  args: string[];
};

/** 快捷命令分组。 */
export type QuickCommandGroup = {
  id: string;
  name: string;
  order: number;
  visible: boolean;
};

/** 快捷命令项。 */
export type QuickCommandItem = {
  id: string;
  label: string;
  command: string;
  groupId: string;
  type?: "sendText";
};

/** 快捷栏配置。 */
export type QuickBarConfig = {
  version: 1;
  showGroupTitle?: boolean;
  groups: QuickCommandGroup[];
  commands: QuickCommandItem[];
};
