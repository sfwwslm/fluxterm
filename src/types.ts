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
  lastError?: {
    code: string;
    message: string;
    detail?: string | null;
    details?: string | null;
  } | null;
};

/** 会话窗格标识。 */
export type SessionPaneId = string;

/** 会话窗格树节点。 */
export type SessionPaneNode =
  | {
      kind: "leaf";
      paneId: SessionPaneId;
      sessionIds: string[];
      activeSessionId: string | null;
    }
  | {
      kind: "split";
      axis: "horizontal" | "vertical";
      ratio: number;
      first: SessionPaneNode;
      second: SessionPaneNode;
    };

/** 会话工作区状态。 */
export type SessionWorkspaceState = {
  root: SessionPaneNode | null;
  activePaneId: SessionPaneId | null;
};

/** SFTP 文件条目。 */
export type SftpEntry = {
  path: string;
  name: string;
  kind: "file" | "dir" | "link";
  hidden?: boolean | null;
  size?: number | null;
  mtime?: number | null;
  permissions?: string | null;
  owner?: string | null;
  group?: string | null;
};

/** SFTP 传输进度。 */
export type SftpTransferKind = "file" | "directory" | "batch";
export type SftpTransferStatus =
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "cancelled";

/** SFTP 传输进度。 */
export type SftpProgress = {
  sessionId: string;
  transferId: string;
  op: "upload" | "download";
  kind: SftpTransferKind;
  path: string;
  displayName: string;
  itemLabel: string;
  targetName?: string | null;
  currentItemName?: string | null;
  transferred: number;
  total?: number | null;
  completedItems: number;
  totalItems?: number | null;
  status: SftpTransferStatus;
  failedItems: number;
};

/** SFTP 可用性状态。 */
export type SftpAvailability =
  | "ready"
  | "checking"
  | "disabled"
  | "unsupported";

/** 资源监控状态。 */
export type ResourceMonitorStatus =
  | "disabled"
  | "checking"
  | "ready"
  | "unsupported";

/** 资源监控不可用原因。 */
export type ResourceMonitorUnsupportedReason =
  | "host_key_untrusted"
  | "probe_failed"
  | "connect_failed"
  | "unsupported_platform"
  | "sample_failed";

/** CPU 资源快照。 */
export type ResourceCpuSnapshot = {
  totalPercent: number;
  userPercent: number;
  systemPercent: number;
  idlePercent: number;
  iowaitPercent: number;
};

/** 内存资源快照。 */
export type ResourceMemorySnapshot = {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  cacheBytes: number;
};

/** 会话资源快照。 */
export type SessionResourceSnapshot = {
  sessionId: string;
  sampledAt: number;
  source: "local" | "ssh-linux";
  status: ResourceMonitorStatus;
  unsupportedReason?: ResourceMonitorUnsupportedReason | null;
  cpu?: ResourceCpuSnapshot | null;
  memory?: ResourceMemorySnapshot | null;
};

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

/** 历史命令来源。 */
export type CommandHistorySource = "typed" | "quickbar" | "history";

/** 历史命令实时监听状态。 */
export type CommandHistoryLiveState = "listening" | "tracking";

/** 当前输入行的实时监听项。 */
export type CommandHistoryLiveCapture = {
  state: CommandHistoryLiveState;
  command: string;
  updatedAt: number;
};

/** 历史命令项。 */
export type CommandHistoryItem = {
  id: string;
  command: string;
  firstUsedAt: number;
  lastUsedAt: number;
  useCount: number;
  source: CommandHistorySource;
};

/**
 * 历史命令作用域类型。
 * 当前持久化与联想实际使用的是 `global`；
 * `ssh` / `local` 预留给未来按作用域持久化历史命令的扩展。
 */
export type CommandHistoryScopeType = "ssh" | "local" | "global";

/** 历史命令分桶。 */
export type CommandHistoryBucket = {
  scopeKey: string;
  scopeType: CommandHistoryScopeType;
  label: string;
  updatedAt: number;
  items: CommandHistoryItem[];
};

/** 历史命令存储结构。 */
export type CommandHistoryStore = {
  version: 1;
  buckets: Record<string, CommandHistoryBucket>;
};

/** 功能面板类型。 */
export type PanelKey =
  | "profiles"
  | "files"
  | "transfers"
  | "events"
  | "history"
  | "ai";
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
