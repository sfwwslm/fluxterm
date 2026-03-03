/**
 * 工作区面板装配模块。
 * 职责：将各领域状态与操作映射为可渲染的面板组件集合。
 */
import type React from "react";
import HostPanel from "@/components/terminal/profiles/HostPanel";
import TransfersPanel from "@/components/terminal/transfers/TransfersPanel";
import SftpPanel from "@/components/terminal/files/SftpPanel";
import EventsPanel from "@/components/terminal/events/EventsPanel";
import CommandHistoryPanel from "@/components/terminal/history/CommandHistoryPanel";
import AiPanel from "@/components/terminal/ai/AiPanel";
import type { AiChatMessage } from "@/features/ai/types";
import type { Locale, Translate } from "@/i18n";
import type {
  CommandHistoryItem,
  CommandHistoryLiveCapture,
  DisconnectReason,
  HostProfile,
  LocalShellProfile,
  LogEntry,
  PanelKey,
  SessionStateUi,
  SftpAvailability,
  SftpEntry,
  SftpProgress,
} from "@/types";

type BuildPanelsProps = {
  profiles: HostProfile[];
  sshGroups: string[];
  activeProfileId: string | null;
  availableShells: LocalShellProfile[];
  activeSessionId: string | null;
  activeSessionState: SessionStateUi | null;
  activeSessionReason: DisconnectReason | null;
  activeReconnectInfo: { attempt: number; delayMs: number } | null;
  isRemoteSession: boolean;
  isRemoteConnected: boolean;
  progressBySession: Record<string, SftpProgress>;
  busyMessage: string | null;
  logEntries: LogEntry[];
  historyLoaded: boolean;
  hasActiveSession: boolean;
  historyLiveCapture: CommandHistoryLiveCapture | null;
  historyItems: CommandHistoryItem[];
  historySearchQuery: string;
  aiMessages: AiChatMessage[];
  aiDraft: string;
  aiPending: boolean;
  aiErrorMessage: string | null;
  currentPath: string;
  sftpAvailability: SftpAvailability;
  terminalPathSyncStatus:
    | "active"
    | "paused"
    | "checking"
    | "unsupported"
    | "disabled";
  entries: SftpEntry[];
  locale: Locale;
  t: Translate;
  pickProfile: (profileId: string) => void;
  onConnectProfile: (profileInput: HostProfile) => Promise<void>;
  onOpenNewProfile: () => void;
  onImportOpenSshConfig: () => void;
  onOpenEditProfile: (profile: HostProfile) => void;
  onRemoveProfile: (profile: HostProfile) => void;
  onHistorySearchQueryChange: (value: string) => void;
  onExecuteHistoryItem: (command: string) => void;
  onAiDraftChange: (value: string) => void;
  onAiSend: () => Promise<void>;
  onAiClear: () => void;
  onAddGroup: (groupName: string) => boolean;
  onRenameGroup: (from: string, to: string) => Promise<boolean>;
  onRemoveGroup: (groupName: string) => Promise<boolean>;
  onMoveProfileToGroup: (
    profileId: string,
    targetGroup: string | null,
  ) => Promise<boolean>;
  onConnectLocalShell: (shell: LocalShellProfile | null) => void;
  onRefreshList: (path?: string) => Promise<void>;
  onOpenRemoteDir: (path: string) => Promise<void>;
  onOpenFile: (entry: SftpEntry) => Promise<void>;
  onUploadFile: () => Promise<void>;
  onUploadDroppedPaths: (paths: string[]) => Promise<void>;
  onDownloadFile: (entry: SftpEntry) => Promise<void>;
  onCancelTransfer: () => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameEntry: (entry: SftpEntry, name: string) => Promise<void>;
  onRemoveEntry: (entry: SftpEntry) => Promise<void>;
};

