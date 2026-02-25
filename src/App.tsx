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
  aurora: {
    label: { zh: "极光", en: "Aurora" },
    vars: {
      "--app-bg-gradient":
        "radial-gradient(circle at 10% 20%, #283a51, transparent 40%), radial-gradient(circle at 85% 0%, #2f1f4b, transparent 35%), linear-gradient(140deg, #0b0f14 0%, #141b24 55%, #10151f 100%)",
      "--app-bg-image": "none",
      "--app-bg-base": "#0b0f14",
      "--text-primary": "#ecf3ff",
      "--text-secondary": "#cbd6e8",
      "--text-muted": "#8fa7c8",
      "--text-soft": "#9bb0cc",
      "--text-quiet": "#7f95b6",
      "--accent": "#f8d254",
      "--accent-strong": "#f8d254",
      "--accent-contrast": "#1b1f28",
      "--accent-soft": "rgba(248, 210, 84, 0.6)",
      "--accent-subtle": "rgba(248, 210, 84, 0.18)",
      "--surface": "rgba(13, 20, 29, 0.86)",
      "--surface-strong": "rgba(11, 17, 23, 0.92)",
      "--surface-alt": "rgba(19, 27, 40, 0.8)",
      "--surface-header": "rgba(20, 30, 44, 0.8)",
      "--surface-header-strong": "rgba(24, 34, 48, 0.8)",
      "--surface-menu": "rgba(12, 18, 27, 0.98)",
      "--border-weak": "rgba(255, 255, 255, 0.08)",
      "--border-soft": "rgba(255, 255, 255, 0.06)",
      "--border-input": "rgba(255, 255, 255, 0.12)",
      "--button-bg": "rgba(32, 44, 61, 0.6)",
      "--button-bg-strong": "rgba(32, 44, 61, 0.8)",
      "--button-text": "#cbd6e8",
      "--input-bg": "rgba(12, 19, 29, 0.9)",
      "--input-text": "#eef4ff",
      "--tab-bg": "rgba(15, 23, 34, 0.8)",
      "--tab-border": "rgba(255, 255, 255, 0.12)",
      "--success": "#7affa2",
      "--success-soft": "rgba(122, 255, 162, 0.3)",
      "--danger": "#ff9a9a",
      "--resizer-bg": "rgba(255, 255, 255, 0.04)",
      "--progress-gradient": "linear-gradient(120deg, #7affa2, #f8d254)",
      "--shadow-strong": "0 16px 32px rgba(0, 0, 0, 0.35)",
      "--brand-glow": "0 0 12px rgba(248, 210, 84, 0.6)",
    },
    terminal: {
      background: "#0b1117",
      foreground: "#d6e1f2",
      selectionBackground: "#2c3e57",
      cursor: "#f8d254",
    },
  },
  sahara: {
    label: { zh: "沙丘", en: "Sahara" },
    vars: {
      "--app-bg-gradient":
        "radial-gradient(circle at 12% 18%, rgba(122, 92, 50, 0.35), transparent 45%), radial-gradient(circle at 90% 0%, rgba(86, 54, 24, 0.5), transparent 45%), linear-gradient(140deg, #15110c 0%, #1f1911 55%, #15110c 100%)",
      "--app-bg-image": "none",
      "--app-bg-base": "#15110c",
      "--text-primary": "#f7f1e7",
      "--text-secondary": "#e2d6c3",
      "--text-muted": "#c0ab8f",
      "--text-soft": "#b49c7f",
      "--text-quiet": "#9c856d",
      "--accent": "#e1a85a",
      "--accent-strong": "#f0c27a",
      "--accent-contrast": "#2a1f14",
      "--accent-soft": "rgba(225, 168, 90, 0.6)",
      "--accent-subtle": "rgba(225, 168, 90, 0.18)",
      "--surface": "rgba(26, 20, 14, 0.88)",
      "--surface-strong": "rgba(22, 17, 12, 0.94)",
      "--surface-alt": "rgba(33, 25, 17, 0.85)",
      "--surface-header": "rgba(36, 28, 20, 0.85)",
      "--surface-header-strong": "rgba(40, 31, 22, 0.85)",
      "--surface-menu": "rgba(22, 17, 12, 0.98)",
      "--border-weak": "rgba(255, 255, 255, 0.1)",
      "--border-soft": "rgba(255, 255, 255, 0.08)",
      "--border-input": "rgba(255, 255, 255, 0.16)",
      "--button-bg": "rgba(56, 40, 24, 0.6)",
      "--button-bg-strong": "rgba(56, 40, 24, 0.8)",
      "--button-text": "#f0e4d2",
      "--input-bg": "rgba(22, 17, 12, 0.9)",
      "--input-text": "#f7f1e7",
      "--tab-bg": "rgba(28, 21, 14, 0.85)",
      "--tab-border": "rgba(255, 255, 255, 0.14)",
      "--success": "#a5e8c4",
      "--success-soft": "rgba(165, 232, 196, 0.3)",
      "--danger": "#f4a4a0",
      "--resizer-bg": "rgba(255, 255, 255, 0.05)",
      "--progress-gradient": "linear-gradient(120deg, #a5e8c4, #e1a85a)",
      "--shadow-strong": "0 16px 32px rgba(0, 0, 0, 0.4)",
      "--brand-glow": "0 0 12px rgba(225, 168, 90, 0.55)",
    },
    terminal: {
      background: "#15110c",
      foreground: "#f0e7dc",
      selectionBackground: "#3c2d1d",
      cursor: "#e1a85a",
    },
  },
  dawn: {
    label: { zh: "拂晓", en: "Dawn" },
    vars: {
      "--app-bg-gradient":
        "radial-gradient(circle at 12% 18%, rgba(255, 217, 166, 0.7), transparent 45%), radial-gradient(circle at 90% 0%, rgba(179, 214, 255, 0.65), transparent 45%), linear-gradient(140deg, #f7f2e8 0%, #f2f6ff 55%, #f6f1e7 100%)",
      "--app-bg-image": "none",
      "--app-bg-base": "#f7f2e8",
      "--text-primary": "#1f2430",
      "--text-secondary": "#2b3446",
      "--text-muted": "#5b6476",
      "--text-soft": "#657187",
      "--text-quiet": "#7a8599",
      "--accent": "#d18a3d",
      "--accent-strong": "#c97a28",
      "--accent-contrast": "#fff7ea",
      "--accent-soft": "rgba(209, 138, 61, 0.5)",
      "--accent-subtle": "rgba(209, 138, 61, 0.18)",
      "--surface": "rgba(255, 255, 255, 0.86)",
      "--surface-strong": "rgba(255, 255, 255, 0.94)",
      "--surface-alt": "rgba(246, 240, 231, 0.9)",
      "--surface-header": "rgba(255, 255, 255, 0.9)",
      "--surface-header-strong": "rgba(255, 255, 255, 0.96)",
      "--surface-menu": "rgba(255, 255, 255, 0.98)",
      "--border-weak": "rgba(31, 36, 48, 0.08)",
      "--border-soft": "rgba(31, 36, 48, 0.06)",
      "--border-input": "rgba(31, 36, 48, 0.12)",
      "--button-bg": "rgba(255, 255, 255, 0.7)",
      "--button-bg-strong": "rgba(255, 255, 255, 0.9)",
      "--button-text": "#2b3446",
      "--input-bg": "rgba(255, 255, 255, 0.9)",
      "--input-text": "#1f2430",
      "--tab-bg": "rgba(255, 255, 255, 0.9)",
      "--tab-border": "rgba(31, 36, 48, 0.12)",
      "--success": "#3e8f6b",
      "--success-soft": "rgba(62, 143, 107, 0.3)",
      "--danger": "#d1645a",
      "--resizer-bg": "rgba(31, 36, 48, 0.05)",
      "--progress-gradient": "linear-gradient(120deg, #3e8f6b, #d18a3d)",
      "--shadow-strong": "0 16px 32px rgba(31, 36, 48, 0.18)",
      "--brand-glow": "0 0 12px rgba(209, 138, 61, 0.45)",
    },
    terminal: {
      background: "#f8f4ec",
      foreground: "#1f2430",
      selectionBackground: "#e5d6bf",
      cursor: "#d18a3d",
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
    defaultThemeId: "aurora",
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
