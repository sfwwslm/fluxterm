/**
 * 应用编排层。
 * 职责：聚合 settings/profiles/layout/session/terminal/sftp 等领域能力并组装主界面。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import "@/App.css";
import { translations, type Translate, type TranslationKey } from "@/i18n";
import ConfigModal, {
  type ConfigSectionItem,
  type ConfigSectionKey,
} from "@/components/layout/ConfigModal";
import TitleBar from "@/components/layout/TitleBar";
import FloatingShell from "@/components/app/FloatingShell";
import Workspace from "@/components/app/Workspace";
import BottomArea from "@/components/app/BottomArea";
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
import useQuickBarState from "@/hooks/useQuickBarState";
import { allPanelKeys, moveWidgetToSlot } from "@/layout/model";
import type { WidgetSlot as LayoutWidgetSlot } from "@/layout/types";
import type { HostProfile, PanelKey, ThemeId } from "@/types";
import { isMacOS } from "@/utils/platform";
import useSessionController from "@/features/session/hooks/useSessionController";
import useTerminalController from "@/features/terminal/hooks/useTerminalController";
import useSftpController from "@/features/sftp/hooks/useSftpController";
import { themePresets } from "@/app/theme/themePresets";
import { buildPanels } from "@/app/panels/buildPanels";
import {
  FLOATING_FILES_CHANNEL,
  type FloatingFilesMessage,
  type FloatingFilesSnapshot,
} from "@/features/sftp/core/floatingSync";

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

/** 将快捷命令中的常见转义序列还原为真实控制字符。 */
function decodeQuickCommandEscapes(input: string) {
  let output = "";
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char !== "\\") {
      output += char;
      continue;
    }
    const next = input[i + 1];
    if (next === "n") {
      output += "\n";
      i += 1;
      continue;
    }
    if (next === "r") {
      output += "\r";
      i += 1;
      continue;
    }
    if (next === "t") {
      output += "\t";
      i += 1;
      continue;
    }
    if (next === "\\") {
      output += "\\";
      i += 1;
      continue;
    }
    output += char;
  }
  return output;
}

