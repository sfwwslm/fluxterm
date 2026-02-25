import { useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import "@/App.css";
import {
  translations,
  type Locale,
  type Translate,
  type TranslationKey,
} from "@/i18n";
import HostPanel from "@/components/terminal/profiles/HostPanel";
import TitleBar from "@/components/layout/TitleBar";
import FloatingShell from "@/components/app/FloatingShell";
import Workspace from "@/components/app/Workspace";
import TerminalPanel from "@/components/terminal/sessions/TerminalPanel";
import AboutModal from "@/components/terminal/modals/AboutModal";
import ProfileModal from "@/components/terminal/modals/ProfileModal";
import EventsPanel from "@/components/terminal/events/EventsPanel";
import SftpPanel from "@/components/terminal/files/SftpPanel";
import TransfersPanel from "@/components/terminal/transfers/TransfersPanel";
import { useDisableBrowserShortcuts } from "@/hooks/useDisableBrowserShortcuts";
import useProfiles from "@/hooks/profile/useProfiles";
import useAppSettings from "@/hooks/settings/useAppSettings";
import useSessionState from "@/hooks/session/useSessionState";
import useTerminalRuntime from "@/hooks/terminal/useTerminalRuntime";
import useSftpState from "@/hooks/sftp/useSftpState";
import useLayoutState from "@/hooks/useLayoutState";
import useFloatingPanels from "@/hooks/useFloatingPanels";
import { allPanelKeys, moveWidgetToSlot } from "@/layout/model";
import type { WidgetSlot as LayoutWidgetSlot } from "@/layout/types";
import type { HostProfile, PanelKey, ThemeId } from "@/types";

const panelLabelKeys: Record<PanelKey, TranslationKey> = {
  profiles: "panel.profiles",
  files: "panel.files",
  transfers: "panel.transfers",
  events: "panel.events",
};

const themes: Record<
  ThemeId,
  {
    label: Record<Locale, string>;
    vars: Record<string, string>;
    terminal: {
      background: string;
      foreground: string;
      selectionBackground: string;
      cursor: string;
    };
  }
> = {
  dark: {
    label: { zh: "深色", en: "Dark" },
    vars: {
      "--app-bg-gradient": "linear-gradient(140deg, #000000 0%, #000000 100%)",
      "--app-bg-image": "none",
      "--app-bg-base": "#000000",
      "--text-primary": "#ffffff",
      "--text-secondary": "#e6e6e6",
      "--text-muted": "#bdbdbd",
      "--text-soft": "#cccccc",
      "--text-quiet": "#999999",
      "--accent": "#ffffff",
      "--accent-strong": "#ffffff",
      "--accent-contrast": "#000000",
      "--accent-soft": "rgba(255, 255, 255, 0.6)",
      "--accent-subtle": "rgba(255, 255, 255, 0.18)",
      "--surface": "rgba(0, 0, 0, 0.86)",
      "--surface-strong": "rgba(0, 0, 0, 0.92)",
      "--surface-alt": "rgba(0, 0, 0, 0.8)",
      "--surface-header": "rgba(0, 0, 0, 0.8)",
      "--surface-header-strong": "rgba(0, 0, 0, 0.88)",
      "--surface-menu": "rgba(0, 0, 0, 0.98)",
      "--border-weak": "rgba(255, 255, 255, 0.16)",
      "--border-soft": "rgba(255, 255, 255, 0.1)",
      "--border-input": "rgba(255, 255, 255, 0.2)",
      "--button-bg": "rgba(255, 255, 255, 0.08)",
      "--button-bg-strong": "rgba(255, 255, 255, 0.12)",
      "--button-text": "#ffffff",
      "--input-bg": "rgba(0, 0, 0, 0.92)",
      "--input-text": "#ffffff",
      "--tab-bg": "rgba(0, 0, 0, 0.88)",
      "--tab-border": "rgba(255, 255, 255, 0.24)",
      "--success": "#ffffff",
      "--success-soft": "rgba(255, 255, 255, 0.3)",
      "--danger": "#d9d9d9",
      "--resizer-bg": "rgba(255, 255, 255, 0.08)",
      "--progress-gradient": "linear-gradient(120deg, #ffffff, #bfbfbf)",
      "--shadow-strong": "0 16px 32px rgba(0, 0, 0, 0.5)",
      "--brand-glow": "0 0 12px rgba(255, 255, 255, 0.55)",
    },
    terminal: {
      background: "#000000",
      foreground: "#ffffff",
      selectionBackground: "#333333",
      cursor: "#ffffff",
    },
  },
  light: {
    label: { zh: "浅色", en: "Light" },
    vars: {
      "--app-bg-gradient": "linear-gradient(140deg, #ffffff 0%, #ffffff 100%)",
      "--app-bg-image": "none",
      "--app-bg-base": "#ffffff",
      "--text-primary": "#000000",
      "--text-secondary": "#1f1f1f",
      "--text-muted": "#595959",
      "--text-soft": "#434343",
      "--text-quiet": "#737373",
      "--accent": "#000000",
      "--accent-strong": "#000000",
      "--accent-contrast": "#ffffff",
      "--accent-soft": "rgba(0, 0, 0, 0.46)",
      "--accent-subtle": "rgba(0, 0, 0, 0.12)",
      "--surface": "rgba(255, 255, 255, 0.9)",
      "--surface-strong": "rgba(255, 255, 255, 0.96)",
      "--surface-alt": "rgba(255, 255, 255, 0.88)",
      "--surface-header": "rgba(255, 255, 255, 0.92)",
      "--surface-header-strong": "rgba(255, 255, 255, 0.98)",
      "--surface-menu": "rgba(255, 255, 255, 0.98)",
      "--border-weak": "rgba(0, 0, 0, 0.14)",
      "--border-soft": "rgba(0, 0, 0, 0.08)",
      "--border-input": "rgba(0, 0, 0, 0.2)",
      "--button-bg": "rgba(0, 0, 0, 0.06)",
      "--button-bg-strong": "rgba(0, 0, 0, 0.1)",
      "--button-text": "#000000",
      "--input-bg": "rgba(255, 255, 255, 0.95)",
      "--input-text": "#000000",
      "--tab-bg": "rgba(255, 255, 255, 0.95)",
      "--tab-border": "rgba(0, 0, 0, 0.22)",
      "--success": "#000000",
      "--success-soft": "rgba(0, 0, 0, 0.24)",
      "--danger": "#262626",
      "--resizer-bg": "rgba(0, 0, 0, 0.06)",
      "--progress-gradient": "linear-gradient(120deg, #000000, #666666)",
      "--shadow-strong": "0 16px 32px rgba(0, 0, 0, 0.2)",
      "--brand-glow": "0 0 12px rgba(0, 0, 0, 0.28)",
    },
    terminal: {
      background: "#ffffff",
      foreground: "#000000",
      selectionBackground: "#d9d9d9",
      cursor: "#000000",
    },
  },
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

/** 应用主界面组件。 */
function App() {
  useDisableBrowserShortcuts();
  const themeIds = useMemo(() => Object.keys(themes) as ThemeId[], []);
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
    activeProfileId,
    editingProfile,
    defaultProfile,
    pickProfile,
    saveProfile,
    removeProfile,
  } = useProfiles();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalMode, setProfileModalMode] = useState<"new" | "edit">(
    "new",
  );
  const [profileDraft, setProfileDraft] = useState<HostProfile>(defaultProfile);

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
    const theme = themes[themeId];
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

  const {
    sessions,
    activeSessionId,
    sessionStates,
    localSessionMeta,
    logEntries,
    busyMessage,
    activeSession,
    activeSessionState,
    activeSessionReason,
    activeReconnectInfo,
    isRemoteSession,
    isRemoteConnected,
    canReconnect,
    sessionRef,
    sessionStatesRef,
    sessionReasonsRef,
    sessionBuffersRef,
    appendLog,
    setBusyMessage,
    isLocalSession,
    recordCommandInput,
    writeToSession,
    resizeSession,
    connectProfile,
    connectLocalShell,
    disconnectSession,
    reconnectSession,
    reconnectLocalShell,
    switchSession,
  } = useSessionState({
    profiles,
    t,
    shellId,
    availableShells,
    settingsLoaded,
    getTerminalSize: () => terminalSizeRef.current,
  });

  const { terminalRef, terminalReady } = useTerminalRuntime({
    theme: themes[themeId].terminal,
    activeSessionId,
    activeSession,
    sessionRef,
    sessionStatesRef,
    sessionReasonsRef,
    sessionBuffersRef,
    recordCommandInput,
    writeToSession,
    resizeSession,
    isLocalSession,
    reconnectSession,
    reconnectLocalShell,
    onSizeChange: (size) => {
      terminalSizeRef.current = size;
    },
  });

  const {
    currentPath,
    entries,
    progressBySession,
    refreshList,
    openRemoteDir,
    uploadFile,
    downloadFile,
    createFolder,
    rename,
    remove,
  } = useSftpState({
    activeSessionId,
    activeSession,
    activeSessionState,
    sessionStatesRef,
    isLocalSession,
    appendLog,
    setBusyMessage,
    t,
  });

  const {
    layoutSplit,
    layoutCollapsed,
    layoutSplitRatio,
    slotGroups,
    leftVisible,
    rightVisible,
    bottomVisible,
    layoutVars,
    setSlotGroups,
    handleToggleSplit,
    handleToggleCollapsed,
    startResize,
    startSlotResize,
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
    layoutSplit,
    layoutCollapsed,
    layoutSplitRatio,
    locale,
    themeId,
    setLocale,
    setThemeId,
  });

  async function handleConnectProfile(profileInput: HostProfile) {
    if (!profileInput.host || !profileInput.username) {
      setBusyMessage(t("messages.missingHostUser"));
      return;
    }
    if (profileInput.id) {
      pickProfile(profileInput.id);
    }
    setBusyMessage(t("messages.connecting"));
    try {
      const profile = profileInput.id
        ? profileInput
        : await saveProfile(profileInput);
      await connectProfile(profile);
      setBusyMessage(null);
    } catch (error: any) {
      setBusyMessage(error?.message ?? t("messages.connectFailed"));
    }
  }

  const panels = useMemo(() => {
    return {
      profiles: (
        <HostPanel
          profiles={profiles}
          activeProfileId={activeProfileId}
          onPick={pickProfile}
          onConnectProfile={handleConnectProfile}
          onOpenNewProfile={openNewProfile}
          onOpenEditProfile={openEditProfile}
          onRemoveProfile={(profile) => removeProfile(profile.id)}
          localShells={availableShells}
          onConnectLocalShell={(shell) => {
            connectLocalShell(shell, true).catch(() => {});
          }}
          t={t}
        />
      ),
      transfers: (
        <TransfersPanel
          progress={
            activeSessionId
              ? (progressBySession[activeSessionId] ?? null)
              : null
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
          onRefresh={refreshList}
          onOpen={openRemoteDir}
          onUpload={uploadFile}
          onDownload={downloadFile}
          onMkdir={createFolder}
          onRename={rename}
          onRemove={remove}
          locale={locale}
          t={t}
        />
      ),
      events: (
        <EventsPanel
          sessionState={activeSessionState ?? "disconnected"}
          sessionReason={activeSessionReason}
          reconnectInfo={activeReconnectInfo}
          onReconnect={() => {
            if (!activeSessionId) return;
            reconnectSession(activeSessionId).catch(() => {});
          }}
          canReconnect={canReconnect}
          entries={logEntries}
          locale={locale}
          t={t}
        />
      ),
    };
  }, [
    profiles,
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
    handleConnectProfile,
    connectLocalShell,
    refreshList,
    openRemoteDir,
    uploadFile,
    downloadFile,
    createFolder,
    rename,
    remove,
    reconnectSession,
  ]);

  function handleSlotSelect(slot: LayoutWidgetSlot, key: PanelKey) {
    setSlotGroups((prev) => {
      const group = prev[slot];
      if (!group.widgets.includes(key)) return prev;
      return { ...prev, [slot]: { ...group, active: key } };
    });
  }

  function handleSlotAdd(slot: LayoutWidgetSlot, key: PanelKey) {
    setSlotGroups((prev) => moveWidgetToSlot(prev, key, slot));
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

  if (floatingPanelKey) {
    return (
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
        themes={themes}
        onLocaleChange={(next) => setLocale(next)}
        onShellChange={(next) => setShellId(next)}
        onThemeChange={(next) => setThemeId(next)}
        t={t}
      />
    );
  }

  return (
    <div className="app-shell" style={layoutVars}>
      <TitleBar
        layoutCollapsed={layoutCollapsed}
        onToggleCollapsed={handleToggleCollapsed}
        onOpenAbout={() => setAboutOpen(true)}
        layoutDisabled={layoutMenuDisabled}
        locale={locale}
        themeId={themeId}
        shellId={shellId}
        availableShells={availableShells}
        themes={themes}
        onLocaleChange={(next) => setLocale(next)}
        onShellChange={(next) => setShellId(next)}
        onThemeChange={(next) => setThemeId(next)}
        t={t}
      />

      <Workspace
        layoutSplit={layoutSplit}
        layoutCollapsed={layoutCollapsed}
        layoutSplitRatio={layoutSplitRatio}
        slotGroups={slotGroups}
        panelLabels={panelLabels}
        panels={panels}
        terminalPanel={
          <TerminalPanel
            sessions={sessions}
            profiles={profiles}
            editingProfile={editingProfile}
            localSessionMeta={localSessionMeta}
            activeSessionId={activeSessionId}
            activeSession={activeSession}
            activeSessionState={activeSessionState}
            activeSessionReason={activeSessionReason}
            sessionStates={sessionStates}
            terminalReady={terminalReady}
            terminalRef={terminalRef}
            isLocalSession={isLocalSession}
            onSwitchSession={switchSession}
            onDisconnectSession={disconnectSession}
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
        onDropWidget={handleDropWidget}
        onDragWidget={handleDragWidget}
        onToggleSplit={handleToggleSplit}
        onToggleCollapsed={handleToggleCollapsed}
        onStartSplitResize={startSlotResize}
        onStartResize={startResize}
        t={t}
      />

      <ProfileModal
        open={profileModalOpen}
        mode={profileModalMode}
        draft={profileDraft}
        onDraftChange={setProfileDraft}
        onClose={() => setProfileModalOpen(false)}
        onSubmit={submitProfile}
        t={t}
      />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} t={t} />
    </div>
  );
}

export default App;
