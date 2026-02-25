import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "@/App.css";
import {
  translations,
  type Locale,
  type Translate,
  type TranslationKey,
} from "@/i18n";
import ContextMenu from "@/components/shared/ContextMenu";
import HostPanel from "@/components/host/HostPanel";
import LogPanel from "@/components/log/LogPanel";
import Modal from "@/components/shared/Modal";
import PanelHeader from "@/components/shared/PanelHeader";
import SftpPanel from "@/components/sftp/SftpPanel";
import { useDisableBrowserShortcuts } from "@/hooks/useDisableBrowserShortcuts";
import type {
  AuthType,
  DisconnectReason,
  HostProfile,
  LocalShellProfile,
  LogEntry,
  LogLevel,
  PanelArea,
  PanelKey,
  Session,
  SessionStateUi,
  SftpEntry,
  SftpProgress,
  ThemeId,
} from "@/types";

type LayoutConfig = {
  version: 1;
  visible: Record<PanelArea, boolean>;
  assignments: Record<PanelArea, PanelKey>;
  sizes: Record<PanelArea, number>;
};

type LayoutConfigPayload = Omit<LayoutConfig, "version">;

type AppSettings = {
  version: 1;
  shellId?: string | null;
  locale?: Locale;
  themeId?: ThemeId;
};

type XtermModules = {
  Terminal: typeof import("@xterm/xterm").Terminal;
  FitAddon: typeof import("@xterm/addon-fit").FitAddon;
};