/** 构建工作区面板集合。 */
export function buildPanels(
  props: BuildPanelsProps,
): Record<PanelKey, React.ReactNode> {
  const {
    profiles,
    sshGroups,
    activeProfileId,
    availableShells,
    activeSessionId,
    activeSessionState,
    activeSessionReason,
    activeReconnectInfo,
    isRemoteSession,
    isRemoteConnected,
    progressBySession,
    busyMessage,
    logEntries,
    historyLoaded,
    hasActiveSession,
    historyLiveCapture,
    historyItems,
    historySearchQuery,
    aiMessages,
    aiDraft,
    aiPending,
    aiErrorMessage,
    currentPath,
    sftpAvailability,
    terminalPathSyncStatus,
    entries,
    locale,
    t,
    pickProfile,
    onConnectProfile,
    onOpenNewProfile,
    onImportOpenSshConfig,
    onOpenEditProfile,
    onRemoveProfile,
    onHistorySearchQueryChange,
    onExecuteHistoryItem,
    onAiDraftChange,
    onAiSend,
    onAiClear,
    onAddGroup,
    onRenameGroup,
    onRemoveGroup,
    onMoveProfileToGroup,
    onConnectLocalShell,
    onRefreshList,
    onOpenRemoteDir,
    onOpenFile,
    onUploadFile,
    onUploadDroppedPaths,
    onDownloadFile,
    onCancelTransfer,
    onCreateFolder,
    onRenameEntry,
    onRemoveEntry,
  } = props;

  return {
    profiles: (
      <HostPanel
        profiles={profiles}
        sshGroups={sshGroups}
        activeProfileId={activeProfileId}
        onPick={pickProfile}
        onConnectProfile={onConnectProfile}
        onOpenNewProfile={onOpenNewProfile}
        onImportOpenSshConfig={onImportOpenSshConfig}
        onOpenEditProfile={onOpenEditProfile}
        onRemoveProfile={onRemoveProfile}
        onAddGroup={onAddGroup}
        onRenameGroup={onRenameGroup}
        onRemoveGroup={onRemoveGroup}
        onMoveProfileToGroup={onMoveProfileToGroup}
        localShells={availableShells}
        onConnectLocalShell={onConnectLocalShell}
        t={t}
      />
    ),
    transfers: (
      <TransfersPanel
        progress={
          activeSessionId ? (progressBySession[activeSessionId] ?? null) : null
        }
        busyMessage={busyMessage}
        entries={logEntries}
        onCancel={onCancelTransfer}
        locale={locale}
        t={t}
      />
    ),
    files: (
      <SftpPanel
        isRemote={isRemoteConnected}
        isRemoteSession={isRemoteSession}
        currentPath={currentPath}
        sftpAvailability={sftpAvailability}
        terminalPathSyncStatus={terminalPathSyncStatus}
        entries={entries}
        onRefresh={onRefreshList}
        onOpen={onOpenRemoteDir}
        onOpenFile={onOpenFile}
        onUpload={onUploadFile}
        onDropUpload={onUploadDroppedPaths}
        onDownload={onDownloadFile}
        onMkdir={onCreateFolder}
        onRename={onRenameEntry}
        onRemove={onRemoveEntry}
        locale={locale}
        t={t}
      />
    ),
    events: (
      <EventsPanel
        sessionState={activeSessionState ?? "disconnected"}
        sessionReason={activeSessionReason}
        reconnectInfo={activeReconnectInfo}
        entries={logEntries}
        locale={locale}
        t={t}
      />
    ),
    history: (
      <CommandHistoryPanel
        loaded={historyLoaded}
        hasActiveSession={hasActiveSession}
        liveCapture={historyLiveCapture}
        items={historyItems}
        searchQuery={historySearchQuery}
        onSearchQueryChange={onHistorySearchQueryChange}
        onExecute={onExecuteHistoryItem}
        locale={locale}
        t={t}
      />
    ),
    ai: (
      <AiPanel
        activeSessionId={activeSessionId}
        messages={aiMessages}
        draft={aiDraft}
        pending={aiPending}
        errorMessage={aiErrorMessage}
        onDraftChange={onAiDraftChange}
        onSend={onAiSend}
        onClear={onAiClear}
        t={t}
      />
    ),
  };
}