/** 统一终端提交符，避免 LF 在部分 shell 中触发续行而不执行。 */
function normalizeQuickCommandForSubmit(input: string) {
  // 在终端交互里，提交命令应使用 CR。将用户写的 LF/CRLF 统一折叠为 CR。
  return input.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
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
  const [quickbarManagerOpen, setQuickbarManagerOpen] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [activeConfigSection, setActiveConfigSection] =
    useState<ConfigSectionKey>("app-settings");
  const [configModalSections, setConfigModalSections] = useState<
    ConfigSectionItem[]
  >([{ key: "app-settings", label: "" }]);
  const [footerVisibility, setFooterVisibility] = useState({
    quickbar: true,
    statusbar: true,
  });
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
  const lastSftpProgressRef = useRef<Record<string, number>>({});
  const lastSftpTransferKeyRef = useRef<Record<string, string>>({});
  const [floatingFilesSnapshot, setFloatingFilesSnapshot] =
    useState<FloatingFilesSnapshot | null>(null);

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

  const configSectionLabels = useMemo(
    () => ({
      "app-settings": t("config.section.appSettings"),
      "session-settings": t("config.section.sessionSettings"),
      "config-directory": t("config.section.configDirectory"),
    }),
    [t],
  );

  /** 打开统一配置模态框，并切换到指定配置分区。 */
  function openConfigSection(section: ConfigSectionKey) {
    // 每个顶部二级菜单只携带自己所属的配置分组，避免共享一个总导航。
    const sectionsByEntry: Record<ConfigSectionKey, ConfigSectionItem[]> = {
      "app-settings": [
        {
          key: "app-settings",
          label: configSectionLabels["app-settings"],
        },
      ],
      "session-settings": [
        {
          key: "session-settings",
          label: configSectionLabels["session-settings"],
        },
      ],
      "config-directory": [
        {
          key: "config-directory",
          label: configSectionLabels["config-directory"],
        },
      ],
    };
    setConfigModalSections(sectionsByEntry[section]);
    setActiveConfigSection(section);
    setConfigModalOpen(true);
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
    // TODO: 后续改为从用户设置读取 scrollback，而不是硬编码默认值。
    scrollback: 3000,
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
    refreshList,
    openRemoteDir,
    uploadFile,
    downloadFile,
    createFolder,
    rename: renameEntry,
    remove: removeEntry,
  } = sftpActions;

  const isFloatingFilesPanel = floatingPanelKey === "files";

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(FLOATING_FILES_CHANNEL);

    if (!floatingPanelKey) {
      // 主窗口维护真实文件状态，并向浮动文件面板广播当前快照；
      // 同时消费浮动窗口发回的文件操作请求。
      const broadcastSnapshot = () => {
        const payload: FloatingFilesSnapshot = {
          activeSessionId: sessionState.activeSessionId,
          isRemoteSession: sessionState.isRemoteSession,
          isRemoteConnected: sessionState.isRemoteConnected,
          currentPath: sftpState.currentPath,
          entries: sftpState.entries,
        };
        channel.postMessage({
          type: "files:snapshot",
          payload,
        } satisfies FloatingFilesMessage);
      };

      broadcastSnapshot();

      channel.onmessage = (event) => {
        const message = event.data as FloatingFilesMessage | undefined;
        if (!message) return;
        switch (message.type) {
          case "files:request-snapshot":
            broadcastSnapshot();
            break;
          case "files:refresh":
            refreshList(message.path).catch(() => {});
            break;
          case "files:open":
            openRemoteDir(message.path).catch(() => {});
            break;
          case "files:upload":
            uploadFile().catch(() => {});
            break;
          case "files:download":
            downloadFile(message.entry).catch(() => {});
            break;
          case "files:mkdir":
            createFolder(message.name).catch(() => {});
            break;
          case "files:rename":
            renameEntry(message.entry, message.name).catch(() => {});
            break;
          case "files:remove":
            removeEntry(message.entry).catch(() => {});
            break;
          case "files:snapshot":
            break;
        }
      };
      return () => {
        channel.close();
      };
    }

    if (isFloatingFilesPanel) {
      // 浮动文件面板不直接维护会话级 SFTP 状态，而是请求主窗口发送当前快照。
      channel.onmessage = (event) => {
        const message = event.data as FloatingFilesMessage | undefined;
        if (message?.type === "files:snapshot") {
          setFloatingFilesSnapshot(message.payload);
        }
      };
      channel.postMessage({
        type: "files:request-snapshot",
      } satisfies FloatingFilesMessage);
      return () => {
        channel.close();
      };
    }

    channel.close();
    return undefined;
  }, [
    floatingPanelKey,
    isFloatingFilesPanel,
    sessionState.activeSessionId,
    sessionState.isRemoteConnected,
    sessionState.isRemoteSession,
    createFolder,
    downloadFile,
    sftpState.currentPath,
    sftpState.entries,
    openRemoteDir,
    refreshList,
    removeEntry,
    renameEntry,
    uploadFile,
  ]);

  const {
    showGroupTitle,
    setShowGroupTitle,
    groups: quickbarGroups,
    commands: quickbarCommands,
    addGroup: addQuickbarGroup,
    renameGroup: renameQuickbarGroup,
    removeGroup: removeQuickbarGroup,
    toggleGroupVisible: toggleQuickbarGroupVisible,
    addCommand: addQuickbarCommand,
    updateCommand: updateQuickbarCommand,
    removeCommand: removeQuickbarCommand,
  } = useQuickBarState(t);

  const {
    layoutCollapsed,
    sideSlotCounts,
    slotGroups,
    leftVisible,
    rightVisible,
    bottomVisible,
    layoutVars,
    setSlotGroups,
    setPanelCollapsed,
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
    footerVisibility,
    onToggleFooterPart: (part) =>
      setFooterVisibility((prev) => ({ ...prev, [part]: !prev[part] })),
    setLocale,
    setThemeId,
    setShellId,
    onOpenAbout: () => setAboutOpen(true),
    t,
  });

  function handleRunQuickCommand(command: string) {
    // 无活动会话时不发送，给出短暂提示避免误操作。
    const sessionId = sessionState.activeSessionId;
    if (!sessionId) {
      sessionActions.setBusyMessage(t("quickbar.noSession"));
      window.setTimeout(() => {
        sessionActions.setBusyMessage((prev) =>
          prev === t("quickbar.noSession") ? null : prev,
        );
      }, 1500);
      return;
    }
    // 先聚焦终端，确保后续键盘输入（如回车）进入终端而非停留在按钮焦点上。
    terminalActions.focusActiveTerminal();
    const parsed = decodeQuickCommandEscapes(command);
    const normalized = normalizeQuickCommandForSubmit(parsed);
    sessionActions.writeToSession(sessionId, normalized).catch(() => {});
  }

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

  const floatingFilesChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined" || !isFloatingFilesPanel) {
      floatingFilesChannelRef.current?.close();
      floatingFilesChannelRef.current = null;
      return;
    }
    const channel = new BroadcastChannel(FLOATING_FILES_CHANNEL);
    floatingFilesChannelRef.current = channel;
    return () => {
      if (floatingFilesChannelRef.current === channel) {
        floatingFilesChannelRef.current = null;
      }
      channel.close();
    };
  }, [isFloatingFilesPanel]);

  function postFloatingFilesMessage(message: FloatingFilesMessage) {
    floatingFilesChannelRef.current?.postMessage(message);
  }

  // 主窗口直接读取本地 SFTP 状态；浮动文件面板则消费主窗口同步过来的只读快照。
  const filesPanelState = useMemo(
    () =>
      isFloatingFilesPanel
        ? {
            isRemoteSession: floatingFilesSnapshot?.isRemoteSession ?? false,
            isRemoteConnected:
              floatingFilesSnapshot?.isRemoteConnected ?? false,
            currentPath: floatingFilesSnapshot?.currentPath ?? "",
            entries: floatingFilesSnapshot?.entries ?? [],
          }
        : {
            isRemoteSession: sessionState.isRemoteSession,
            isRemoteConnected: sessionState.isRemoteConnected,
            currentPath: sftpState.currentPath,
            entries: sftpState.entries,
          },
    [
      floatingFilesSnapshot,
      isFloatingFilesPanel,
      sessionState.isRemoteConnected,
      sessionState.isRemoteSession,
      sftpState.currentPath,
      sftpState.entries,
    ],
  );

  // 主窗口直接调用 SFTP action；浮动文件面板通过消息把操作代理回主窗口执行。
  const filesPanelActions = useMemo(
    () =>
      isFloatingFilesPanel
        ? {
            refreshList: async (path?: string) => {
              postFloatingFilesMessage({ type: "files:refresh", path });
            },
            openRemoteDir: async (path: string) => {
              postFloatingFilesMessage({ type: "files:open", path });
            },
            uploadFile: async () => {
              postFloatingFilesMessage({ type: "files:upload" });
            },
            downloadFile: async (
              entry: (typeof filesPanelState.entries)[number],
            ) => {
              postFloatingFilesMessage({ type: "files:download", entry });
            },
            createFolder: async (name: string) => {
              postFloatingFilesMessage({ type: "files:mkdir", name });
            },
            rename: async (
              entry: (typeof filesPanelState.entries)[number],
              name: string,
            ) => {
              postFloatingFilesMessage({ type: "files:rename", entry, name });
            },
            remove: async (entry: (typeof filesPanelState.entries)[number]) => {
              postFloatingFilesMessage({ type: "files:remove", entry });
            },
          }
        : {
            refreshList,
            openRemoteDir,
            uploadFile,
            downloadFile,
            createFolder,
            rename: renameEntry,
            remove: removeEntry,
          },
    [
      createFolder,
      downloadFile,
      filesPanelState.entries,
      isFloatingFilesPanel,
      openRemoteDir,
      refreshList,
      removeEntry,
      renameEntry,
      uploadFile,
    ],
  );

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
        isRemoteSession: filesPanelState.isRemoteSession,
        isRemoteConnected: filesPanelState.isRemoteConnected,
        progressBySession: sftpState.progressBySession,
        busyMessage: sessionState.busyMessage,
        logEntries: sessionState.logEntries,
        currentPath: filesPanelState.currentPath,
        entries: filesPanelState.entries,
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
        onRefreshList: filesPanelActions.refreshList,
        onOpenRemoteDir: filesPanelActions.openRemoteDir,
        onUploadFile: filesPanelActions.uploadFile,
        onDownloadFile: filesPanelActions.downloadFile,
        onCreateFolder: filesPanelActions.createFolder,
        onRenameEntry: filesPanelActions.rename,
        onRemoveEntry: filesPanelActions.remove,
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
      filesPanelState.isRemoteSession,
      filesPanelState.isRemoteConnected,
      sftpState.progressBySession,
      sessionState.busyMessage,
      sessionState.logEntries,
      filesPanelState.currentPath,
      filesPanelState.entries,
      locale,
      sessionState.canReconnect,
      t,
      pickProfile,
      addGroup,
      renameGroup,
      removeGroup,
      moveProfileToGroup,
      filesPanelActions,
    ],
  );

  // 当检测到新的 SFTP 上传/下载开始时，主动把底部区域展开并切到传输面板，
  // 避免用户在底部收起或停留在其他面板时感知不到传输开始。
  // 这里仅在“新传输”开始时触发一次，不会在每次进度刷新时重复切换，也不会在传输结束后自动恢复原状态。
  useEffect(() => {
    if (floatingPanelKey) return;

    let shouldRevealTransfers = false;
    Object.values(sftpState.progressBySession).forEach((progress) => {
      const transferKey = `${progress.op}:${progress.path}`;
      const previousTransferred =
        lastSftpProgressRef.current[progress.sessionId];
      const previousTransferKey =
        lastSftpTransferKeyRef.current[progress.sessionId];

      const isNewTransfer =
        previousTransferred === undefined ||
        previousTransferKey !== transferKey ||
        progress.transferred < previousTransferred;

      if (isNewTransfer) {
        shouldRevealTransfers = true;
      }

      lastSftpProgressRef.current[progress.sessionId] = progress.transferred;
      lastSftpTransferKeyRef.current[progress.sessionId] = transferKey;
    });

    if (!shouldRevealTransfers) return;

    setPanelCollapsed("bottom", false);
    setSlotGroups((prev) => {
      const bottomGroup = prev.bottom;
      if (!bottomGroup) return prev;
      if (!bottomGroup.widgets.includes("transfers")) return prev;
      if (bottomGroup.active === "transfers") return prev;
      return {
        ...prev,
        bottom: {
          ...bottomGroup,
          active: "transfers",
        },
      };
    });
  }, [
    floatingPanelKey,
    sftpState.progressBySession,
    setPanelCollapsed,
    setSlotGroups,
  ]);

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
          onOpenConfigSection={openConfigSection}
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
              onOpenConfigSection={openConfigSection}
              layoutCollapsed={layoutCollapsed}
              onToggleCollapsed={handleToggleCollapsed}
              onOpenAbout={() => setAboutOpen(true)}
              footerVisibility={footerVisibility}
              onToggleFooterPart={(part) =>
                setFooterVisibility((prev) => ({
                  ...prev,
                  [part]: !prev[part],
                }))
              }
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
                activeLinkMenu={terminalQuery.getActiveLinkMenu()}
                hasActiveSelection={terminalQuery.hasActiveSelection}
                onCopySelection={terminalActions.copyActiveSelection}
                onOpenLink={terminalActions.openActiveLink}
                onCopyLink={terminalActions.copyActiveLink}
                onCloseLinkMenu={terminalActions.closeActiveLinkMenu}
                onPaste={terminalActions.pasteToActiveTerminal}
                onClear={terminalActions.clearActiveTerminal}
                onSearchNext={terminalActions.searchActiveTerminalNext}
                onSearchPrev={terminalActions.searchActiveTerminalPrev}
                onSearchClear={terminalActions.clearActiveSearchDecorations}
                searchResultStats={terminalQuery.getActiveSearchStats()}
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

          <BottomArea
            visibility={footerVisibility}
            managerOpen={quickbarManagerOpen}
            onOpenManager={() => setQuickbarManagerOpen(true)}
            showGroupTitle={showGroupTitle}
            groups={quickbarGroups}
            commands={quickbarCommands}
            onCloseManager={() => setQuickbarManagerOpen(false)}
            onAddGroup={addQuickbarGroup}
            onRenameGroup={renameQuickbarGroup}
            onRemoveGroup={removeQuickbarGroup}
            onToggleGroupVisible={toggleQuickbarGroupVisible}
            onAddCommand={addQuickbarCommand}
            onUpdateCommand={updateQuickbarCommand}
            onRemoveCommand={removeQuickbarCommand}
            onShowGroupTitleChange={setShowGroupTitle}
            onRunCommand={handleRunQuickCommand}
            getActiveTerminalStats={terminalQuery.getActiveTerminalStats}
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
      <ConfigModal
        open={configModalOpen}
        activeSection={activeConfigSection}
        sections={configModalSections}
        onClose={() => setConfigModalOpen(false)}
        onSectionChange={setActiveConfigSection}
        t={t}
      />
      <NoticeHost />
    </>
  );
}
