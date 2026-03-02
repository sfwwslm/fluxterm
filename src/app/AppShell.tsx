/**
 * 应用编排层。
 * 职责：聚合 settings/profiles/layout/session/terminal/sftp 等领域能力并组装主界面。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import "@/App.css";
import { info, warn } from "@tauri-apps/plugin-log";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
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
import useSessionSettings from "@/hooks/settings/useSessionSettings";
import useLayoutState from "@/hooks/useLayoutState";
import useFloatingPanels from "@/hooks/useFloatingPanels";
import useMacAppMenu from "@/hooks/useMacAppMenu";
import useQuickBarState from "@/hooks/useQuickBarState";
import { moveWidgetToSlot, panelKeys } from "@/layout/model";
import type { WidgetSlot as LayoutWidgetSlot } from "@/layout/types";
import type {
  HostProfile,
  PanelKey,
  SessionResourceSnapshot,
  ThemeId,
} from "@/types";
import { isMacOS } from "@/utils/platform";
import useSessionController from "@/features/session/hooks/useSessionController";
import useTerminalController from "@/features/terminal/hooks/useTerminalController";
import useSftpController from "@/features/sftp/hooks/useSftpController";
import { MIN_RESOURCE_MONITOR_INTERVAL_SEC } from "@/hooks/settings/useSessionSettings";
import {
  startLocalResourceMonitor,
  startSshResourceMonitor,
  stopResourceMonitor,
} from "@/features/resource/core/commands";
import { themePresets } from "@/app/theme/themePresets";
import { buildPanels } from "@/app/panels/buildPanels";
import {
  FLOATING_FILES_CHANNEL,
  type FloatingFilesMessage,
  type FloatingFilesSnapshot,
} from "@/features/sftp/core/floatingSync";
import {
  openLocalFile,
  openRemoteFileViaCache,
} from "@/features/file-open/core/commands";
import { subscribeTauri } from "@/shared/tauri/events";

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

function resolvePromptWorkingDirectory(
  rawPath: string,
  homePath: string | null,
) {
  // 终端层只会上报 prompt 里看得到的路径字面量。
  // 这里负责把 `/abs/path` 或 `~` / `~/subdir` 还原成 SFTP 可以直接打开的绝对路径。
  if (rawPath.startsWith("/")) return rawPath;
  if (!rawPath.startsWith("~") || !homePath) return null;
  if (rawPath === "~") return homePath;
  return `${homePath.replace(/\/+$/, "")}/${rawPath.slice(2)}`;
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
    sftpEnabled,
    setSftpEnabled,
    fileDefaultEditorPath,
    setFileDefaultEditorPath,
    availableShells,
    settingsLoaded,
  } = useAppSettings({
    themeIds,
    defaultThemeId: "dark",
  });
  // 会话设置属于终端域全局配置，统一写入 session.json 并作用于所有终端会话。
  const {
    webLinksEnabled,
    selectionAutoCopyEnabled,
    scrollback,
    terminalPathSyncEnabled,
    resourceMonitorEnabled,
    resourceMonitorIntervalSec,
    setWebLinksEnabled,
    setSelectionAutoCopyEnabled,
    setScrollback,
    setTerminalPathSyncEnabled,
    setResourceMonitorEnabled,
    setResourceMonitorIntervalSec,
  } = useSessionSettings();
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
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });
  const lastSftpTransferIdRef = useRef<Record<string, string>>({});
  const activeResourceMonitorSessionIdRef = useRef<string | null>(null);
  const activeResourceMonitorKeyRef = useRef("");
  const [floatingFilesSnapshot, setFloatingFilesSnapshot] =
    useState<FloatingFilesSnapshot | null>(null);
  const [resourceSnapshotsBySession, setResourceSnapshotsBySession] = useState<
    Record<string, SessionResourceSnapshot>
  >({});
  const [terminalWorkingDirs, setTerminalWorkingDirs] = useState<
    Record<string, { username: string | null; path: string }>
  >({});
  const [terminalHomeDirs, setTerminalHomeDirs] = useState<
    Record<string, string>
  >({});
  const [lastSyncedTerminalPaths, setLastSyncedTerminalPaths] = useState<
    Record<string, string>
  >({});
  const [terminalPathSyncStateBySession, setTerminalPathSyncStateBySession] =
    useState<Record<string, "active" | "paused-mismatch" | "unsupported">>({});

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
    webLinksEnabled,
    selectionAutoCopyEnabled,
    scrollback,
    activeSessionId: sessionState.activeSessionId,
    activeSession: sessionState.activeSession,
    sessions: sessionState.sessions,
    sessionStatesRef: sessionRefs.sessionStatesRef,
    sessionReasonsRef: sessionRefs.sessionReasonsRef,
    sessionBuffersRef: sessionRefs.sessionBuffersRef,
    recordCommandInput: sessionActions.recordCommandInput,
    writeToSession: sessionActions.writeToSession,
    resizeSession: sessionActions.resizeSession,
    onWorkingDirectoryChange: (sessionId, payload) => {
      setTerminalWorkingDirs((prev) =>
        prev[sessionId]?.path === payload.path &&
        prev[sessionId]?.username === payload.username
          ? prev
          : { ...prev, [sessionId]: payload },
      );
    },
    onPathSyncSupportChange: (sessionId, status) => {
      setTerminalPathSyncStateBySession((prev) => {
        const nextState = status === "unsupported" ? "unsupported" : "active";
        if (prev[sessionId] === nextState) return prev;
        return { ...prev, [sessionId]: nextState };
      });
    },
    isLocalSession: sessionActions.isLocalSession,
    reconnectSession: sessionActions.reconnectSession,
    reconnectLocalShell: sessionActions.reconnectLocalShell,
    onSizeChange: (size) => {
      terminalSizeRef.current = size;
    },
  });

  useEffect(() => {
    const activeSessionId = sessionState.activeSessionId;
    if (!activeSessionId) return;
    // 新会话先走保守默认值，只有真正解析到受支持的 bash prompt 后才提升为 active，
    // 避免 zsh / 不支持场景在首屏短暂闪成绿色。
    setTerminalPathSyncStateBySession((prev) =>
      prev[activeSessionId]
        ? prev
        : { ...prev, [activeSessionId]: "unsupported" },
    );
  }, [sessionState.activeSessionId]);

  const isFloatingFilesPanel = floatingPanelKey === "files";

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
    floatingOrigins,
    leftVisible,
    rightVisible,
    bottomVisible,
    layoutVars,
    setSlotGroups,
    setFloatingOrigins,
    setPanelCollapsed,
    handleToggleSplit,
    handleCloseSlot,
    handleToggleCollapsed,
    startResize,
  } = useLayoutState({
    floatingPanelKey,
  });
  const { floatingPanels, handleFloat } = useFloatingPanels({
    floatingPanelKey,
    floatingOrigins,
    setFloatingOrigins,
    slotGroups,
    setSlotGroups,
    panelLabels,
    layoutCollapsed,
    locale,
    themeId,
    setLocale,
    setThemeId,
  });

  function isMainSlotVisible(slot: LayoutWidgetSlot) {
    if (slot === "bottom") return !layoutCollapsed.bottom;
    return slot.startsWith("left:")
      ? !layoutCollapsed.left
      : !layoutCollapsed.right;
  }

  const availableWidgets = useMemo(() => {
    // 主窗口里只有“当前真正可见”的组件才占用实例；
    // 收起区域虽然保留布局配置，但不应阻止其他可见区域再次添加该组件。
    // floating 中的组件仍然是独立可见实例，因此始终占用。
    const occupied = new Set<PanelKey>();
    Object.entries(slotGroups).forEach(([slot, group]) => {
      if (!isMainSlotVisible(slot as LayoutWidgetSlot)) return;
      if (group.active) occupied.add(group.active);
    });
    Object.keys(floatingOrigins).forEach((panel) => {
      occupied.add(panel as PanelKey);
    });
    return panelKeys.filter((panel) => !occupied.has(panel));
  }, [
    floatingOrigins,
    layoutCollapsed.bottom,
    layoutCollapsed.left,
    layoutCollapsed.right,
    slotGroups,
  ]);
  const filesWidgetVisible = useMemo(() => {
    if (floatingPanelKey === "files") return true;
    if (floatingPanels.files) return true;
    return Object.entries(slotGroups).some(
      ([slot, group]) =>
        isMainSlotVisible(slot as LayoutWidgetSlot) && group.active === "files",
    );
  }, [
    floatingPanelKey,
    floatingPanels.files,
    layoutCollapsed.bottom,
    layoutCollapsed.left,
    layoutCollapsed.right,
    slotGroups,
  ]);

  const { sftpState, sftpActions } = useSftpController({
    enabled: sftpEnabled,
    active: filesWidgetVisible,
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
    cancelTransfer,
    createFolder,
    rename: renameEntry,
    remove: removeEntry,
  } = sftpActions;
  const activeSftpAvailability = useMemo(() => {
    const activeSessionId = sessionState.activeSessionId;
    if (!activeSessionId) return "ready";
    if (sessionActions.isLocalSession(activeSessionId)) return "ready";
    if (!sftpEnabled || !filesWidgetVisible) return "disabled";
    return sftpState.availabilityBySession[activeSessionId] ?? "checking";
  }, [
    sessionActions,
    sessionState.activeSessionId,
    filesWidgetVisible,
    sftpEnabled,
    sftpState.availabilityBySession,
  ]);
  const activeTerminalPathSyncStatus = useMemo<
    "active" | "paused" | "checking" | "unsupported" | "disabled"
  >(() => {
    const activeSessionId = sessionState.activeSessionId;
    // 图标状态优先表达“用户主动关闭”与“当前会话天然不支持”的区别，
    // 避免本地 shell / zsh 这类场景被误显示成绿色联动中。
    if (!terminalPathSyncEnabled || !sftpEnabled || !filesWidgetVisible) {
      return "disabled";
    }
    if (!activeSessionId) return "unsupported";
    if (sessionActions.isLocalSession(activeSessionId)) return "unsupported";
    const pathSyncState = terminalPathSyncStateBySession[activeSessionId];
    // `checking` 只用于首轮能力检测。
    // 一旦该会话已经进入过 active，就不要再因为普通目录刷新时的 SFTP checking
    // 把联动图标打回“检测中”，否则用户会看到路径切换时图标抖动。
    if (
      activeSftpAvailability === "checking" &&
      pathSyncState !== "active" &&
      pathSyncState !== "paused-mismatch"
    ) {
      return "checking";
    }
    if (activeSftpAvailability === "unsupported") return "unsupported";
    if (pathSyncState === "unsupported") {
      return "unsupported";
    }
    return pathSyncState === "paused-mismatch"
      ? "paused"
      : pathSyncState === "active"
        ? "active"
        : "unsupported";
  }, [
    sessionActions,
    sessionState.activeSessionId,
    activeSftpAvailability,
    filesWidgetVisible,
    sftpEnabled,
    terminalPathSyncEnabled,
    terminalPathSyncStateBySession,
  ]);

  const activeResourceSnapshot = useMemo(() => {
    const activeSessionId = sessionState.activeSessionId;
    if (!activeSessionId) return null;
    if (sessionState.activeSessionState !== "connected") return null;
    return resourceSnapshotsBySession[activeSessionId] ?? null;
  }, [
    resourceSnapshotsBySession,
    sessionState.activeSessionId,
    sessionState.activeSessionState,
  ]);
  const activeResourceMonitorStatus = useMemo<
    "disabled" | "checking" | "ready" | "unsupported"
  >(() => {
    if (!resourceMonitorEnabled) return "disabled";
    const activeSessionId = sessionState.activeSessionId;
    if (!activeSessionId) return "checking";
    if (sessionState.activeSessionState !== "connected") return "checking";
    const snapshot = resourceSnapshotsBySession[activeSessionId];
    if (!snapshot) return "checking";
    if (snapshot.status === "ready" && snapshot.cpu && snapshot.memory) {
      return "ready";
    }
    return snapshot.status;
  }, [
    resourceMonitorEnabled,
    resourceSnapshotsBySession,
    sessionState.activeSessionId,
    sessionState.activeSessionState,
  ]);

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | null = null;

    const registerResourceListener = async () => {
      const unlisten = await subscribeTauri<SessionResourceSnapshot>(
        "session:resource",
        (event) => {
          if (cancelled) return;
          setResourceSnapshotsBySession((prev) => ({
            ...prev,
            [event.payload.sessionId]: event.payload,
          }));
        },
      );
      if (cancelled) {
        unlisten();
        return;
      }
      teardown = unlisten;
    };

    registerResourceListener().catch(() => {});
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  useEffect(() => {
    const activeSessionId = sessionState.activeSessionId;
    const normalizedInterval = Math.max(
      MIN_RESOURCE_MONITOR_INTERVAL_SEC,
      resourceMonitorIntervalSec,
    );
    const isLocalActiveSession =
      !!activeSessionId && sessionActions.isLocalSession(activeSessionId);
    const desiredMonitorKey =
      resourceMonitorEnabled &&
      activeSessionId &&
      sessionState.activeSessionState === "connected" &&
      (isLocalActiveSession || sessionState.activeSessionProfile)
        ? [
            activeSessionId,
            isLocalActiveSession ? "local" : "ssh",
            sessionState.activeSessionProfile?.id ?? "local",
            normalizedInterval,
          ].join(":")
        : "";

    const stopMonitorById = async (sessionId: string | null) => {
      if (!sessionId) return;
      await stopResourceMonitor(sessionId).catch(() => {});
    };

    const syncMonitor = async () => {
      // 资源监控的启停只能跟随稳定的“会话 + 模式 + 间隔”键变化，
      // 不能依赖 controller 包装对象本身，否则 render 抖动会导致 start/stop 循环。
      if (activeResourceMonitorKeyRef.current === desiredMonitorKey) {
        return;
      }
      activeResourceMonitorKeyRef.current = desiredMonitorKey;

      const previousSessionId = activeResourceMonitorSessionIdRef.current;
      if (!desiredMonitorKey || !activeSessionId) {
        await stopMonitorById(previousSessionId);
        activeResourceMonitorSessionIdRef.current = null;
        return;
      }

      if (
        resourceSnapshotsBySession[activeSessionId]?.status === "unsupported"
      ) {
        await stopMonitorById(previousSessionId);
        activeResourceMonitorSessionIdRef.current = null;
        activeResourceMonitorKeyRef.current = `unsupported:${activeSessionId}`;
        return;
      }

      if (previousSessionId && previousSessionId !== activeSessionId) {
        await stopMonitorById(previousSessionId);
      }

      setResourceSnapshotsBySession((prev) => {
        const existing = prev[activeSessionId];
        if (existing?.status === "checking" || existing?.status === "ready") {
          return prev;
        }
        return {
          ...prev,
          [activeSessionId]: {
            sessionId: activeSessionId,
            sampledAt: Date.now(),
            source: isLocalActiveSession ? "local" : "ssh-linux",
            status: "checking",
            cpu: null,
            memory: null,
          },
        };
      });

      if (isLocalActiveSession) {
        await startLocalResourceMonitor(activeSessionId, normalizedInterval);
      } else if (sessionState.activeSessionProfile) {
        await startSshResourceMonitor(
          activeSessionId,
          sessionState.activeSessionProfile,
          normalizedInterval,
        );
      }

      activeResourceMonitorSessionIdRef.current = activeSessionId;
    };

    syncMonitor().catch(() => {});
  }, [
    resourceMonitorEnabled,
    resourceMonitorIntervalSec,
    resourceSnapshotsBySession,
    sessionState.activeSessionId,
    sessionState.activeSessionProfile,
    sessionState.activeSessionState,
    sessionActions.isLocalSession,
  ]);

  useEffect(() => {
    return () => {
      const sessionId = activeResourceMonitorSessionIdRef.current;
      if (!sessionId) return;
      stopResourceMonitor(sessionId).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const activeSessionId = sessionState.activeSessionId;
    if (!activeSessionId) return;
    if (!sessionState.isRemoteConnected) return;
    // 文件管理器组件不可见时，不应为了“潜在可联动”去隐式拉起 SFTP。
    // 因此路径联动和 SFTP 初始化共用同一个可见性前置条件。
    if (!terminalPathSyncEnabled || !sftpEnabled || !filesWidgetVisible) return;
    const tracked = terminalWorkingDirs[activeSessionId];
    if (!tracked) return;
    if (activeSftpAvailability === "unsupported") return;
    // 终端运行时已经判定该会话 prompt 不可稳定解析时，这里直接停止联动，
    // 不再尝试根据脏路径去驱动 SFTP。
    if (terminalPathSyncStateBySession[activeSessionId] === "unsupported") {
      return;
    }
    const sessionProfile = sessionState.activeSessionProfile;
    const loginUsername = sessionProfile?.username?.trim() || null;
    const promptUsername = tracked.username?.trim() || null;
    const syncState =
      terminalPathSyncStateBySession[activeSessionId] ?? "active";
    // 终端 prompt 用户一旦和 SSH 初始登录用户不一致，说明 shell 身份已经切换，
    // 此时再继续用原 SFTP 身份联动路径会产生错误的 home/权限语义，因此直接暂停联动。
    if (loginUsername && promptUsername && loginUsername !== promptUsername) {
      if (syncState !== "paused-mismatch") {
        setTerminalPathSyncStateBySession((prev) => ({
          ...prev,
          [activeSessionId]: "paused-mismatch",
        }));
        warn(
          JSON.stringify({
            event: "terminal:cwd-sync-paused-user-mismatch",
            sessionId: activeSessionId,
            loginUsername,
            promptUsername,
          }),
        );
      }
      return;
    }
    // 当 prompt 用户恢复成初始登录用户后，说明 shell 身份重新与 SFTP 身份对齐，
    // 此时自动恢复路径联动，不要求用户手动刷新或重新连接。
    if (syncState === "paused-mismatch") {
      setTerminalPathSyncStateBySession((prev) => ({
        ...prev,
        [activeSessionId]: "active",
      }));
      info(
        JSON.stringify({
          event: "terminal:cwd-sync-resumed-user-match",
          sessionId: activeSessionId,
          loginUsername,
          promptUsername,
        }),
      ).catch(() => {});
    }
    const trackedPath = tracked.path;
    // prompt 中的 `~` 只能表示“当前 shell 的 home 语义”，SFTP 无法直接访问它。
    // 这里复用当前会话已知的绝对路径来记住 home，并在后续把 `~` / `~/subdir` 展开为绝对路径。
    const knownHome =
      terminalHomeDirs[activeSessionId] ??
      (trackedPath === "~" && sftpState.currentPath.startsWith("/")
        ? sftpState.currentPath
        : null);
    if (
      trackedPath === "~" &&
      knownHome &&
      terminalHomeDirs[activeSessionId] !== knownHome
    ) {
      setTerminalHomeDirs((prev) => ({
        ...prev,
        [activeSessionId]: knownHome,
      }));
    }
    const resolvedPath = resolvePromptWorkingDirectory(trackedPath, knownHome);
    if (!resolvedPath) return;
    if (resolvedPath === sftpState.currentPath) {
      // 当文件管理器已经处于终端 cwd 时，记住这次已同步的终端路径。
      // 后续用户手动浏览目录时，只要终端 cwd 没变化，就不要再被这个旧路径覆盖回去。
      setLastSyncedTerminalPaths((prev) =>
        prev[activeSessionId] === resolvedPath
          ? prev
          : { ...prev, [activeSessionId]: resolvedPath },
      );
      return;
    }
    if (lastSyncedTerminalPaths[activeSessionId] === resolvedPath) return;
    // 终端 cwd 只在“路径发生新变化”时单向驱动文件管理器，
    // 避免文件管理器手动浏览后又被旧的终端路径持续覆盖。
    openRemoteDir(resolvedPath).catch((error) => {
      warn(
        JSON.stringify({
          event: "sftp:sync-terminal-path-failed",
          sessionId: activeSessionId,
          path: resolvedPath,
          rawPath: trackedPath,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    setLastSyncedTerminalPaths((prev) => ({
      ...prev,
      [activeSessionId]: resolvedPath,
    }));
  }, [
    lastSyncedTerminalPaths,
    openRemoteDir,
    sessionState.activeSessionProfile,
    sessionState.activeSessionId,
    sessionState.isRemoteConnected,
    activeSftpAvailability,
    filesWidgetVisible,
    terminalPathSyncStateBySession,
    sftpState.currentPath,
    terminalHomeDirs,
    sftpEnabled,
    terminalPathSyncEnabled,
    terminalWorkingDirs,
  ]);

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
          sftpAvailability: activeSftpAvailability,
          terminalPathSyncStatus: activeTerminalPathSyncStatus,
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
          case "files:open-file":
            if (!sessionState.activeSessionId) break;
            if (filesPanelState.isRemoteConnected) {
              openRemoteFileViaCache(
                sessionState.activeSessionId,
                message.entry,
                fileDefaultEditorPath,
              ).catch(() => {});
            } else {
              openLocalFile(message.entry.path, fileDefaultEditorPath).catch(
                () => {},
              );
            }
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
    activeSftpAvailability,
    sftpState.currentPath,
    sftpState.entries,
    openRemoteDir,
    refreshList,
    removeEntry,
    renameEntry,
    uploadFile,
  ]);

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
    onOpenConfigSection: openConfigSection,
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

  async function handleSaveSessionBuffer(sessionId: string) {
    const session = sessionState.sessions.find(
      (item) => item.sessionId === sessionId,
    );
    if (!session) return;
    const text = terminalQuery.getSessionBufferText(sessionId) ?? "";
    const isLocal = sessionActions.isLocalSession(sessionId);
    const profile =
      profiles.find((item) => item.id === session.profileId) ?? editingProfile;
    const baseName = isLocal
      ? (sessionState.localSessionMeta[sessionId]?.label ?? t("session.local"))
      : profile.name || profile.host || t("session.defaultName");
    const target = await save({
      defaultPath: `${baseName}.log`,
      filters: [{ name: "Log", extensions: ["log", "txt"] }],
    });
    if (!target) return;
    await writeTextFile(target, text);
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
            sftpAvailability:
              floatingFilesSnapshot?.sftpAvailability ?? "checking",
            terminalPathSyncStatus:
              floatingFilesSnapshot?.terminalPathSyncStatus ?? "checking",
            currentPath: floatingFilesSnapshot?.currentPath ?? "",
            entries: floatingFilesSnapshot?.entries ?? [],
          }
        : {
            isRemoteSession: sessionState.isRemoteSession,
            isRemoteConnected: sessionState.isRemoteConnected,
            sftpAvailability: activeSftpAvailability,
            terminalPathSyncStatus: activeTerminalPathSyncStatus,
            currentPath: sftpState.currentPath,
            entries: sftpState.entries,
          },
    [
      activeSftpAvailability,
      activeTerminalPathSyncStatus,
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
            openFile: async (
              entry: (typeof filesPanelState.entries)[number],
            ) => {
              postFloatingFilesMessage({ type: "files:open-file", entry });
            },
            uploadFile: async () => {
              postFloatingFilesMessage({ type: "files:upload" });
            },
            downloadFile: async (
              entry: (typeof filesPanelState.entries)[number],
            ) => {
              postFloatingFilesMessage({ type: "files:download", entry });
            },
            cancelTransfer: async () => {},
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
            openFile: async (
              entry: (typeof filesPanelState.entries)[number],
            ) => {
              if (
                sessionState.isRemoteConnected &&
                sessionState.activeSessionId
              ) {
                await openRemoteFileViaCache(
                  sessionState.activeSessionId,
                  entry,
                  fileDefaultEditorPath,
                );
                return;
              }
              await openLocalFile(entry.path, fileDefaultEditorPath);
            },
            uploadFile,
            downloadFile,
            cancelTransfer,
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
      cancelTransfer,
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
        sftpAvailability: filesPanelState.sftpAvailability,
        terminalPathSyncStatus: filesPanelState.terminalPathSyncStatus,
        entries: filesPanelState.entries,
        locale,
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
        onOpenFile: filesPanelActions.openFile,
        onUploadFile: filesPanelActions.uploadFile,
        onDownloadFile: filesPanelActions.downloadFile,
        onCancelTransfer: filesPanelActions.cancelTransfer,
        onCreateFolder: filesPanelActions.createFolder,
        onRenameEntry: filesPanelActions.rename,
        onRemoveEntry: filesPanelActions.remove,
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
      fileDefaultEditorPath,
      filesPanelState.currentPath,
      filesPanelState.terminalPathSyncStatus,
      filesPanelState.sftpAvailability,
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
      const previousTransferId =
        lastSftpTransferIdRef.current[progress.sessionId];
      const isNewTransfer =
        previousTransferId === undefined ||
        previousTransferId !== progress.transferId;

      if (isNewTransfer) {
        shouldRevealTransfers = true;
      }

      lastSftpTransferIdRef.current[progress.sessionId] = progress.transferId;
    });

    if (!shouldRevealTransfers) return;

    setPanelCollapsed("bottom", false);
    setSlotGroups((prev) => {
      const bottomGroup = prev.bottom;
      if (!bottomGroup) return prev;
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

  function handleSlotReplace(slot: LayoutWidgetSlot, key: PanelKey) {
    // UI 候选列表已经做过过滤，这里再做一次防守式保护，
    // 避免未来新增入口时把“已存在或已浮动”的组件重新塞回主窗口。
    if (!availableWidgets.includes(key)) return;
    setSlotGroups((prev) => moveWidgetToSlot(prev, key, slot));
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
                workspace={sessionState.workspace}
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
                hasFocusedLine={terminalQuery.hasFocusedLine}
                onFocusLineAtPoint={terminalActions.focusTerminalLineAtPoint}
                onCopyFocusedLine={terminalActions.copyActiveFocusedLine}
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
                onFocusPane={sessionActions.focusPane}
                onReorderPaneSessions={sessionActions.reorderPaneSessions}
                onReconnectSession={sessionActions.reconnectSession}
                onSaveSession={handleSaveSessionBuffer}
                onSplitActivePane={sessionActions.splitActivePane}
                onClosePaneSession={sessionActions.closePaneSession}
                onResizePaneSplit={sessionActions.resizePaneSplit}
                onCloseOtherSessionsInPane={
                  sessionActions.closeOtherSessionsInPane
                }
                onCloseSessionsToRightInPane={
                  sessionActions.closeSessionsToRightInPane
                }
                onCloseAllSessionsInPane={sessionActions.closeAllSessionsInPane}
                t={t}
              />
            }
            availableWidgets={availableWidgets}
            leftVisible={leftVisible}
            rightVisible={rightVisible}
            bottomVisible={bottomVisible}
            onReplace={handleSlotReplace}
            onFloat={handleFloat}
            onCloseWidget={handleCloseSlot}
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
            resourceMonitorEnabled={resourceMonitorEnabled}
            resourceMonitorStatus={activeResourceMonitorStatus}
            resourceSnapshot={activeResourceSnapshot}
            locale={locale}
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
        sftpEnabled={sftpEnabled}
        fileDefaultEditorPath={fileDefaultEditorPath}
        webLinksEnabled={webLinksEnabled}
        selectionAutoCopyEnabled={selectionAutoCopyEnabled}
        scrollback={scrollback}
        terminalPathSyncEnabled={terminalPathSyncEnabled}
        resourceMonitorEnabled={resourceMonitorEnabled}
        resourceMonitorIntervalSec={resourceMonitorIntervalSec}
        onSftpEnabledChange={setSftpEnabled}
        onFileDefaultEditorPathChange={setFileDefaultEditorPath}
        onWebLinksEnabledChange={setWebLinksEnabled}
        onSelectionAutoCopyEnabledChange={setSelectionAutoCopyEnabled}
        onScrollbackChange={setScrollback}
        onTerminalPathSyncEnabledChange={setTerminalPathSyncEnabled}
        onResourceMonitorEnabledChange={setResourceMonitorEnabled}
        onResourceMonitorIntervalSecChange={setResourceMonitorIntervalSec}
        onClose={() => setConfigModalOpen(false)}
        onSectionChange={setActiveConfigSection}
        t={t}
      />
      <NoticeHost />
    </>
  );
}