const panelLabelKeys: Record<PanelKey, TranslationKey> = {
  profiles: "panel.profiles",
  files: "panel.files",
  logs: "panel.logs",
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

const defaultProfile: HostProfile = {
  id: "",
  name: "",
  host: "",
  port: 22,
  username: "",
  authType: "password",
  keyPath: null,
  keyPassphraseRef: null,
  passwordRef: null,
  knownHost: null,
  tags: null,
};

const defaultLayout: LayoutConfigPayload = {
  visible: {
    left: true,
    right: true,
    bottom: false,
  },
  assignments: {
    left: "profiles",
    right: "files",
    bottom: "logs",
  },
  sizes: {
    left: 320,
    right: 360,
    bottom: 240,
  },
};

const logStorageKey = "fluxterm.logs";
const maxLogEntries = 10;

/** 应用主界面组件。 */
function App() {
  useDisableBrowserShortcuts();
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem("fluxterm.locale");
    if (saved === "zh" || saved === "en") return saved;
    return navigator.language?.startsWith("zh") ? "zh" : "en";
  });
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const saved = localStorage.getItem("fluxterm.theme");
    if (saved === "aurora" || saved === "sahara" || saved === "dawn") {
      return saved;
    }
    return "aurora";
  });
  const [profiles, setProfiles] = useState<HostProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<HostProfile>(defaultProfile);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionStates, setSessionStates] = useState<
    Record<string, SessionStateUi>
  >({});
  const [sessionReasons, setSessionReasons] = useState<
    Record<string, DisconnectReason>
  >({});
  const [localSessionMeta, setLocalSessionMeta] = useState<
    Record<string, { shellId: string | null; label: string }>
  >({});
  const [availableShells, setAvailableShells] = useState<LocalShellProfile[]>(
    [],
  );
  const [shellId, setShellId] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [reconnectInfoBySession, setReconnectInfoBySession] = useState<
    Record<string, { attempt: number; delayMs: number }>
  >({});
  const [terminalReady, setTerminalReady] = useState(false);
  const [fileViews, setFileViews] = useState<
    Record<string, { path: string; entries: SftpEntry[] }>
  >({});
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [progressBySession, setProgressBySession] = useState<
    Record<string, SftpProgress>
  >({});
  const [logEntries, setLogEntries] = useState<LogEntry[]>(() => {
    const raw = localStorage.getItem(logStorageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is LogEntry =>
            isRecord(item) &&
            typeof item.id === "string" &&
            typeof item.timestamp === "number" &&
            typeof item.key === "string",
        )
        .slice(0, maxLogEntries);
    } catch {
      return [];
    }
  });

  const [panelVisible, setPanelVisible] = useState(defaultLayout.visible);
  const [panelAssignments, setPanelAssignments] = useState<
    Record<PanelArea, PanelKey>
  >(defaultLayout.assignments);
  const [panelSizes, setPanelSizes] = useState(defaultLayout.sizes);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalMode, setProfileModalMode] = useState<"new" | "edit">(
    "new",
  );
  const [profileDraft, setProfileDraft] = useState<HostProfile>(defaultProfile);
  const [profileMenu, setProfileMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const t: Translate = useMemo(
    () => (key, vars) => formatMessage(translations[locale][key] ?? key, vars),
    [locale],
  );

  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const sessionBuffersRef = useRef<Record<string, string>>({});
  const sessionsRef = useRef<Session[]>([]);
  const profilesRef = useRef<HostProfile[]>([]);
  const sessionStatesRef = useRef<Record<string, SessionStateUi>>({});
  const sessionReasonsRef = useRef<Record<string, DisconnectReason>>({});
  const activeSessionIdRef = useRef<string | null>(null);
  const inputBufferRef = useRef<Record<string, string>>({});
  const lastCommandRef = useRef<Record<string, string>>({});
  const reconnectTimersRef = useRef<Record<string, number>>({});
  const reconnectAttemptsRef = useRef<Record<string, number>>({});
  const sessionCloseHandledRef = useRef<Record<string, boolean>>({});
  const localSessionIdsRef = useRef<Set<string>>(new Set());
  const localShellStartedRef = useRef(false);
  const localSessionMetaRef = useRef<
    Record<string, { shellId: string | null; label: string }>
  >({});
  const xtermModulesRef = useRef<XtermModules | null>(null);
  const dragState = useRef<{
    mode: "left" | "right" | "bottom";
    startX: number;
    startY: number;
    startLeft: number;
    startRight: number;
    startBottom: number;
  } | null>(null);
  const layoutPathRef = useRef<string | null>(null);
  const legacyLayoutPathRef = useRef<string | null>(null);
  const settingsPathRef = useRef<string | null>(null);
  const layoutLoadedRef = useRef(false);
  const layoutSaveTimerRef = useRef<number | null>(null);
  const configDirRef = useRef<string | null>(null);
  const pendingShellIdRef = useRef<string | null>(null);

  function safeFit(fitter: FitAddon, container?: HTMLElement | null) {
    if (
      !container ||
      container.clientWidth === 0 ||
      container.clientHeight === 0
    ) {
      return;
    }
    try {
      fitter.fit();
    } catch {
      // Ignore transient xterm render errors during initialization.
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function appendLog(
    key: TranslationKey,
    vars?: Record<string, string | number>,
    level: LogLevel = "info",
  ) {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      key,
      vars,
      level,
    };
    setLogEntries((prev) => [entry, ...prev].slice(0, maxLogEntries));
  }

  function resolveSessionLabel(sessionId: string) {
    const session = sessionsRef.current.find(
      (item) => item.sessionId === sessionId,
    );
    if (!session) return t("session.defaultName");
    if (isLocalSession(sessionId)) {
      return (
        localSessionMetaRef.current[sessionId]?.label ?? t("session.local")
      );
    }
    const profile =
      profilesRef.current.find((item) => item.id === session.profileId) ?? null;
    return profile?.name || profile?.host || t("session.defaultName");
  }

  function isPanelKey(value: unknown): value is PanelKey {
    return value === "profiles" || value === "files" || value === "logs";
  }

  function clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function normalizeLayoutConfig(raw: unknown): LayoutConfigPayload | null {
    if (!isRecord(raw)) return null;
    if (
      !isRecord(raw.visible) ||
      !isRecord(raw.assignments) ||
      !isRecord(raw.sizes)
    ) {
      return null;
    }
    const visible = raw.visible;
    const assignments = raw.assignments;
    const sizes = raw.sizes;
    const nextVisible = {
      left:
        typeof visible.left === "boolean"
          ? visible.left
          : defaultLayout.visible.left,
      right:
        typeof visible.right === "boolean"
          ? visible.right
          : defaultLayout.visible.right,
      bottom:
        typeof visible.bottom === "boolean"
          ? visible.bottom
          : defaultLayout.visible.bottom,
    };
    const nextAssignments: Record<PanelArea, PanelKey> = {
      left: isPanelKey(assignments.left)
        ? assignments.left
        : defaultLayout.assignments.left,
      right: isPanelKey(assignments.right)
        ? assignments.right
        : defaultLayout.assignments.right,
      bottom: isPanelKey(assignments.bottom)
        ? assignments.bottom
        : defaultLayout.assignments.bottom,
    };
    const usedKeys = new Set<PanelKey>();
    (["left", "right", "bottom"] as PanelArea[]).forEach((area) => {
      const key = nextAssignments[area];
      if (usedKeys.has(key)) {
        nextAssignments[area] = defaultLayout.assignments[area];
      }
      usedKeys.add(nextAssignments[area]);
    });
    const nextSizes = {
      left: clampNumber(sizes.left, 220, 520, defaultLayout.sizes.left),
      right: clampNumber(sizes.right, 260, 560, defaultLayout.sizes.right),
      bottom: clampNumber(sizes.bottom, 160, 420, defaultLayout.sizes.bottom),
    };
    return {
      visible: nextVisible,
      assignments: nextAssignments,
      sizes: nextSizes,
    };
  }

  async function loadXtermModules() {
    if (xtermModulesRef.current) return xtermModulesRef.current;
    const [xtermModule, fitModule] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ]);
    const modules: XtermModules = {
      Terminal: xtermModule.Terminal,
      FitAddon: fitModule.FitAddon,
    };
    xtermModulesRef.current = modules;
    return modules;
  }

  async function getConfigDir() {
    if (configDirRef.current) return configDirRef.current;
    const dir = await appConfigDir();
    const path = await join(dir, "flux-term");
    configDirRef.current = path;
    return path;
  }

  async function getLayoutConfigPath() {
    if (layoutPathRef.current) return layoutPathRef.current;
    const dir = await getConfigDir();
    const path = await join(dir, "layout.json");
    layoutPathRef.current = path;
    return path;
  }

  async function getLegacyLayoutConfigPath() {
    if (legacyLayoutPathRef.current) return legacyLayoutPathRef.current;
    const dir = await appConfigDir();
    const path = await join(dir, "layout.json");
    legacyLayoutPathRef.current = path;
    return path;
  }

  async function getSettingsPath() {
    if (settingsPathRef.current) return settingsPathRef.current;
    const dir = await getConfigDir();
    const path = await join(dir, "settings.json");
    settingsPathRef.current = path;
    return path;
  }

  async function loadLayoutConfig() {
    try {
      const path = await getLayoutConfigPath();
      const existsFile = await exists(path);
      let raw: string | null = null;
      if (existsFile) {
        raw = await readTextFile(path);
      } else {
        const legacyPath = await getLegacyLayoutConfigPath();
        if (await exists(legacyPath)) {
          raw = await readTextFile(legacyPath);
        }
      }
      if (!raw) {
        layoutLoadedRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeLayoutConfig(parsed);
      if (!normalized) {
        layoutLoadedRef.current = true;
        return;
      }
      setPanelVisible(normalized.visible);
      setPanelAssignments(normalized.assignments);
      setPanelSizes(normalized.sizes);
    } catch {
      // Ignore invalid layout config.
    } finally {
      layoutLoadedRef.current = true;
    }
  }

  async function saveLayoutConfig(payload: LayoutConfigPayload) {
    const dir = await getConfigDir();
    await mkdir(dir, { recursive: true });
    const path = await getLayoutConfigPath();
    const data: LayoutConfig = {
      version: 1,
      ...payload,
    };
    await writeTextFile(path, JSON.stringify(data, null, 2));
  }

  async function loadSettings() {
    try {
      const path = await getSettingsPath();
      if (!(await exists(path))) {
        return;
      }
      const raw = await readTextFile(path);
      const parsed = JSON.parse(raw) as AppSettings;
      if (parsed?.shellId) {
        pendingShellIdRef.current = parsed.shellId;
      }
      if (parsed?.locale === "zh" || parsed?.locale === "en") {
        setLocale(parsed.locale);
      }
      if (parsed?.themeId && parsed.themeId in themes) {
        setThemeId(parsed.themeId);
      }
    } catch {
      // Ignore invalid settings.
    } finally {
      setSettingsLoaded(true);
    }
  }

  async function saveSettings(payload: AppSettings) {
    const dir = await getConfigDir();
    await mkdir(dir, { recursive: true });
    const path = await getSettingsPath();
    await writeTextFile(path, JSON.stringify(payload, null, 2));
  }

  const activeSession = useMemo(() => {
    if (!activeSessionId) return null;
    return sessions.find((item) => item.sessionId === activeSessionId) ?? null;
  }, [sessions, activeSessionId]);

  const activeFileView = useMemo(() => {
    if (!activeSessionId) return null;
    return fileViews[activeSessionId] ?? null;
  }, [fileViews, activeSessionId]);

  const currentPath = activeFileView?.path ?? "";
  const entries = activeFileView?.entries ?? [];

  const activeSessionState = activeSessionId
    ? sessionStates[activeSessionId]
    : undefined;

  function updateFileView(
    sessionId: string,
    path: string,
    entries: SftpEntry[],
  ) {
    setFileViews((prev) => ({
      ...prev,
      [sessionId]: { path, entries },
    }));
  }

  function clearFileView(sessionId: string) {
    setFileViews((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }
  function isLocalSession(sessionId: string | null) {
    return !!sessionId && localSessionIdsRef.current.has(sessionId);
  }

  function normalizeLocalPath(path: string) {
    if (!path) return path;
    if (path === "drives://") return path;
    if (/^[A-Za-z]:$/.test(path)) {
      return `${path}\\`;
    }
    return path;
  }

  const isRemoteConnected =
    !!activeSession &&
    activeSessionState === "connected" &&
    !isLocalSession(activeSession.sessionId);
  const activeSessionReason = activeSessionId
    ? (sessionReasons[activeSessionId] ?? null)
    : null;
  const activeReconnectInfo = activeSessionId
    ? (reconnectInfoBySession[activeSessionId] ?? null)
    : null;
  const activeSessionProfile =
    activeSession && !isLocalSession(activeSession.sessionId)
      ? (profiles.find((item) => item.id === activeSession.profileId) ?? null)
      : null;
  const isRemoteSession =
    !!activeSession && !isLocalSession(activeSession.sessionId);
  const canReconnect =
    !!activeSessionProfile &&
    activeSessionState !== "connected" &&
    activeSessionState !== "connecting" &&
    activeSessionState !== "reconnecting";

  const maxReconnectAttempts = 6;
  const baseReconnectDelayMs = 2000;
  const maxReconnectDelayMs = 30000;

  function normalizeCommand(command: string) {
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return "";
    if (tokens[0] === "sudo" && tokens.length > 1) {
      return tokens[1];
    }
    return tokens[0];
  }

  function recordCommandInput(sessionId: string, data: string) {
    const cleaned = data.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
    let buffer = inputBufferRef.current[sessionId] ?? "";
    for (const char of cleaned) {
      if (char === "\r" || char === "\n") {
        const command = buffer.trim();
        if (command) {
          lastCommandRef.current[sessionId] = command;
        }
        buffer = "";
      } else if (char === "\u007f" || char === "\b") {
        buffer = buffer.slice(0, -1);
      } else if (char >= " ") {
        buffer += char;
      }
    }
    inputBufferRef.current[sessionId] = buffer;
  }

  function inferDisconnectReason(sessionId: string): DisconnectReason {
    const lastCommand = lastCommandRef.current[sessionId];
    if (!lastCommand) return "network";
    const command = normalizeCommand(lastCommand);
    if (command === "exit") return "exit";
    if (command === "poweroff") return "poweroff";
    if (command === "reboot") return "reboot";
    return "network";
  }

  function clearReconnectState(sessionId: string) {
    const timer = reconnectTimersRef.current[sessionId];
    if (timer) {
      window.clearTimeout(timer);
    }
    delete reconnectTimersRef.current[sessionId];
    delete reconnectAttemptsRef.current[sessionId];
    setReconnectInfoBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }

  function replaceSessionConnection(
    oldSessionId: string,
    nextSession: Session,
    nextState: SessionStateUi = "connecting",
    nextLocalMeta?: { shellId: string | null; label: string },
  ) {
    clearReconnectState(oldSessionId);
    delete sessionCloseHandledRef.current[oldSessionId];
    if (localSessionIdsRef.current.has(oldSessionId)) {
      localSessionIdsRef.current.delete(oldSessionId);
      localSessionIdsRef.current.add(nextSession.sessionId);
      setLocalSessionMeta((prev) => {
        const next = { ...prev };
        const meta = nextLocalMeta ?? next[oldSessionId];
        delete next[oldSessionId];
        if (meta) {
          next[nextSession.sessionId] = meta;
        }
        return next;
      });
    }
    setSessions((prev) =>
      prev.map((item) =>
        item.sessionId === oldSessionId ? nextSession : item,
      ),
    );
    setSessionStates((prev) => {
      const next = { ...prev };
      delete next[oldSessionId];
      next[nextSession.sessionId] = nextState;
      return next;
    });
    setSessionReasons((prev) => {
      const next = { ...prev };
      delete next[oldSessionId];
      return next;
    });
    setProgressBySession((prev) => {
      const next = { ...prev };
      delete next[oldSessionId];
      return next;
    });
    setFileViews((prev) => {
      if (!prev[oldSessionId]) return prev;
      const next = { ...prev };
      next[nextSession.sessionId] = next[oldSessionId];
      delete next[oldSessionId];
      return next;
    });
    delete sessionBuffersRef.current[oldSessionId];
    delete inputBufferRef.current[oldSessionId];
    delete lastCommandRef.current[oldSessionId];
    if (activeSessionIdRef.current === oldSessionId) {
      setActiveSessionId(nextSession.sessionId);
    }
  }

  async function createSshSession(profile: HostProfile) {
    const term = terminalInstance.current;
    const cols = term?.cols ?? 80;
    const rows = term?.rows ?? 24;
    return await invoke<Session>("ssh_connect", {
      profile,
      size: { cols, rows },
    });
  }

  async function createLocalShellSession(shellOverride: string | null = null) {
    const term = terminalInstance.current;
    const cols = term?.cols ?? 80;
    const rows = term?.rows ?? 24;
    const payload: Record<string, unknown> = { size: { cols, rows } };
    const resolvedShell = shellOverride ?? shellId;
    if (resolvedShell) {
      payload.shellId = resolvedShell;
    }
    return await invoke<Session>("local_shell_connect", payload);
  }

  function sessionCommand(
    sessionId: string,
    sshCommand: string,
    localCommand: string,
  ) {
    return isLocalSession(sessionId) ? localCommand : sshCommand;
  }

  function writeToSession(sessionId: string, data: string) {
    return invoke(sessionCommand(sessionId, "ssh_write", "local_shell_write"), {
      sessionId,
      data,
    });
  }

  function resizeSession(sessionId: string, cols: number, rows: number) {
    return invoke(
      sessionCommand(sessionId, "ssh_resize", "local_shell_resize"),
      {
        sessionId,
        cols,
        rows,
      },
    );
  }

  function resolveDefaultShellId(shells: LocalShellProfile[]) {
    if (!shells.length) return null;
    const preferred = shells.find((shell) => shell.id === "powershell");
    if (preferred) return preferred.id;
    return shells[0].id;
  }

  function findShellById(id: string | null) {
    if (!id) return null;
    return availableShells.find((shell) => shell.id === id) ?? null;
  }

  async function attemptReconnect(sessionId: string) {
    const session = sessionsRef.current.find(
      (item) => item.sessionId === sessionId,
    );
    if (!session) {
      clearReconnectState(sessionId);
      return;
    }
    const profile = profilesRef.current.find(
      (item) => item.id === session.profileId,
    );
    if (!profile) {
      clearReconnectState(sessionId);
      return;
    }
    try {
      const result = await createSshSession(profile);
      replaceSessionConnection(sessionId, result);
    } catch {
      const attempts = reconnectAttemptsRef.current[sessionId] ?? 0;
      if (attempts >= maxReconnectAttempts) {
        clearReconnectState(sessionId);
        setSessionStates((prev) => ({
          ...prev,
          [sessionId]: "disconnected",
        }));
        return;
      }
      scheduleReconnect(sessionId);
    }
  }

  function scheduleReconnect(sessionId: string) {
    const attempts = (reconnectAttemptsRef.current[sessionId] ?? 0) + 1;
    reconnectAttemptsRef.current[sessionId] = attempts;
    const delayMs = Math.min(
      maxReconnectDelayMs,
      baseReconnectDelayMs * 2 ** (attempts - 1),
    );
    setReconnectInfoBySession((prev) => ({
      ...prev,
      [sessionId]: { attempt: attempts, delayMs },
    }));
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: "reconnecting",
    }));
    const timer = window.setTimeout(() => {
      delete reconnectTimersRef.current[sessionId];
      attemptReconnect(sessionId).catch(() => {});
    }, delayMs);
    reconnectTimersRef.current[sessionId] = timer;
  }

  function handleSessionDisconnected(sessionId: string) {
    if (sessionCloseHandledRef.current[sessionId]) return;
    const session = sessionsRef.current.find(
      (item) => item.sessionId === sessionId,
    );
    if (!session) return;
    sessionCloseHandledRef.current[sessionId] = true;
    const reason = inferDisconnectReason(sessionId);
    setSessionReasons((prev) => ({ ...prev, [sessionId]: reason }));
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: "disconnected",
    }));
    appendLog(
      "log.event.disconnected",
      { name: resolveSessionLabel(sessionId) },
      "error",
    );
    if (reason === "poweroff" || reason === "reboot") {
      scheduleReconnect(sessionId);
    }
  }

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("fluxterm.locale", locale);
  }, [locale]);

  useEffect(() => {
    try {
      localStorage.setItem(logStorageKey, JSON.stringify(logEntries));
    } catch {
      // Ignore localStorage write errors.
    }
  }, [logEntries]);

  useEffect(() => {
    const theme = themes[themeId];
    const root = document.documentElement;
    root.dataset.theme = themeId;
    Object.entries(theme.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    localStorage.setItem("fluxterm.theme", themeId);
    if (terminalInstance.current) {
      terminalInstance.current.options.theme = theme.terminal;
    }
  }, [themeId]);

  useEffect(() => {
    sessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    loadLayoutConfig().catch(() => {});
  }, []);

  useEffect(() => {
    if (!layoutLoadedRef.current) return;
    if (layoutSaveTimerRef.current) {
      window.clearTimeout(layoutSaveTimerRef.current);
    }
    layoutSaveTimerRef.current = window.setTimeout(() => {
      saveLayoutConfig({
        visible: panelVisible,
        assignments: panelAssignments,
        sizes: panelSizes,
      }).catch(() => {});
    }, 300);
    return () => {
      if (layoutSaveTimerRef.current) {
        window.clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
    };
  }, [panelVisible, panelAssignments, panelSizes]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    sessionStatesRef.current = sessionStates;
  }, [sessionStates]);

  useEffect(() => {
    sessionReasonsRef.current = sessionReasons;
  }, [sessionReasons]);

  useEffect(() => {
    localSessionMetaRef.current = localSessionMeta;
  }, [localSessionMeta]);

  useEffect(() => {
    loadProfiles();
    loadSettings().catch(() => {});
    invoke<LocalShellProfile[]>("local_shell_list")
      .then((shells) => {
        setAvailableShells(shells);
        const fallbackId = resolveDefaultShellId(shells);
        const preferred = pendingShellIdRef.current;
        const selected =
          (preferred && shells.some((shell) => shell.id === preferred)
            ? preferred
            : fallbackId) ?? null;
        setShellId(selected);
      })
      .catch(() => {
        setAvailableShells([]);
        setShellId(null);
      });
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const registerListeners = async () => {
      const outputUnlisten = await listen<{ sessionId: string; data: string }>(
        "terminal:output",
        (event) => {
          const sessionId = event.payload.sessionId;
          const buffer = sessionBuffersRef.current[sessionId] ?? "";
          sessionBuffersRef.current[sessionId] = buffer + event.payload.data;
          if (
            terminalInstance.current &&
            sessionRef.current?.sessionId === sessionId
          ) {
            terminalInstance.current.write(event.payload.data);
          }
        },
      );
      if (cancelled) {
        outputUnlisten();
        return;
      }
      unlisteners.push(outputUnlisten);

      const exitUnlisten = await listen<{ sessionId: string }>(
        "terminal:exit",
        (event) => {
          handleSessionDisconnected(event.payload.sessionId);
        },
      );
      if (cancelled) {
        exitUnlisten();
        return;
      }
      unlisteners.push(exitUnlisten);

      const statusUnlisten = await listen<{
        sessionId: string;
        state: SessionStateUi;
        error?: { message: string };
      }>("session:status", (event) => {
        const label = resolveSessionLabel(event.payload.sessionId);
        setSessionStates((prev) => ({
          ...prev,
          [event.payload.sessionId]: event.payload.state,
        }));
        if (event.payload.state === "error" && event.payload.error?.message) {
          setBusyMessage(event.payload.error.message);
        }
        if (event.payload.state === "error") {
          setSessionReasons((prev) => ({
            ...prev,
            [event.payload.sessionId]: "network",
          }));
          appendLog(
            "log.event.error",
            {
              name: label,
              detail: event.payload.error?.message ?? t("log.unknownError"),
            },
            "error",
          );
        }
        if (event.payload.state === "connected") {
          appendLog("log.event.connected", { name: label }, "success");
        }
        if (event.payload.state === "connecting") {
          appendLog("log.event.connecting", { name: label });
        }
        if (event.payload.state === "disconnected") {
          handleSessionDisconnected(event.payload.sessionId);
        }
      });
      if (cancelled) {
        statusUnlisten();
        return;
      }
      unlisteners.push(statusUnlisten);

      const progressUnlisten = await listen<SftpProgress>(
        "sftp:progress",
        (event) => {
          setProgressBySession((prev) => ({
            ...prev,
            [event.payload.sessionId]: event.payload,
          }));
        },
      );
      if (cancelled) {
        progressUnlisten();
        return;
      }
      unlisteners.push(progressUnlisten);
    };

    registerListeners().catch(() => {});

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current || terminalInstance.current) {
      return;
    }
    let term: Terminal | null = null;
    let fitter: FitAddon | null = null;
    let rafId: number | null = null;
    let disposed = false;
    let initTimer: number | null = null;
    let initAttempts = 0;
    let handleResize: (() => void) | null = null;

    const initializeTerminal = async () => {
      if (disposed || terminalInstance.current) return;
      const container = terminalRef.current;
      if (!container) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        initAttempts += 1;
        if (initAttempts < 10) {
          initTimer = window.setTimeout(() => {
            initializeTerminal().catch(() => {});
          }, 50);
        }
        return;
      }

      const { Terminal, FitAddon } = await loadXtermModules();
      if (disposed || terminalInstance.current) return;
      term = new Terminal({
        fontFamily: "JetBrains Mono, Consolas, Monaco, monospace",
        fontSize: 14,
        cursorBlink: true,
        theme: themes[themeId].terminal,
      });
      fitter = new FitAddon();
      term.loadAddon(fitter);
      term.open(container);
      rafId = window.requestAnimationFrame(() => {
        if (disposed || !term?.element) return;
        safeFit(fitter as FitAddon, container);
        term?.focus();
      });
      term.onData((data: string) => {
        const activeSession = sessionRef.current;
        if (!activeSession) return;
        const state = sessionStatesRef.current[activeSession.sessionId];
        if (state !== "connected") {
          if (
            state === "disconnected" &&
            (data.includes("\r") || data.includes("\n"))
          ) {
            const reason = sessionReasonsRef.current[activeSession.sessionId];
            if (reason === "exit") {
              if (isLocalSession(activeSession.sessionId)) {
                reconnectLocalShell(activeSession.sessionId).catch(() => {});
              } else {
                reconnectSession(activeSession.sessionId).catch(() => {});
              }
            }
          }
          return;
        }
        recordCommandInput(activeSession.sessionId, data);
        writeToSession(activeSession.sessionId, data).catch(() => {});
      });

      terminalInstance.current = term;
      fitAddon.current = fitter;
      setTerminalReady(true);

      handleResize = () => {
        const activeSession = sessionRef.current;
        if (!activeSession || !fitAddon.current || !terminalInstance.current) {
          return;
        }
        safeFit(fitAddon.current, terminalRef.current);
        resizeSession(
          activeSession.sessionId,
          terminalInstance.current.cols,
          terminalInstance.current.rows,
        ).catch(() => {});
      };
      window.addEventListener("resize", handleResize);
    };

    initTimer = window.setTimeout(() => {
      initializeTerminal().catch(() => {});
    }, 50);

    return () => {
      disposed = true;
      if (initTimer !== null) {
        window.clearTimeout(initTimer);
      }
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      if (handleResize) {
        window.removeEventListener("resize", handleResize);
      }
      term?.dispose();
      if (terminalInstance.current === term) {
        terminalInstance.current = null;
      }
      if (fitAddon.current === fitter) {
        fitAddon.current = null;
      }
      setTerminalReady(false);
    };
  }, []);

  useEffect(() => {
    if (
      !terminalRef.current ||
      !terminalInstance.current ||
      !fitAddon.current
    ) {
      return;
    }
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        if (!fitAddon.current || !terminalInstance.current) return;
        safeFit(fitAddon.current, terminalRef.current);
        const activeSession = sessionRef.current;
        if (!activeSession) return;
        resizeSession(
          activeSession.sessionId,
          terminalInstance.current.cols,
          terminalInstance.current.rows,
        ).catch(() => {});
      });
    });
    observer.observe(terminalRef.current);
    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      observer.disconnect();
    };
  }, [terminalReady]);

  useEffect(() => {
    if (!terminalReady || localShellStartedRef.current) return;
    if (!settingsLoaded) return;
    localShellStartedRef.current = true;
    connectLocalShell(null, false).catch(() => {
      localShellStartedRef.current = false;
    });
  }, [terminalReady, availableShells, shellId, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings({
      version: 1,
      shellId,
      locale,
      themeId,
    }).catch(() => {});
  }, [shellId, locale, themeId, settingsLoaded]);

  useEffect(() => {
    if (!terminalInstance.current) return;
    terminalInstance.current.reset();
    if (activeSessionId) {
      terminalInstance.current.write(
        sessionBuffersRef.current[activeSessionId] ?? "",
      );
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    loadHomePath(activeSessionId).catch(() => {});
  }, [activeSessionId, activeSessionState]);

  async function loadProfiles() {
    const list = await invoke<HostProfile[]>("profile_list");
    setProfiles(list);
    if (list.length && !activeProfileId) {
      setActiveProfileId(list[0].id);
      setEditingProfile(list[0]);
    }
  }

  function pickProfile(profileId: string) {
    setActiveProfileId(profileId);
    const profile = profiles.find((item) => item.id === profileId);
    if (profile) {
      setEditingProfile(profile);
    }
  }

  async function saveProfile(profile: HostProfile) {
    const saved = await invoke<HostProfile>("profile_save", { profile });
    const nextProfiles = profiles
      .filter((item) => item.id !== saved.id)
      .concat(saved);
    setProfiles(nextProfiles);
    setActiveProfileId(saved.id);
    setEditingProfile(saved);
  }

  async function removeProfile(profileId: string) {
    await invoke("profile_remove", { profileId });
    const next = profiles.filter((item) => item.id !== profileId);
    setProfiles(next);
    if (activeProfileId === profileId) {
      setActiveProfileId(next[0]?.id ?? null);
      setEditingProfile(next[0] ?? defaultProfile);
    }
  }

  async function connectWithProfile(profileInput: HostProfile) {
    if (!profileInput.host || !profileInput.username) {
      setBusyMessage(t("messages.missingHostUser"));
      return;
    }
    setBusyMessage(t("messages.connecting"));
    try {
      const profile = profileInput.id
        ? profileInput
        : await invoke<HostProfile>("profile_save", {
            profile: profileInput,
          });
      if (!profileInput.id) {
        setProfiles((prev) => prev.concat(profile));
        setEditingProfile(profile);
        setActiveProfileId(profile.id);
      }
      const result = await createSshSession(profile);
      setSessions((prev) => prev.concat(result));
      setActiveSessionId(result.sessionId);
      setSessionStates((prev) => ({
        ...prev,
        [result.sessionId]: "connected",
      }));
      setSessionReasons((prev) => {
        const next = { ...prev };
        delete next[result.sessionId];
        return next;
      });
      setBusyMessage(null);
    } catch (error: any) {
      setBusyMessage(error?.message ?? t("messages.connectFailed"));
    }
  }

  function connectProfile(profile: HostProfile) {
    setActiveProfileId(profile.id);
    setEditingProfile(profile);
    connectWithProfile(profile).catch(() => {});
  }

  async function connectLocalShell(
    targetShell: LocalShellProfile | null,
    activate: boolean,
  ) {
    const shellProfile =
      targetShell ?? findShellById(shellId) ?? availableShells[0] ?? null;
    const session = await createLocalShellSession(shellProfile?.id ?? null);
    const label = shellProfile?.label ?? t("session.local");
    localSessionIdsRef.current.add(session.sessionId);
    setLocalSessionMeta((prev) => ({
      ...prev,
      [session.sessionId]: { shellId: shellProfile?.id ?? null, label },
    }));
    setSessions((prev) => [session, ...prev]);
    if (activate) {
      setActiveSessionId(session.sessionId);
    } else {
      setActiveSessionId((prev) => prev ?? session.sessionId);
    }
    setSessionStates((prev) => ({ ...prev, [session.sessionId]: "connected" }));
    setSessionReasons((prev) => {
      const next = { ...prev };
      delete next[session.sessionId];
      return next;
    });
    appendLog("log.event.connected", { name: label }, "success");
  }

  function openNewProfile() {
    setProfileModalMode("new");
    setProfileDraft({ ...defaultProfile, id: "" });
    setProfileModalOpen(true);
  }

  function openEditProfile() {
    if (!editingProfile.id) return;
    setProfileModalMode("edit");
    setProfileDraft(editingProfile);
    setProfileModalOpen(true);
  }

  async function submitProfile() {
    await saveProfile(profileDraft);
    setProfileModalOpen(false);
  }

  function openProfileMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    setProfileMenu({ x: event.clientX, y: event.clientY });
  }

  function closeProfileMenu() {
    setProfileMenu(null);
  }

  async function disconnectSession(sessionId: string) {
    const state = sessionStatesRef.current[sessionId];
    const localSession = isLocalSession(sessionId);
    if (
      state === "connected" ||
      state === "connecting" ||
      state === "reconnecting"
    ) {
      try {
        await invoke(
          localSession ? "local_shell_disconnect" : "ssh_disconnect",
          { sessionId },
        );
      } catch {
        // Ignore if the backend session is already closed.
      }
    }
    if (localSession) {
      localSessionIdsRef.current.delete(sessionId);
      setLocalSessionMeta((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    }
    setSessions((prev) => {
      const remaining = prev.filter((item) => item.sessionId !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[0]?.sessionId ?? null);
      }
      return remaining;
    });
    setSessionStates((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setSessionReasons((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    clearReconnectState(sessionId);
    clearFileView(sessionId);
    delete sessionBuffersRef.current[sessionId];
    delete inputBufferRef.current[sessionId];
    delete lastCommandRef.current[sessionId];
    delete sessionCloseHandledRef.current[sessionId];
    setProgressBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setBusyMessage(null);
  }

  async function reconnectSession(sessionId: string) {
    if (isLocalSession(sessionId)) {
      await reconnectLocalShell(sessionId);
      return;
    }
    clearReconnectState(sessionId);
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: "reconnecting",
    }));
    await attemptReconnect(sessionId);
  }

  async function reconnectLocalShell(sessionId: string) {
    clearReconnectState(sessionId);
    setSessionStates((prev) => ({
      ...prev,
      [sessionId]: "reconnecting",
    }));
    try {
      const meta = localSessionMetaRef.current[sessionId];
      const shellProfile =
        findShellById(meta?.shellId ?? null) ?? availableShells[0] ?? null;
      const label = meta?.label ?? shellProfile?.label ?? t("session.local");
      const result = await createLocalShellSession(shellProfile?.id ?? null);
      replaceSessionConnection(sessionId, result, "connected", {
        shellId: shellProfile?.id ?? meta?.shellId ?? null,
        label,
      });
    } catch {
      setSessionStates((prev) => ({
        ...prev,
        [sessionId]: "disconnected",
      }));
    }
  }

  async function refreshList(path = currentPath, sessionId = activeSessionId) {
    if (!sessionId) return;
    if (isLocalSession(sessionId)) {
      const normalizedPath = normalizeLocalPath(path);
      const list = await invoke<SftpEntry[]>("local_list", {
        path: normalizedPath,
      });
      updateFileView(sessionId, normalizedPath, list);
      return;
    }
    if (sessionStatesRef.current[sessionId] !== "connected") {
      updateFileView(sessionId, "", []);
      return;
    }
    const list = await invoke<SftpEntry[]>("sftp_list", {
      sessionId,
      path,
    });
    updateFileView(sessionId, path, list);
  }

  async function loadHomePath(sessionId = activeSessionId) {
    if (!sessionId) return;
    if (isLocalSession(sessionId)) {
      const home = await invoke<string>("local_home");
      await refreshList(home, sessionId);
      return;
    }
    if (sessionStatesRef.current[sessionId] !== "connected") {
      updateFileView(sessionId, "", []);
      return;
    }
    const home = await invoke<string>("sftp_home", {
      sessionId,
    });
    await refreshList(home, sessionId);
  }

  async function openRemoteDir(path: string) {
    await refreshList(path);
  }

  async function uploadFile() {
    if (!activeSession) return;
    const file = await open({ multiple: false });
    if (!file || Array.isArray(file)) return;
    const fileName = file.split(/[\\/]/).pop() ?? "upload.bin";
    const remotePath = currentPath.endsWith("/")
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`;
    appendLog("log.event.uploadStart", { name: fileName });
    setBusyMessage(t("messages.uploading"));
    try {
      await invoke("sftp_upload", {
        sessionId: activeSession.sessionId,
        localPath: file,
        remotePath,
      });
      await refreshList();
      setBusyMessage(null);
      appendLog("log.event.uploadDone", { name: fileName }, "success");
    } catch (error: any) {
      setBusyMessage(error?.message ?? "上传失败");
      appendLog("log.event.uploadFailed", { name: fileName }, "error");
    }
  }

  async function downloadFile(entry: SftpEntry) {
    if (!activeSession) return;
    const target = await save({ defaultPath: entry.name });
    if (!target) return;
    appendLog("log.event.downloadStart", { name: entry.name });
    setBusyMessage(t("messages.downloading"));
    try {
      await invoke("sftp_download", {
        sessionId: activeSession.sessionId,
        remotePath: entry.path,
        localPath: target,
      });
      setBusyMessage(null);
      appendLog("log.event.downloadDone", { name: entry.name }, "success");
    } catch (error: any) {
      setBusyMessage(error?.message ?? "下载失败");
      appendLog("log.event.downloadFailed", { name: entry.name }, "error");
    }
  }

  async function createFolder() {
    if (!activeSession) return;
    const name = window.prompt(t("prompts.newFolder"));
    if (!name) return;
    const path = currentPath.endsWith("/")
      ? `${currentPath}${name}`
      : `${currentPath}/${name}`;
    await invoke("sftp_mkdir", { sessionId: activeSession.sessionId, path });
    await refreshList();
  }

  async function rename(entry: SftpEntry) {
    if (!activeSession) return;
    const name = window.prompt(t("prompts.rename"), entry.name);
    if (!name || name === entry.name) return;
    const base = currentPath.endsWith("/") ? currentPath : `${currentPath}/`;
    const to = `${base}${name}`;
    await invoke("sftp_rename", {
      sessionId: activeSession.sessionId,
      from: entry.path,
      to,
    });
    await refreshList();
  }

  async function remove(entry: SftpEntry) {
    if (!activeSession) return;
    if (!window.confirm(t("prompts.confirmDelete", { name: entry.name }))) {
      return;
    }
    await invoke("sftp_remove", {
      sessionId: activeSession.sessionId,
      path: entry.path,
    });
    await refreshList();
  }

  const panels = useMemo(() => {
    return {
      profiles: (
        <HostPanel
          profiles={profiles}
          activeProfileId={activeProfileId}
          onPick={pickProfile}
          onConnectProfile={connectProfile}
          localShells={availableShells}
          onConnectLocalShell={(shell) => {
            connectLocalShell(shell, true).catch(() => {});
          }}
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
      logs: (
        <LogPanel
          sessionState={activeSessionState ?? "disconnected"}
          sessionReason={activeSessionReason}
          reconnectInfo={activeReconnectInfo}
          onReconnect={() => {
            if (!activeSessionId) return;
            reconnectSession(activeSessionId).catch(() => {});
          }}
          canReconnect={canReconnect}
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
    };
  }, [
    profiles,
    activeProfileId,
    editingProfile,
    activeSession,
    activeSessionId,
    sessionStates,
    currentPath,
    entries,
    isRemoteSession,
    progressBySession,
    busyMessage,
    logEntries,
    locale,
    sessionReasons,
    reconnectInfoBySession,
    activeSessionState,
    activeSessionReason,
    activeReconnectInfo,
    isRemoteConnected,
    canReconnect,
    t,
  ]);

  function handlePanelSelect(area: PanelArea, next: PanelKey) {
    if (
      Object.values(panelAssignments).includes(next) &&
      panelAssignments[area] !== next
    ) {
      return;
    }
    setPanelAssignments((prev) => ({ ...prev, [area]: next }));
  }

  function startResize(
    mode: "left" | "right" | "bottom",
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragState.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panelSizes.left,
      startRight: panelSizes.right,
      startBottom: panelSizes.bottom,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      mode === "bottom" ? "row-resize" : "col-resize";
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", stopResize);
  }

  function handleResizeMove(event: MouseEvent) {
    const drag = dragState.current;
    if (!drag) return;
    if (drag.mode === "left") {
      const min = 220;
      const max = Math.max(min, Math.min(520, window.innerWidth * 0.5));
      const next = Math.min(
        max,
        Math.max(min, drag.startLeft + (event.clientX - drag.startX)),
      );
      setPanelSizes((prev) => ({ ...prev, left: next }));
    }
    if (drag.mode === "right") {
      const min = 260;
      const max = Math.max(min, Math.min(560, window.innerWidth * 0.5));
      const next = Math.min(
        max,
        Math.max(min, drag.startRight - (event.clientX - drag.startX)),
      );
      setPanelSizes((prev) => ({ ...prev, right: next }));
    }
    if (drag.mode === "bottom") {
      const min = 160;
      const max = Math.max(min, Math.min(420, window.innerHeight * 0.6));
      const next = Math.min(
        max,
        Math.max(min, drag.startBottom - (event.clientY - drag.startY)),
      );
      setPanelSizes((prev) => ({ ...prev, bottom: next }));
    }
  }

  function stopResize() {
    dragState.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", stopResize);
  }

  function switchSession(sessionId: string) {
    setActiveSessionId(sessionId);
  }

  const layoutVars = useMemo(() => {
    const hasSidePanels = panelVisible.left || panelVisible.right;
    const hasAnyPanels = hasSidePanels || panelVisible.bottom;
    return {
      "--left-width": panelVisible.left ? `${panelSizes.left}px` : "0px",
      "--right-width": panelVisible.right ? `${panelSizes.right}px` : "0px",
      "--left-resizer": panelVisible.left ? "8px" : "0px",
      "--right-resizer": panelVisible.right ? "8px" : "0px",
      "--bottom-resizer": panelVisible.bottom ? "8px" : "0px",
      "--bottom-height": panelVisible.bottom ? `${panelSizes.bottom}px` : "0px",
      "--workspace-pad": hasAnyPanels ? "16px" : "0px",
    } as React.CSSProperties;
  }, [panelVisible, panelSizes]);

  const selectedProfile = editingProfile.id ? editingProfile : null;
  const profileMenuItems = [
    {
      label: t("profile.menu.new"),
      disabled: false,
      onClick: () => {
        closeProfileMenu();
        openNewProfile();
      },
    },
    {
      label: t("profile.menu.edit"),
      disabled: !selectedProfile,
      onClick: () => {
        if (!selectedProfile) return;
        closeProfileMenu();
        openEditProfile();
      },
    },
    {
      label: t("profile.menu.delete"),
      disabled: !selectedProfile,
      onClick: () => {
        if (!selectedProfile) return;
        closeProfileMenu();
        removeProfile(selectedProfile.id);
      },
    },
  ];

  return (
    <div className="app-shell" style={layoutVars}>
      <header className="top-bar">
        <div className="brand">
          <span className="brand-dot" />
          FluxTerm
          <span className="brand-sub">{t("app.brandSub")}</span>
        </div>
        <div className="top-actions">
          <div className="panel-toggles">
            <button
              className={panelVisible.left ? "active" : ""}
              onClick={() =>
                setPanelVisible((prev) => ({ ...prev, left: !prev.left }))
              }
            >
              {t("layout.left")}
            </button>
            <button
              className={panelVisible.right ? "active" : ""}
              onClick={() =>
                setPanelVisible((prev) => ({ ...prev, right: !prev.right }))
              }
            >
              {t("layout.right")}
            </button>
            <button
              className={panelVisible.bottom ? "active" : ""}
              onClick={() =>
                setPanelVisible((prev) => ({ ...prev, bottom: !prev.bottom }))
              }
            >
              {t("layout.bottom")}
            </button>
          </div>
          <div className="top-selects">
            <label className="top-select">
              <span>{t("settings.language")}</span>
              <select
                value={locale}
                onChange={(event) => setLocale(event.target.value as Locale)}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="top-select">
              <span>{t("settings.shell")}</span>
              <select
                value={shellId ?? ""}
                onChange={(event) => setShellId(event.target.value || null)}
                disabled={!availableShells.length}
              >
                {!availableShells.length && <option value="">-</option>}
                {availableShells.map((shell) => (
                  <option key={shell.id} value={shell.id}>
                    {shell.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="top-select">
              <span>{t("settings.theme")}</span>
              <select
                value={themeId}
                onChange={(event) => setThemeId(event.target.value as ThemeId)}
              >
                {Object.entries(themes).map(([key, theme]) => (
                  <option key={key} value={key}>
                    {theme.label[locale]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      <div className={`workspace ${panelVisible.bottom ? "with-bottom" : ""}`}>
        {panelVisible.left && (
          <aside className="panel left-panel">
            <PanelHeader
              area="left"
              selection={panelAssignments.left}
              lockedKeys={Object.values(panelAssignments)}
              labels={panelLabelKeys}
              onSelect={handlePanelSelect}
              onContextMenu={
                panelAssignments.left === "profiles"
                  ? openProfileMenu
                  : undefined
              }
              t={t}
            />
            <div className="panel-body">{panels[panelAssignments.left]}</div>
          </aside>
        )}
        {panelVisible.left && (
          <div
            className="panel-resizer vertical left-resizer"
            onMouseDown={(event) => startResize("left", event)}
          />
        )}
        <main className="terminal-panel">
          <div className="terminal-header">
            <div className="terminal-title">{t("terminal.title")}</div>
            <div className="session-tabs">
              {sessions.map((item) => {
                const localSession = isLocalSession(item.sessionId);
                const profile =
                  profiles.find((entry) => entry.id === item.profileId) ??
                  editingProfile;
                const localLabel =
                  localSessionMeta[item.sessionId]?.label ?? t("session.local");
                const label = localSession
                  ? localLabel
                  : profile.name || profile.host || t("session.defaultName");
                const active = item.sessionId === activeSessionId;
                const state = sessionStates[item.sessionId];
                return (
                  <div
                    key={item.sessionId}
                    className={`session-tab ${active ? "active" : ""} ${
                      state === "disconnected" ? "disconnected" : ""
                    }`}
                  >
                    <button onClick={() => switchSession(item.sessionId)}>
                      {label}
                    </button>
                    <button
                      className="close"
                      onClick={() => disconnectSession(item.sessionId)}
                    >
                      x
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="terminal-body">
            <div
              className={`terminal-container ${terminalReady ? "ready" : ""}`}
              ref={terminalRef}
            />
            {activeSessionState === "disconnected" &&
              activeSessionReason === "exit" && (
                <div className="terminal-banner">{t("terminal.exitHint")}</div>
              )}
            {!activeSession && (
              <div className="terminal-empty">{t("terminal.empty")}</div>
            )}
          </div>
        </main>
        {panelVisible.right && (
          <div
            className="panel-resizer vertical right-resizer"
            onMouseDown={(event) => startResize("right", event)}
          />
        )}
        {panelVisible.right && (
          <aside className="panel right-panel">
            <PanelHeader
              area="right"
              selection={panelAssignments.right}
              lockedKeys={Object.values(panelAssignments)}
              labels={panelLabelKeys}
              onSelect={handlePanelSelect}
              t={t}
            />
            <div className="panel-body">{panels[panelAssignments.right]}</div>
          </aside>
        )}
      </div>

      {panelVisible.bottom && (
        <div
          className="panel-resizer horizontal bottom-resizer"
          onMouseDown={(event) => startResize("bottom", event)}
        />
      )}

      {panelVisible.bottom && (
        <footer className="panel bottom-panel">
          <PanelHeader
            area="bottom"
            selection={panelAssignments.bottom}
            lockedKeys={Object.values(panelAssignments)}
            labels={panelLabelKeys}
            onSelect={handlePanelSelect}
            t={t}
          />
          <div className="panel-body">{panels[panelAssignments.bottom]}</div>
        </footer>
      )}

      <Modal
        open={profileModalOpen}
        title={
          profileModalMode === "new"
            ? t("profile.modal.newTitle")
            : t("profile.modal.editTitle")
        }
        closeLabel={t("actions.close")}
        onClose={() => setProfileModalOpen(false)}
        actions={
          <>
            <button
              className="ghost"
              onClick={() => setProfileModalOpen(false)}
            >
              {t("actions.cancel")}
            </button>
            <button className="primary" onClick={submitProfile}>
              {t("actions.save")}
            </button>
          </>
        }
      >
        <div className="host-editor">
          <div className="form-row">
            <label>{t("profile.form.name")}</label>
            <input
              value={profileDraft.name}
              onChange={(event) =>
                setProfileDraft({ ...profileDraft, name: event.target.value })
              }
              placeholder={t("profile.placeholder.name")}
            />
          </div>
          <div className="form-row">
            <label>{t("profile.form.host")}</label>
            <input
              value={profileDraft.host}
              onChange={(event) =>
                setProfileDraft({ ...profileDraft, host: event.target.value })
              }
              placeholder={t("profile.placeholder.host")}
            />
          </div>
          <div className="form-row split">
            <div>
              <label>{t("profile.form.port")}</label>
              <input
                type="number"
                value={profileDraft.port}
                onChange={(event) =>
                  setProfileDraft({
                    ...profileDraft,
                    port: Number(event.target.value),
                  })
                }
              />
            </div>
            <div>
              <label>{t("profile.form.username")}</label>
              <input
                value={profileDraft.username}
                onChange={(event) =>
                  setProfileDraft({
                    ...profileDraft,
                    username: event.target.value,
                  })
                }
              />
            </div>
          </div>
          <div className="form-row">
            <label>{t("profile.form.authType")}</label>
            <select
              value={profileDraft.authType}
              onChange={(event) =>
                setProfileDraft({
                  ...profileDraft,
                  authType: event.target.value as AuthType,
                })
              }
            >
              <option value="password">{t("profile.auth.password")}</option>
              <option value="key">{t("profile.auth.key")}</option>
              <option value="agent">{t("profile.auth.agent")}</option>
            </select>
          </div>
          <div className="form-row">
            <label>{t("profile.form.group")}</label>
            <input
              value={profileDraft.tags?.[0] ?? ""}
              onChange={(event) =>
                setProfileDraft({
                  ...profileDraft,
                  tags: event.target.value ? [event.target.value] : null,
                })
              }
              placeholder={t("profile.placeholder.group")}
            />
          </div>
          {profileDraft.authType === "password" && (
            <div className="form-row">
              <label>{t("profile.form.password")}</label>
              <input
                type="password"
                value={profileDraft.passwordRef ?? ""}
                onChange={(event) =>
                  setProfileDraft({
                    ...profileDraft,
                    passwordRef: event.target.value,
                  })
                }
              />
            </div>
          )}
          {profileDraft.authType === "key" && (
            <>
              <div className="form-row">
                <label>{t("profile.form.keyPath")}</label>
                <input
                  value={profileDraft.keyPath ?? ""}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      keyPath: event.target.value,
                    })
                  }
                  placeholder="~/.ssh/id_ed25519"
                />
              </div>
              <div className="form-row">
                <label>{t("profile.form.keyPassphrase")}</label>
                <input
                  type="password"
                  value={profileDraft.keyPassphraseRef ?? ""}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      keyPassphraseRef: event.target.value,
                    })
                  }
                />
              </div>
            </>
          )}
        </div>
      </Modal>

      {profileMenu && (
        <ContextMenu
          x={profileMenu.x}
          y={profileMenu.y}
          items={profileMenuItems}
          onClose={closeProfileMenu}
        />
      )}
    </div>
  );
}

export default App;
