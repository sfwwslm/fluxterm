/**
 * 工作区面板装配模块。
 * 职责：将各领域状态与操作映射为可渲染的面板组件集合。
 */
import type React from "react";
import HostPanel from "@/components/terminal/profiles/HostPanel";
import TransfersPanel from "@/components/terminal/transfers/TransfersPanel";
import SftpPanel from "@/components/terminal/files/SftpPanel";
import EventsPanel from "@/components/terminal/events/EventsPanel";
import type { Locale, Translate } from "@/i18n";
import type {
  DisconnectReason,
  HostProfile,
  LocalShellProfile,
  LogEntry,
  PanelKey,
  SessionStateUi,
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
  currentPath: string;
  entries: SftpEntry[];
  locale: Locale;
  canReconnect: boolean;
  t: Translate;
  pickProfile: (profileId: string) => void;
  onConnectProfile: (profileInput: HostProfile) => Promise<void>;
  onOpenNewProfile: () => void;
  onOpenEditProfile: (profile: HostProfile) => void;
  onRemoveProfile: (profile: HostProfile) => void;
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
  onUploadFile: () => Promise<void>;
  onDownloadFile: (entry: SftpEntry) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameEntry: (entry: SftpEntry, name: string) => Promise<void>;
  onRemoveEntry: (entry: SftpEntry) => Promise<void>;
  onReconnectActive: () => void;
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
    currentPath,
    entries,
    locale,
    canReconnect,
    t,
    pickProfile,
    onConnectProfile,
    onOpenNewProfile,
    onOpenEditProfile,
    onRemoveProfile,
    onAddGroup,
    onRenameGroup,
    onRemoveGroup,
    onMoveProfileToGroup,
    onConnectLocalShell,
    onRefreshList,
    onOpenRemoteDir,
    onUploadFile,
    onDownloadFile,
    onCreateFolder,
    onRenameEntry,
    onRemoveEntry,
    onReconnectActive,
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
        locale={locale}
        t={t}
      />
    ),
    files: (
      <SftpPanel
        isRemote={isRemoteConnected}
        isRemoteSession={isRemoteSession}
        currentPath={currentPath}
        entries={entries}
        onRefresh={onRefreshList}
        onOpen={onOpenRemoteDir}
        onUpload={onUploadFile}
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
        onReconnect={onReconnectActive}
        canReconnect={canReconnect}
        entries={logEntries}
        locale={locale}
        t={t}
      />
    ),
  };
}
