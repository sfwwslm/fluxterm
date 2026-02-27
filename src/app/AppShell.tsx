/**
 * 应用编排层。
 * 职责：聚合 settings/profiles/layout/session/terminal/sftp 等领域能力并组装主界面。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import "@/App.css";
import { translations, type Translate, type TranslationKey } from "@/i18n";
import TitleBar from "@/components/layout/TitleBar";
import FloatingShell from "@/components/app/FloatingShell";
import Workspace from "@/components/app/Workspace";
import TerminalPanel from "@/components/terminal/sessions/TerminalPanel";
import AboutModal from "@/components/terminal/modals/AboutModal";
import ProfileModal from "@/components/terminal/modals/ProfileModal";
import NoticeHost from "@/components/ui/notice-host";
import { useDisableBrowserShortcuts } from "@/hooks/useDisableBrowserShortcuts";
import useProfiles from "@/hooks/profile/useProfiles";
import useAppSettings from "@/hooks/settings/useAppSettings";
import useLayoutState from "@/hooks/useLayoutState";
import useFloatingPanels from "@/hooks/useFloatingPanels";
import useMacAppMenu from "@/hooks/useMacAppMenu";
import { allPanelKeys, moveWidgetToSlot } from "@/layout/model";
import type { WidgetSlot as LayoutWidgetSlot } from "@/layout/types";
import type { HostProfile, PanelKey, ThemeId } from "@/types";
import { isMacOS } from "@/utils/platform";
import useSessionController from "@/features/session/hooks/useSessionController";
import useTerminalController from "@/features/terminal/hooks/useTerminalController";
import useSftpController from "@/features/sftp/hooks/useSftpController";
import { themePresets } from "@/app/theme/themePresets";
import { buildPanels } from "@/app/panels/buildPanels";

const panelLabelKeys: Record<PanelKey, TranslationKey> = {
  profiles: "panel.profiles",
  files: "panel.files",
  transfers: "panel.transfers",
  events: "panel.events",
};

function formatMessage(
  message: string,
  vars?: Record<string, string | number>,
) {
  if (!vars) return message;
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    message,
  );
}

/** 应用主界面编排层。 */
export default function AppShell() {
  useDisableBrowserShortcuts();
  const themeIds = useMemo(() => Object.keys(themePresets) as ThemeId[], []);
  const {
    locale,
    setLocale,
    themeId,
    setThemeId,
    shellId,
    setShellId,
    availableShells,
    settingsLoaded,
  } = useAppSettings({
    themeIds,
    defaultThemeId: "dark",
  });
  const {
    profiles,
    sshGroups,
    activeProfileId,
    editingProfile,
    defaultProfile,
    pickProfile,
    saveProfile,
    removeProfile,
    addGroup,
    renameGroup,
    removeGroup,
    moveProfileToGroup,
  } = useProfiles();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalMode, setProfileModalMode] = useState<"new" | "edit">(
    "new",
  );
  const [profileDraft, setProfileDraft] = useState<HostProfile>(defaultProfile);
  const isMac = useMemo(() => isMacOS(), []);

  const t: Translate = useMemo(
    () => (key, vars) => formatMessage(translations[locale][key] ?? key, vars),
    [locale],
  );
  const floatingPanelKey = useMemo<PanelKey | null>(() => {
    const match = window.location.hash.match(/float=([a-z]+)/i);
    if (!match) return null;
    const value = match[1];
    if (value === "profiles") return "profiles";
    if (value === "files") return "files";
    if (value === "transfers") return "transfers";
    if (value === "events") return "events";
    if (value === "logs") return "events";
    return null;
  }, []);
  const layoutMenuDisabled = Boolean(floatingPanelKey);
  const floatingOriginRef = useRef<Partial<Record<PanelKey, LayoutWidgetSlot>>>(
    {},
  );
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });

  useEffect(() => {
    const theme = themePresets[themeId];
    const root = document.documentElement;
    root.dataset.theme = themeId;
    Object.entries(theme.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
  }, [themeId]);

  function openNewProfile() {
    setProfileModalMode("new");
    setProfileDraft({ ...defaultProfile, id: "" });
    setProfileModalOpen(true);
  }

  function closeProfileModal() {
    setProfileModalOpen(false);
  }

  function openEditProfile(profile: HostProfile) {
    if (!profile.id) return;
    setProfileModalMode("edit");
    setProfileDraft(profile);
    setProfileModalOpen(true);
  }

  async function submitProfile() {
    await saveProfile(profileDraft);
    setProfileModalOpen(false);
  }

  const availableWidgets = allPanelKeys;
  const panelLabels = useMemo(
    () => ({
      profiles: t(panelLabelKeys.profiles),
      files: t(panelLabelKeys.files),
      transfers: t(panelLabelKeys.transfers),
      events: t(panelLabelKeys.events),
    }),
    [t],
  );

  const { sessionState, sessionActions, sessionRefs } = useSessionController({
    profiles,
    t,
    shellId,
    availableShells,
    settingsLoaded,
    getTerminalSize: () => terminalSizeRef.current,
  });

  const { terminalQuery, terminalActions } = useTerminalController({
    theme: themePresets[themeId].terminal,
    activeSessionId: sessionState.activeSessionId,
    activeSession: sessionState.activeSession,
    sessions: sessionState.sessions,
    sessionStatesRef: sessionRefs.sessionStatesRef,
    sessionReasonsRef: sessionRefs.sessionReasonsRef,
    sessionBuffersRef: sessionRefs.sessionBuffersRef,
    recordCommandInput: sessionActions.recordCommandInput,
    writeToSession: sessionActions.writeToSession,
    resizeSession: sessionActions.resizeSession,
    isLocalSession: sessionActions.isLocalSession,
    reconnectSession: sessionActions.reconnectSession,
    reconnectLocalShell: sessionActions.reconnectLocalShell,
    onSizeChange: (size) => {
      terminalSizeRef.current = size;
    },
  });

  const { sftpState, sftpActions } = useSftpController({
    activeSessionId: sessionState.activeSessionId,
    activeSession: sessionState.activeSession,
    activeSessionState: sessionState.activeSessionState,
    sessionStatesRef: sessionRefs.sessionStatesRef,
    isLocalSession: sessionActions.isLocalSession,
    appendLog: sessionActions.appendLog,
    setBusyMessage: sessionActions.setBusyMessage,
    t,
  });

  const {
    layoutCollapsed,
    sideSlotCounts,
    slotGroups,
    leftVisible,
    rightVisible,
    bottomVisible,
    layoutVars,
    setSlotGroups,
    handleToggleSplit,
    handleCloseSlot,
    handleToggleCollapsed,
    startResize,
  } = useLayoutState({
    floatingPanelKey,
    floatingOriginRef,
  });

  const { handleFloat } = useFloatingPanels({
    floatingPanelKey,
    floatingOriginRef,
    slotGroups,
    setSlotGroups,
    panelLabels,
    layoutCollapsed,
    locale,
    themeId,
    setLocale,
    setThemeId,
  });

  useMacAppMenu({
    locale,
    themeId,
    shellId,
    availableShells,
    layoutCollapsed,
    onToggleCollapsed: handleToggleCollapsed,
    setLocale,
    setThemeId,
    setShellId,
    onOpenAbout: () => setAboutOpen(true),
    t,
  });

  async function handleConnectProfile(profileInput: HostProfile) {
    if (!profileInput.host || !profileInput.username) {
      sessionActions.setBusyMessage(t("messages.missingHostUser"));
      return;
    }
    if (profileInput.id) {
      pickProfile(profileInput.id);
    }
    sessionActions.setBusyMessage(t("messages.connecting"));
    try {
      const profile = profileInput.id
        ? profileInput
        : await saveProfile(profileInput);
      await sessionActions.connectProfile(profile);
      sessionActions.setBusyMessage(null);
    } catch (error: any) {
      sessionActions.setBusyMessage(
        error?.message ?? t("messages.connectFailed"),
      );
    }
  }

  const panels = useMemo(
    () =>
      buildPanels({
        profiles,
        sshGroups,
        activeProfileId,
        availableShells,
        activeSessionId: sessionState.activeSessionId,
        activeSessionState: sessionState.activeSessionState,
        activeSessionReason: sessionState.activeSessionReason,
        activeReconnectInfo: sessionState.activeReconnectInfo,
        isRemoteSession: sessionState.isRemoteSession,
        isRemoteConnected: sessionState.isRemoteConnected,
        progressBySession: sftpState.progressBySession,
        busyMessage: sessionState.busyMessage,
        logEntries: sessionState.logEntries,
        currentPath: sftpState.currentPath,
        entries: sftpState.entries,
        locale,
        canReconnect: sessionState.canReconnect,
        t,
        pickProfile,
        onConnectProfile: handleConnectProfile,
        onOpenNewProfile: openNewProfile,
        onOpenEditProfile: openEditProfile,
        onRemoveProfile: (profile) => removeProfile(profile.id),
        onAddGroup: addGroup,
        onRenameGroup: renameGroup,
        onRemoveGroup: removeGroup,
        onMoveProfileToGroup: moveProfileToGroup,
        onConnectLocalShell: (shell) => {
          sessionActions.connectLocalShell(shell, true).catch(() => {});
        },
        onRefreshList: sftpActions.refreshList,
        onOpenRemoteDir: sftpActions.openRemoteDir,
        onUploadFile: sftpActions.uploadFile,
        onDownloadFile: sftpActions.downloadFile,
        onCreateFolder: sftpActions.createFolder,
        onRenameEntry: sftpActions.rename,
        onRemoveEntry: sftpActions.remove,
        onReconnectActive: () => {
          if (!sessionState.activeSessionId) return;
          sessionActions
            .reconnectSession(sessionState.activeSessionId)
            .catch(() => {});
        },
      }),
    [
      profiles,
      sshGroups,
      activeProfileId,
      availableShells,
      sessionState.activeSessionId,
      sessionState.activeSessionState,
      sessionState.activeSessionReason,
      sessionState.activeReconnectInfo,
      sessionState.isRemoteSession,
      sessionState.isRemoteConnected,
      sftpState.progressBySession,
      sessionState.busyMessage,
      sessionState.logEntries,
      sftpState.currentPath,
      sftpState.entries,
      locale,
      sessionState.canReconnect,
      t,
      pickProfile,
      addGroup,
      renameGroup,
      removeGroup,
      moveProfileToGroup,
      sftpActions.refreshList,
      sftpActions.openRemoteDir,
      sftpActions.uploadFile,
      sftpActions.downloadFile,
      sftpActions.createFolder,
      sftpActions.rename,
      sftpActions.remove,
    ],
  );

  function handleSlotSelect(slot: LayoutWidgetSlot, key: PanelKey) {
    setSlotGroups((prev) => {
      const group = prev[slot];
      if (!group.widgets.includes(key)) return prev;
      return { ...prev, [slot]: { ...group, active: key } };
    });
  }

  function handleSlotAdd(slot: LayoutWidgetSlot, key: PanelKey) {
    setSlotGroups((prev) => {
      const moved = moveWidgetToSlot(prev, key, slot);
      const group = moved[slot];
      return {
        ...moved,
        [slot]: {
          ...group,
          active: key,
        },
      };
    });
  }

  function handleDropWidget(slot: LayoutWidgetSlot, key: PanelKey) {
    setSlotGroups((prev) => moveWidgetToSlot(prev, key, slot));
  }

  function handleDragWidget(
    event: React.DragEvent<HTMLDivElement>,
    _slot: LayoutWidgetSlot,
    key: PanelKey,
  ) {
    event.dataTransfer.setData(
      "application/x-flux-widget",
      JSON.stringify({ key }),
    );
  }

  return (
    <>
      {floatingPanelKey ? (
        <FloatingShell
          floatingPanelKey={floatingPanelKey}
          panelLabels={panelLabels}
          panelBody={panels[floatingPanelKey]}
          layoutCollapsed={layoutCollapsed}
          onToggleCollapsed={handleToggleCollapsed}
          layoutMenuDisabled={layoutMenuDisabled}
          aboutOpen={aboutOpen}
          onOpenAbout={() => setAboutOpen(true)}
          onCloseAbout={() => setAboutOpen(false)}
          locale={locale}
          themeId={themeId}
          shellId={shellId}
          availableShells={availableShells}
          themes={themePresets}
          onLocaleChange={(next) => setLocale(next)}
          onShellChange={(next) => setShellId(next)}
          onThemeChange={(next) => setThemeId(next)}
          t={t}
        />
      ) : (
        <div className="app-shell" style={layoutVars}>
          {!isMac && (
            <TitleBar
              layoutCollapsed={layoutCollapsed}
              onToggleCollapsed={handleToggleCollapsed}
              onOpenAbout={() => setAboutOpen(true)}
              layoutDisabled={layoutMenuDisabled}
              locale={locale}
              themeId={themeId}
              shellId={shellId}
              availableShells={availableShells}
              themes={themePresets}
              onLocaleChange={(next) => setLocale(next)}
              onShellChange={(next) => setShellId(next)}
              onThemeChange={(next) => setThemeId(next)}
              t={t}
            />
          )}

          <Workspace
            layoutCollapsed={layoutCollapsed}
            sideSlotCounts={sideSlotCounts}
            slotGroups={slotGroups}
            panelLabels={panelLabels}
            panels={panels}
            terminalPanel={
              <TerminalPanel
                sessions={sessionState.sessions}
                profiles={profiles}
                editingProfile={editingProfile}
                localSessionMeta={sessionState.localSessionMeta}
                activeSessionId={sessionState.activeSessionId}
                activeSession={sessionState.activeSession}
                activeSessionState={sessionState.activeSessionState}
                activeSessionReason={sessionState.activeSessionReason}
                sessionStates={sessionState.sessionStates}
                registerTerminalContainer={
                  terminalActions.registerTerminalContainer
                }
                isTerminalReady={terminalQuery.isTerminalReady}
                hasActiveSelection={terminalQuery.hasActiveSelection}
                onCopySelection={terminalActions.copyActiveSelection}
                onPaste={terminalActions.pasteToActiveTerminal}
                onClear={terminalActions.clearActiveTerminal}
                onSearchNext={terminalActions.searchActiveTerminalNext}
                onSearchPrev={terminalActions.searchActiveTerminalPrev}
                isLocalSession={sessionActions.isLocalSession}
                onSwitchSession={sessionActions.switchSession}
                onDisconnectSession={sessionActions.disconnectSession}
                t={t}
              />
            }
            availableWidgets={availableWidgets}
            leftVisible={leftVisible}
            rightVisible={rightVisible}
            bottomVisible={bottomVisible}
            onSelect={handleSlotSelect}
            onAdd={handleSlotAdd}
            onFloat={handleFloat}
            onCloseWidget={handleCloseSlot}
            onDropWidget={handleDropWidget}
            onDragWidget={handleDragWidget}
            onToggleSplit={handleToggleSplit}
            onStartResize={startResize}
            t={t}
          />

          <AboutModal
            open={aboutOpen}
            onClose={() => setAboutOpen(false)}
            t={t}
          />
        </div>
      )}
      <ProfileModal
        open={profileModalOpen}
        mode={profileModalMode}
        draft={profileDraft}
        sshGroups={sshGroups}
        onDraftChange={setProfileDraft}
        onClose={closeProfileModal}
        onSubmit={submitProfile}
        t={t}
      />
      <NoticeHost />
    </>
  );
}
