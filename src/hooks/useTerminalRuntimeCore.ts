/**
 * 终端运行时核心 Hook。
 * 职责：
 * 1. 管理 xterm 实例创建、挂载、重建与销毁。
 * 2. 维护终端输出缓存，保证 split/重挂载后仍能回放完整会话内容。
 * 3. 提供搜索、复制、链接菜单和尺寸同步等终端能力。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { warn } from "@/shared/logging/telemetry";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type {
  ISearchOptions,
  ISearchResultChangeEvent,
  SearchAddon,
} from "@xterm/addon-search";
import type { Unicode11Addon } from "@xterm/addon-unicode11";
import type { WebLinksAddon } from "@xterm/addon-web-links";
import type { WebglAddon } from "@xterm/addon-webgl";
import type {
  CommandHistoryLiveCapture,
  DisconnectReason,
  Session,
  SessionStateUi,
} from "@/types";
import type {
  CommandAutocompleteCandidate,
  CommandAutocompleteProvider,
} from "@/features/command-history/core/autocomplete";
import { updateCommandInputBuffer } from "@/features/command-history/core/inputTracker";
import {
  AUTOCOMPLETE_MIN_PANEL_HEIGHT,
  AUTOCOMPLETE_VISIBLE_ITEMS,
  COMMAND_CAPTURE_DEBOUNCE_MS,
  DEFAULT_TERMINAL_SCROLLBACK,
  SELECTION_AUTO_COPY_DEBOUNCE_MS,
  TERMINAL_MOUNT_RETRY_LIMIT,
} from "@/features/terminal/core/constants";
import { registerTerminalOutputListener } from "@/features/terminal/core/listeners";
import { extractErrorMessage } from "@/shared/errors/appError";
import { normalizeTerminalWordSeparators } from "@/constants/terminalWordSeparators";
import {
  DEFAULT_TERMINAL_CURSOR_STYLE,
  normalizeTerminalCursorStyle,
  type TerminalCursorStyle,
} from "@/constants/terminalCursorStyle";

type TerminalTheme = {
  background: string;
  foreground: string;
  selectionBackground: string;
  cursor: string;
};

type UseTerminalRuntimeProps = {
  theme: TerminalTheme;
  webLinksEnabled?: boolean;
  selectionAutoCopyEnabled?: boolean;
  scrollback?: number;
  cursorStyle?: TerminalCursorStyle;
  resolveWordSeparators?: (sessionId: string) => string | null | undefined;
  activeSessionId: string | null;
  activeSession: Session | null;
  sessions: Session[];
  onSizeChange?: (size: { cols: number; rows: number }) => void;
  sessionStatesRef: React.RefObject<Record<string, SessionStateUi>>;
  sessionReasonsRef: React.RefObject<Record<string, DisconnectReason>>;
  sessionBuffersRef: React.RefObject<Record<string, string>>;
  setLastCommand: (sessionId: string, command: string) => void;
  writeToSession: (sessionId: string, data: string) => Promise<unknown>;
  resizeSession: (
    sessionId: string,
    cols: number,
    rows: number,
  ) => Promise<unknown>;
  onWorkingDirectoryChange?: (
    sessionId: string,
    payload: { username: string | null; path: string },
  ) => void;
  onPathSyncSupportChange?: (
    sessionId: string,
    status: "supported" | "unsupported",
  ) => void;
  isLocalSession: (sessionId: string | null) => boolean;
  reconnectSession: (sessionId: string) => Promise<void>;
  reconnectLocalShell: (sessionId: string) => Promise<void>;
  onCommandCaptureChange?: (
    sessionId: string,
    capture: CommandHistoryLiveCapture,
  ) => void;
  onCommandCommit?: (sessionId: string, command: string) => void;
  autocompleteProvider?: CommandAutocompleteProvider | null;
};

type ActiveAutocompleteState = {
  sessionId: string;
  input: string;
  items: CommandAutocompleteCandidate[];
  selectedIndex: number;
};

type AutocompleteAnchor = {
  offset: number;
  maxHeight: number;
  placement: "top" | "bottom";
  left: number;
};

type TerminalRuntime = {
  registerTerminalContainer: (
    sessionId: string,
    element: HTMLDivElement | null,
  ) => void;
  isTerminalReady: (sessionId: string) => boolean;
  getTerminalSize: () => { cols: number; rows: number };
  getActiveTerminalStats: () => {
    windowRows: number;
    windowCols: number;
    bufferLines: number;
  };
  getSessionBufferText: (sessionId: string) => string | null;
  getActiveSearchStats: () => {
    resultIndex: number;
    resultCount: number;
  } | null;
  getActiveLinkMenu: () => {
    x: number;
    y: number;
    uri: string;
  } | null;
  focusActiveTerminal: () => boolean;
  focusTerminalLineAtPoint: (sessionId: string, clientY: number) => boolean;
  hasFocusedLine: () => boolean;
  copyActiveFocusedLine: () => Promise<boolean>;
  hasActiveSelection: () => boolean;
  getActiveSelectionText: () => string;
  copyActiveSelection: () => Promise<boolean>;
  openActiveLink: () => Promise<boolean>;
  copyActiveLink: () => Promise<boolean>;
  closeActiveLinkMenu: () => void;
  pasteToActiveTerminal: () => Promise<boolean>;
  clearActiveTerminal: () => boolean;
  clearActiveSearchDecorations: () => void;
  searchActiveTerminalNext: (
    keyword: string,
    options?: ISearchOptions,
  ) => boolean;
  searchActiveTerminalPrev: (
    keyword: string,
    options?: ISearchOptions,
  ) => boolean;
  getActiveCommandCapture: () => CommandHistoryLiveCapture | null;
  getActiveAutocomplete: () => ActiveAutocompleteState | null;
  getActiveAutocompleteAnchor: () => AutocompleteAnchor | null;
  applyActiveAutocompleteSuggestion: (command?: string) => Promise<boolean>;
  closeActiveAutocomplete: () => void;
};

type XtermModules = {
  Terminal: typeof import("@xterm/xterm").Terminal;
  FitAddon: typeof import("@xterm/addon-fit").FitAddon;
  SearchAddon: typeof import("@xterm/addon-search").SearchAddon | null;
  Unicode11Addon: typeof import("@xterm/addon-unicode11").Unicode11Addon | null;
  WebLinksAddon: typeof import("@xterm/addon-web-links").WebLinksAddon | null;
  WebglAddon: typeof import("@xterm/addon-webgl").WebglAddon | null;
};

type Disposable = { dispose: () => void };

type TerminalBundle = {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon | null;
  unicode11Addon: Unicode11Addon | null;
  webLinksAddon: WebLinksAddon | null;
  webglAddon: WebglAddon | null;
  container: HTMLDivElement;
  host: HTMLDivElement;
  disposables: Disposable[];
};

type FocusedLineState = {
  line: number;
  marker: IMarker;
  decoration: IDecoration | null;
};

type SearchDirection = "next" | "prev";

type SearchStats = {
  resultIndex: number;
  resultCount: number;
  decorations: boolean;
};

type PromptParseState = {
  carry: string;
};

/** 终端链接点击后的临时菜单状态。 */
type LinkMenuState = {
  sessionId: string;
  x: number;
  y: number;
  uri: string;
};

/** 当前会话输入行监听的内部状态。 */
type CommandCaptureMeta = {
  promptPrefix: string | null;
  waitingForNextPrompt: boolean;
};

/**
 * 判断当前焦点是否应由表单或模态框继续持有。
 * 用于在终端会话切换、重连或重建时避免无条件把焦点抢回 xterm，
 * 从而打断用户在输入框、选择框或弹窗中的编辑操作。
 */
function shouldPreserveFocusedElement() {
  const activeElement = document.activeElement;
  if (!activeElement || !(activeElement instanceof HTMLElement)) {
    return false;
  }
  const tagName = activeElement.tagName.toLowerCase();
  if (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    activeElement.isContentEditable
  ) {
    return true;
  }
  return Boolean(activeElement.closest(".modal"));
}

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

function stripAnsiForPromptParsing(text: string) {
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "");
}

/**
 * 检测颜色是否包含小于 1 的 alpha。
 * 目前只解析 rgb/rgba 字符串，已满足终端主题背景的当前产出格式。
 */
function hasTranslucentAlpha(color: string) {
  const normalized = color.trim();
  const rgbaPattern =
    /^rgba\(\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*,\s*([0-9]*\.?[0-9]+)\s*\)$/i;
  const match = rgbaPattern.exec(normalized);
  if (!match) return false;
  const alpha = Number(match[1]);
  return Number.isFinite(alpha) && alpha < 1;
}

/**
 * 当前只支持 bash 常见提示符形态：
 * 1. user@host:/abs/path$
 * 2. user@host:~/path$
 * 3. /abs/path$
 * 4. ~/path$
 * 不再继续兼容 zsh 的缩略路径提示符，因为它通常不给出可稳定还原的绝对路径。
 *
 * PATH_SYNC_GIT_BASH_TODO:
 * 后续如果要支持 Git Bash，请优先从这里扩展提示符匹配规则。
 */
function matchPromptPath(line: string) {
  const trimmed = line.trimEnd();
  const promptMatch =
    trimmed.match(
      /(?:^|\s)(?:[^@\s]+@)?[^:\s]+:(?<path>~(?:\/[^\s#$]*)?|\/[^\s#$]*)\s*[#$]$/,
    ) ?? trimmed.match(/(?:^|\s)(?<path>~(?:\/[^\s#$]*)?|\/[^\s#$]*)\s*[#$]$/);
  return promptMatch?.groups?.path ?? null;
}

function matchPromptUsername(line: string) {
  const trimmed = line.trimEnd();
  const promptMatch =
    trimmed.match(
      /(?:^|\s)(?<username>[^@\s:]+)@[^:\s]+:(?:~(?:\/[^\s#$]*)?|\/[^\s#$]*)\s*[#$]$/,
    ) ?? trimmed.match(/(?:^|\s)(?<username>[^@\s:]+)@[^:\s]+\s*[$#]$/);
  return promptMatch?.groups?.username ?? null;
}

/**
 * 识别“看起来像 shell prompt，但又不满足 bash 解析规则”的场景。
 * 一旦命中，就把该会话标记为“不再解析路径”，避免在 zsh/sh 或自定义 prompt 下反复尝试。
 */
function looksLikeUnsupportedPrompt(line: string) {
  const trimmed = line.trimEnd();
  if (!trimmed) return false;
  if (!/[#$%]$/.test(trimmed)) return false;
  return (
    /(?:^|\s)(?:[^@\s]+@)?[^:\s]+:[^\s]+\s*%$/.test(trimmed) ||
    /(?:^|\s)(?:[^@\s]+@)?[^:\s]+:[^\s]+\s*[$#]$/.test(trimmed) ||
    /(?:^|\s)(?:[^@\s]+@)?[^:\s]+\s*[$#]$/.test(trimmed)
  );
}

function normalizeCommandCaptureLine(line: string) {
  return line.replace(/\u00a0/g, " ").trimEnd();
}

function looksLikePromptLine(line: string) {
  const trimmed = line.trimEnd();
  if (!trimmed) return false;
  return /[#$>%]\s*$/.test(trimmed);
}

/** Xterm 初始化与输入输出处理。 */
export default function useTerminalRuntime({
  theme,
  webLinksEnabled = true,
  selectionAutoCopyEnabled = false,
  scrollback = DEFAULT_TERMINAL_SCROLLBACK,
  cursorStyle = DEFAULT_TERMINAL_CURSOR_STYLE,
  resolveWordSeparators,
  activeSessionId,
  activeSession,
  sessions,
  onSizeChange,
  sessionStatesRef,
  sessionReasonsRef,
  sessionBuffersRef,
  setLastCommand,
  writeToSession,
  resizeSession,
  onWorkingDirectoryChange,
  onPathSyncSupportChange,
  isLocalSession,
  reconnectSession,
  reconnectLocalShell,
  onCommandCaptureChange,
  onCommandCommit,
  autocompleteProvider = null,
}: UseTerminalRuntimeProps): TerminalRuntime {
  const terminalsRef = useRef<Record<string, TerminalBundle>>({});
  const containersRef = useRef<Record<string, HTMLDivElement | null>>({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const observedSessionIdByElementRef = useRef<WeakMap<Element, string>>(
    new WeakMap(),
  );
  const lastResizedSizeRef = useRef<Record<string, string>>({});
  const activeSessionIdRef = useRef<string | null>(null);
  const xtermModulesRef = useRef<XtermModules | null>(null);
  const themeRef = useRef(theme);
  const webLinksEnabledRef = useRef(webLinksEnabled);
  const selectionAutoCopyEnabledRef = useRef(selectionAutoCopyEnabled);
  const resolveWordSeparatorsRef = useRef(resolveWordSeparators);
  const [searchStatsBySession, setSearchStatsBySession] = useState<
    Record<string, SearchStats | null>
  >({});
  const [linkMenu, setLinkMenu] = useState<LinkMenuState | null>(null);
  const [terminalReadyBySession, setTerminalReadyBySession] = useState<
    Record<string, boolean>
  >({});
  const [activeAutocomplete, setActiveAutocomplete] =
    useState<ActiveAutocompleteState | null>(null);
  const activeAutocompleteRef = useRef<ActiveAutocompleteState | null>(null);
  const focusedLineBySessionRef = useRef<Record<string, FocusedLineState>>({});
  const selectionAutoCopyTimerRef = useRef<Record<string, number>>({});
  const promptParseStateRef = useRef<Record<string, PromptParseState>>({});
  const workingDirectoryBySessionRef = useRef<Record<string, string>>({});
  const workingDirectoryUserBySessionRef = useRef<
    Record<string, string | null>
  >({});
  const disabledPromptParsingRef = useRef<Record<string, boolean>>({});
  const autocompleteInputBufferRef = useRef<Record<string, string>>({});
  const commandCaptureMetaRef = useRef<Record<string, CommandCaptureMeta>>({});
  const commandCaptureTimersRef = useRef<Record<string, number>>({});
  const activeCommandCaptureBySessionRef = useRef<
    Record<string, CommandHistoryLiveCapture>
  >({});
  const autocompleteProviderRef = useRef<CommandAutocompleteProvider | null>(
    autocompleteProvider,
  );
  const handlersRef = useRef({
    setLastCommand,
    writeToSession,
    resizeSession,
    onWorkingDirectoryChange,
    onPathSyncSupportChange,
    isLocalSession,
    reconnectSession,
    reconnectLocalShell,
    onCommandCaptureChange,
    onCommandCommit,
  });
  const parseWorkingDirectoryFromPromptRef = useRef(
    parseWorkingDirectoryFromPrompt,
  );
  const appendSessionBufferRef = useRef(appendSessionBuffer);
  const scheduleCommandCaptureRefreshRef = useRef(
    scheduleCommandCaptureRefresh,
  );
  const ensureTerminalRef = useRef(ensureTerminal);
  const observeTerminalContainerRef = useRef(observeTerminalContainer);
  const finalizeTerminalMountRef = useRef(finalizeTerminalMount);
  const disposeTerminalRef = useRef(disposeTerminal);

  const getTerminalSize = useMemo(
    () => () => {
      if (!activeSessionId) return { cols: 80, rows: 24 };
      const term = terminalsRef.current[activeSessionId]?.terminal;
      return { cols: term?.cols ?? 80, rows: term?.rows ?? 24 };
    },
    [activeSessionId],
  );

  async function loadXtermModules() {
    if (xtermModulesRef.current) return xtermModulesRef.current;
    const [
      xtermModule,
      fitModule,
      searchModule,
      unicode11Module,
      webLinksModule,
      webglModule,
    ] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-search").catch(() => null),
      import("@xterm/addon-unicode11").catch(() => null),
      import("@xterm/addon-web-links").catch(() => null),
      import("@xterm/addon-webgl").catch(() => null),
    ]);
    const modules: XtermModules = {
      Terminal: xtermModule.Terminal,
      FitAddon: fitModule.FitAddon,
      SearchAddon: searchModule?.SearchAddon ?? null,
      Unicode11Addon: unicode11Module?.Unicode11Addon ?? null,
      WebLinksAddon: webLinksModule?.WebLinksAddon ?? null,
      WebglAddon: webglModule?.WebglAddon ?? null,
    };
    xtermModulesRef.current = modules;
    return modules;
  }

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    webLinksEnabledRef.current = webLinksEnabled;
    if (!webLinksEnabled) {
      setLinkMenu(null);
    }
  }, [webLinksEnabled]);

  useEffect(() => {
    selectionAutoCopyEnabledRef.current = selectionAutoCopyEnabled;
  }, [selectionAutoCopyEnabled]);

  useEffect(() => {
    resolveWordSeparatorsRef.current = resolveWordSeparators;
  }, [resolveWordSeparators]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    autocompleteProviderRef.current = autocompleteProvider;
  }, [autocompleteProvider]);

  useEffect(() => {
    handlersRef.current = {
      setLastCommand,
      writeToSession,
      resizeSession,
      onWorkingDirectoryChange,
      onPathSyncSupportChange,
      isLocalSession,
      reconnectSession,
      reconnectLocalShell,
      onCommandCaptureChange,
      onCommandCommit,
    };
  }, [
    isLocalSession,
    reconnectLocalShell,
    reconnectSession,
    resizeSession,
    setLastCommand,
    onWorkingDirectoryChange,
    onPathSyncSupportChange,
    onCommandCaptureChange,
    onCommandCommit,
    writeToSession,
  ]);

  useEffect(() => {
    parseWorkingDirectoryFromPromptRef.current =
      parseWorkingDirectoryFromPrompt;
    appendSessionBufferRef.current = appendSessionBuffer;
    scheduleCommandCaptureRefreshRef.current = scheduleCommandCaptureRefresh;
    ensureTerminalRef.current = ensureTerminal;
    observeTerminalContainerRef.current = observeTerminalContainer;
    finalizeTerminalMountRef.current = finalizeTerminalMount;
    disposeTerminalRef.current = disposeTerminal;
  });

  useEffect(() => {
    activeAutocompleteRef.current = activeAutocomplete;
  }, [activeAutocomplete]);

  useEffect(() => {
    setActiveAutocomplete((prev) => {
      if (!prev) return null;
      return prev.sessionId === activeSessionId ? prev : null;
    });
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeAutocomplete) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".terminal-autocomplete")) return;
      setActiveAutocomplete(null);
    };
    const handleWindowBlur = () => {
      setActiveAutocomplete(null);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [activeAutocomplete]);

  /**
   * 刷新当前会话的联想候选。
   * 这里读取的是本地输入缓冲，不直接读取终端显示缓冲；
   * 真实命令采集仍以后面的输入行监听为准。
   */
  function refreshAutocomplete(sessionId: string, input: string) {
    autocompleteInputBufferRef.current[sessionId] = input;
    if (activeSessionIdRef.current !== sessionId) {
      setActiveAutocomplete((prev) =>
        prev?.sessionId === sessionId ? null : prev,
      );
      return;
    }
    const provider = autocompleteProviderRef.current;
    if (!provider) {
      setActiveAutocomplete(null);
      return;
    }
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      setActiveAutocomplete((prev) =>
        prev?.sessionId === sessionId ? null : prev,
      );
      return;
    }
    const meta = ensureCommandCaptureMeta(sessionId);
    if (meta.waitingForNextPrompt) {
      setActiveAutocomplete((prev) =>
        prev?.sessionId === sessionId ? null : prev,
      );
      return;
    }
    const items = provider
      .getSuggestions(input)
      .filter((item) => item.command.trim() !== normalizedInput);
    if (items.length === 0) {
      setActiveAutocomplete((prev) =>
        prev?.sessionId === sessionId ? null : prev,
      );
      return;
    }
    setActiveAutocomplete((prev) => {
      const selectedCommand =
        prev?.sessionId === sessionId
          ? prev.items[prev.selectedIndex]?.command
          : null;
      const nextIndex = selectedCommand
        ? items.findIndex((item) => item.command === selectedCommand)
        : -1;
      return {
        sessionId,
        input,
        items,
        selectedIndex: nextIndex >= 0 ? nextIndex : -1,
      };
    });
  }

  /** 获取或初始化当前会话的输入行监听元数据。 */
  function ensureCommandCaptureMeta(sessionId: string) {
    if (!commandCaptureMetaRef.current[sessionId]) {
      commandCaptureMetaRef.current[sessionId] = {
        promptPrefix: null,
        waitingForNextPrompt: false,
      };
    }
    return commandCaptureMetaRef.current[sessionId];
  }

  /** 读取当前光标所在 buffer 行的可见文本，用于实时输入行监听。 */
  function getCurrentCursorLineText(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return "";
    const line = bundle.terminal.buffer.active.getLine(
      getAbsoluteCursorLine(bundle.terminal),
    );
    return normalizeCommandCaptureLine(line?.translateToString(true) ?? "");
  }

  /** 向上层发布输入行监听状态；内容无变化时不重复派发。 */
  function publishCommandCapture(
    sessionId: string,
    capture: CommandHistoryLiveCapture,
  ) {
    const current = activeCommandCaptureBySessionRef.current[sessionId];
    if (
      current?.state === capture.state &&
      current.command === capture.command
    ) {
      return;
    }
    activeCommandCaptureBySessionRef.current[sessionId] = capture;
    handlersRef.current.onCommandCaptureChange?.(sessionId, capture);
  }

  /**
   * 从“当前光标行显示内容”里解析出输入中的命令文本。
   * 如果已经识别到 prompt 前缀，则只截取 prompt 后半段。
   */
  function resolveTrackedCommand(sessionId: string) {
    const meta = ensureCommandCaptureMeta(sessionId);
    const currentLine = getCurrentCursorLineText(sessionId);
    if (!currentLine) {
      return {
        promptPrefix: meta.promptPrefix,
        command: "",
      };
    }
    if (meta.promptPrefix && currentLine.startsWith(meta.promptPrefix)) {
      return {
        promptPrefix: meta.promptPrefix,
        command: currentLine.slice(meta.promptPrefix.length).trim(),
      };
    }
    return {
      promptPrefix: meta.promptPrefix,
      command: currentLine.trim(),
    };
  }

  /**
   * 刷新当前会话的输入行监听状态。
   * 生命周期：
   * 1. 空行显示 listening
   * 2. 有内容显示 tracking
   * 3. 回车后进入 waitingForNextPrompt，等待下一轮 prompt 出现
   */
  function refreshCommandCapture(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return;
    const meta = ensureCommandCaptureMeta(sessionId);
    const currentLine = getCurrentCursorLineText(sessionId);

    if (meta.waitingForNextPrompt) {
      if (looksLikePromptLine(currentLine)) {
        meta.promptPrefix = currentLine;
        meta.waitingForNextPrompt = false;
        publishCommandCapture(sessionId, {
          state: "listening",
          command: "",
          updatedAt: Date.now(),
        });
      }
      return;
    }

    if (!meta.promptPrefix || looksLikePromptLine(currentLine)) {
      meta.promptPrefix = currentLine;
    }

    const command = resolveTrackedCommand(sessionId).command;
    publishCommandCapture(sessionId, {
      state: command ? "tracking" : "listening",
      command,
      updatedAt: Date.now(),
    });
  }

  /** 对终端输出触发的输入行监听刷新做防抖，避免快速编辑时频繁抖动。 */
  function scheduleCommandCaptureRefresh(sessionId: string) {
    const currentTimer = commandCaptureTimersRef.current[sessionId];
    if (currentTimer) {
      window.clearTimeout(currentTimer);
    }
    commandCaptureTimersRef.current[sessionId] = window.setTimeout(() => {
      delete commandCaptureTimersRef.current[sessionId];
      refreshCommandCapture(sessionId);
    }, COMMAND_CAPTURE_DEBOUNCE_MS);
  }

  /**
   * 将联想候选写回当前会话输入行，但不直接提交执行。
   * 具体做法是回退当前本地输入缓冲长度，再写入选中的完整命令。
   */
  async function applyAutocompleteSuggestion(
    sessionId: string,
    command?: string,
  ) {
    const autocomplete =
      activeAutocompleteRef.current?.sessionId === sessionId
        ? activeAutocompleteRef.current
        : null;
    const selectedCommand =
      command ??
      (autocomplete && autocomplete.selectedIndex >= 0
        ? autocomplete.items[autocomplete.selectedIndex]?.command
        : null) ??
      null;
    if (!selectedCommand) return false;
    const currentInput = autocompleteInputBufferRef.current[sessionId] ?? "";
    const deleteSequence = "\u007f".repeat(currentInput.length);
    await handlersRef.current.writeToSession(
      sessionId,
      `${deleteSequence}${selectedCommand}`,
    );
    autocompleteInputBufferRef.current[sessionId] = selectedCommand;
    scheduleCommandCaptureRefresh(sessionId);
    setActiveAutocomplete(null);
    return true;
  }

  function syncTerminalSize(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return;
    safeFit(bundle.fitAddon, bundle.host);
    const sizeKey = `${bundle.terminal.cols}x${bundle.terminal.rows}`;
    if (lastResizedSizeRef.current[sessionId] === sizeKey) {
      return;
    }
    lastResizedSizeRef.current[sessionId] = sizeKey;
    handlersRef.current
      .resizeSession(sessionId, bundle.terminal.cols, bundle.terminal.rows)
      .catch(() => {});
  }

  function ensureResizeObserver() {
    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          const sessionId = observedSessionIdByElementRef.current.get(
            entry.target,
          );
          if (!sessionId) return;
          syncTerminalSize(sessionId);
        });
      });
    }
    return resizeObserverRef.current;
  }

  function observeTerminalContainer(
    container: HTMLDivElement | null,
    sessionId: string,
  ) {
    if (!sessionId) return;
    const observer = ensureResizeObserver();
    const previousContainer = observedContainersRef.current.get(sessionId);
    if (previousContainer && previousContainer !== container) {
      observer.unobserve(previousContainer);
      observedContainersRef.current.delete(sessionId);
    }
    if (!container) return;
    // 每个会话容器尺寸都可能因 split/折叠/切换区域而变化，必须各自独立观察。
    observedContainersRef.current.set(sessionId, container);
    observedSessionIdByElementRef.current.set(container, sessionId);
    observer.observe(container);
  }

  function writeToBundle(bundle: TerminalBundle, data: string) {
    bundle.terminal.write(data);
  }

  function appendSessionBuffer(sessionId: string, data: string) {
    const buffer = sessionBuffersRef.current[sessionId] ?? "";
    sessionBuffersRef.current[sessionId] = buffer + data;
  }

  /**
   * xterm 首次 mount 后，宿主容器尺寸、字体测量和 pane 布局可能还没稳定。
   * 这里统一做延迟 fit/focus/resize，避免把同类补丁散落到多个 effect。
   */
  function finalizeTerminalMount(sessionId: string, attempt = 0) {
    const latest = terminalsRef.current[sessionId];
    if (!latest) return;
    safeFit(latest.fitAddon, latest.host);
    const hostHeight = latest.host.clientHeight;
    const rows = latest.terminal.rows;
    const cols = latest.terminal.cols;
    const readyForUse = hostHeight > 24 && rows > 1 && cols > 1;

    if (!readyForUse && attempt < TERMINAL_MOUNT_RETRY_LIMIT) {
      window.requestAnimationFrame(() => {
        finalizeTerminalMount(sessionId, attempt + 1);
      });
      return;
    }

    if (activeSessionIdRef.current === sessionId) {
      if (!shouldPreserveFocusedElement()) {
        latest.terminal.focus();
      }
    }
    syncTerminalSize(sessionId);
  }

  function disposeFocusedLine(sessionId: string) {
    const focused = focusedLineBySessionRef.current[sessionId];
    if (!focused) return;
    focused.decoration?.dispose();
    focused.marker.dispose();
    delete focusedLineBySessionRef.current[sessionId];
  }

  function disposeSelectionAutoCopyTimer(sessionId: string) {
    const timer = selectionAutoCopyTimerRef.current[sessionId];
    if (timer === undefined) return;
    window.clearTimeout(timer);
    delete selectionAutoCopyTimerRef.current[sessionId];
  }

  function ensurePromptParseState(sessionId: string) {
    if (!promptParseStateRef.current[sessionId]) {
      promptParseStateRef.current[sessionId] = { carry: "" };
    }
    return promptParseStateRef.current[sessionId];
  }

  function disposePromptParseState(sessionId: string) {
    delete promptParseStateRef.current[sessionId];
    delete workingDirectoryBySessionRef.current[sessionId];
    delete workingDirectoryUserBySessionRef.current[sessionId];
    delete disabledPromptParsingRef.current[sessionId];
  }

  function maybePublishWorkingDirectory(
    sessionId: string,
    payload: { username: string | null; path: string },
  ) {
    const normalizedUser = payload.username?.trim() || null;
    const normalizedPath = payload.path.replace(/\r/g, "").trim();
    if (!normalizedPath) return;
    if (
      workingDirectoryBySessionRef.current[sessionId] === normalizedPath &&
      workingDirectoryUserBySessionRef.current[sessionId] === normalizedUser
    ) {
      return;
    }
    workingDirectoryBySessionRef.current[sessionId] = normalizedPath;
    workingDirectoryUserBySessionRef.current[sessionId] = normalizedUser;
    handlersRef.current.onPathSyncSupportChange?.(sessionId, "supported");
    // 终端运行时只负责上报“当前 prompt 用户 + prompt 路径”。
    // 是否允许继续驱动 SFTP，由上层再和 SSH 初始登录用户做一致性判断。
    handlersRef.current.onWorkingDirectoryChange?.(sessionId, {
      username: normalizedUser,
      path: normalizedPath,
    });
  }

  function disablePromptParsing(
    sessionId: string,
    sample: string,
    reason: "unsupported-shell-prompt",
  ) {
    if (disabledPromptParsingRef.current[sessionId]) return;
    disabledPromptParsingRef.current[sessionId] = true;
    handlersRef.current.onPathSyncSupportChange?.(sessionId, "unsupported");
    void warn(
      JSON.stringify({
        event: "terminal:cwd-sync-unsupported-prompt",
        sessionId,
        reason,
        promptSample: sample.slice(0, 200),
      }),
    );
  }

  /**
   * 这里只支持 bash 常见的绝对路径/家目录提示符。
   * 遇到 zsh、sh 或其他无法稳定反推出绝对路径的 prompt 时，当前会话只记一条日志，
   * 然后直接停止后续解析，避免重复匹配和刷日志。
   * 解析职责也刻意保持很窄：这里只负责从输出里提取“当前 prompt 用户 + 路径”，
   * 不在终端层直接判断 SFTP 是否还能安全联动，那个决策交给上层和 SSH 登录用户一起做。
   */
  function parseWorkingDirectoryFromPrompt(sessionId: string, data: string) {
    if (handlersRef.current.isLocalSession(sessionId)) return;
    if (disabledPromptParsingRef.current[sessionId]) return;
    const state = ensurePromptParseState(sessionId);
    // 先剥离 ANSI，再按“行 + 最后一段未闭合 prompt 缓冲”解析，
    // 兼容终端输出被拆成多个事件时的 prompt 拼接。
    const normalized = stripAnsiForPromptParsing(data).replace(/\r\n/g, "\n");
    const combined = `${state.carry}${normalized}`;
    const lines = combined.split(/\n|\r/);
    state.carry = lines.pop() ?? "";

    lines.forEach((line) => {
      const path = matchPromptPath(line);
      if (path) {
        maybePublishWorkingDirectory(sessionId, {
          username: matchPromptUsername(line),
          path,
        });
        return;
      }
      if (looksLikeUnsupportedPrompt(line)) {
        disablePromptParsing(sessionId, line, "unsupported-shell-prompt");
      }
    });

    const trailingPath = matchPromptPath(state.carry);
    if (trailingPath) {
      maybePublishWorkingDirectory(sessionId, {
        username: matchPromptUsername(state.carry),
        path: trailingPath,
      });
      return;
    }
    if (looksLikeUnsupportedPrompt(state.carry)) {
      disablePromptParsing(sessionId, state.carry, "unsupported-shell-prompt");
    }
  }

  function syncCursorBlink(sessionId: string, enabled: boolean) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return;
    if (bundle.terminal.options.cursorBlink === enabled) return;
    bundle.terminal.options.cursorBlink = enabled;
  }

  function getAbsoluteCursorLine(terminal: Terminal) {
    return terminal.buffer.active.baseY + terminal.buffer.active.cursorY;
  }

  /**
   * 为点击到的 buffer 行建立高亮装饰。
   * 如果点击的是当前提示符所在行，则保持光标闪烁；否则暂停闪烁，
   * 直到用户继续键盘输入，表示输入焦点仍在 shell prompt。
   * 这里按 xterm 的单个 buffer line 处理，不拼接自动折行后的可视分段。
   */
  function setFocusedLine(sessionId: string, line: number) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return false;
    const buffer = bundle.terminal.buffer.active;
    const targetLine = buffer.getLine(line);
    if (!targetLine) return false;

    disposeFocusedLine(sessionId);

    const marker = bundle.terminal.registerMarker(
      line - getAbsoluteCursorLine(bundle.terminal),
    );
    if (!marker || marker.isDisposed) {
      return false;
    }

    const isPromptLine = line === getAbsoluteCursorLine(bundle.terminal);
    // 当前输入行只保留“逻辑上的聚焦”，用于右键复制这一行，
    // 但不再铺背景高亮，避免用户输入命令时被装饰色干扰。
    const decoration = isPromptLine
      ? null
      : (bundle.terminal.registerDecoration({
          marker,
          x: 0,
          width: bundle.terminal.cols,
          height: 1,
          // 聚焦行使用更轻的独立冷灰色，避免与真实选区混淆，
          // 同时保持足够低的存在感，不压住提示符和输入文字的可读性。
          backgroundColor: "rgba(130, 146, 168, 0.18)",
          layer: "bottom",
        }) ?? null);

    if (decoration) {
      decoration.onRender((element) => {
        element.classList.add("terminal-focused-line-decoration");
      });
    }

    focusedLineBySessionRef.current[sessionId] = {
      line,
      marker,
      decoration,
    };
    syncCursorBlink(sessionId, isPromptLine);
    return true;
  }

  function resolveBufferLineFromPoint(bundle: TerminalBundle, clientY: number) {
    const rect = bundle.host.getBoundingClientRect();
    if (rect.height <= 0 || bundle.terminal.rows <= 0) return null;
    if (clientY < rect.top || clientY > rect.bottom) return null;
    const relativeY = clientY - rect.top;
    const rowHeight = rect.height / bundle.terminal.rows;
    if (rowHeight <= 0) return null;
    const viewportRow = Math.max(
      0,
      Math.min(bundle.terminal.rows - 1, Math.floor(relativeY / rowHeight)),
    );
    const bufferLine = bundle.terminal.buffer.active.viewportY + viewportRow;
    // 终端视口高度通常会大于“实际已有内容”的高度，尤其在会话刚连接或窗口较高时，
    // 提示符下面会出现尚未写入任何 buffer 内容的空白区域。
    // 这些空白区域不应被视为可聚焦行，因此这里把最大可命中的行限制在当前光标所在行。
    return Math.min(bufferLine, getAbsoluteCursorLine(bundle.terminal));
  }

  function getFocusedLineText(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    const focused = focusedLineBySessionRef.current[sessionId];
    if (!bundle || !focused) return null;
    const line = bundle.terminal.buffer.active.getLine(focused.line);
    if (!line) return null;
    return line.translateToString(true);
  }

  function buildTerminalLayout(container: HTMLDivElement) {
    container.innerHTML = "";
    const runtime = document.createElement("div");
    runtime.className = "terminal-runtime";

    const host = document.createElement("div");
    host.className = "terminal-xterm-host";

    runtime.append(host);
    container.append(runtime);
    return { host };
  }

  async function ensureTerminal(sessionId: string, container: HTMLDivElement) {
    if (terminalsRef.current[sessionId]) return;
    const modules = await loadXtermModules();
    if (terminalsRef.current[sessionId]) return;
    const { host } = buildTerminalLayout(container);
    const sessionWordSeparator = normalizeTerminalWordSeparators(
      resolveWordSeparatorsRef.current?.(sessionId),
    );
    const normalizedCursorStyle =
      normalizeTerminalCursorStyle(cursorStyle) ??
      DEFAULT_TERMINAL_CURSOR_STYLE;
    const term = new modules.Terminal({
      allowProposedApi: true,
      // 启用终端画布透明通道，使半透明主题背景可透出到底层应用背景图。
      allowTransparency: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: normalizedCursorStyle,
      scrollback,
      theme: themeRef.current,
      ...(sessionWordSeparator ? { wordSeparator: sessionWordSeparator } : {}),
    });
    const fit = new modules.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    let webglAddon: WebglAddon | null = null;
    // 半透明背景下禁用 WebGL，避免终端画布实色化导致与其它区域透明度不一致。
    const shouldUseWebgl = !hasTranslucentAlpha(themeRef.current.background);
    // 优先启用 WebGL 渲染；不可用时保持默认渲染路径，确保兼容性。
    if (modules.WebglAddon && shouldUseWebgl) {
      try {
        webglAddon = new modules.WebglAddon();
        term.loadAddon(webglAddon);
      } catch {
        webglAddon = null;
      }
    }
    let searchAddon: SearchAddon | null = null;
    if (modules.SearchAddon) {
      try {
        searchAddon = new modules.SearchAddon();
        term.loadAddon(searchAddon);
      } catch {
        searchAddon = null;
      }
    }
    let unicode11Addon: Unicode11Addon | null = null;
    if (modules.Unicode11Addon) {
      try {
        // 启用 Unicode 11 宽度表，改善 emoji/CJK 字符宽度与光标对齐。
        unicode11Addon = new modules.Unicode11Addon();
        term.loadAddon(unicode11Addon);
        term.unicode.activeVersion = "11";
      } catch {
        unicode11Addon = null;
      }
    }
    let webLinksAddon: WebLinksAddon | null = null;
    if (modules.WebLinksAddon) {
      try {
        // 终端检测到 URL 点击后，不再直接打开，而是记录点击位置并弹出操作菜单。
        webLinksAddon = new modules.WebLinksAddon((event, uri) => {
          event.preventDefault();
          if (!webLinksEnabledRef.current) return;
          setLinkMenu({
            sessionId,
            x: event.clientX,
            y: event.clientY,
            uri,
          });
        });
        term.loadAddon(webLinksAddon);
      } catch {
        webLinksAddon = null;
      }
    }

    const bundle: TerminalBundle = {
      terminal: term,
      fitAddon: fit,
      searchAddon,
      unicode11Addon,
      webLinksAddon,
      webglAddon,
      container,
      host,
      disposables: [],
    };

    bundle.disposables.push(
      term.onData((data) => {
        // 聚焦行只用于“查看/复制这一行”。
        // 一旦用户继续键盘输入，就恢复提示符光标闪烁，表示输入焦点仍在 shell prompt。
        if (focusedLineBySessionRef.current[sessionId]) {
          syncCursorBlink(sessionId, true);
        }
        const state = sessionStatesRef.current[sessionId];
        if (state === "disconnected") {
          const reason = sessionReasonsRef.current[sessionId];
          const requestReconnect = data.includes("\r") || data.includes("\n");
          if (reason === "exit" && requestReconnect) {
            if (handlersRef.current.isLocalSession(sessionId)) {
              handlersRef.current
                .reconnectLocalShell(sessionId)
                .catch(() => {});
            } else {
              handlersRef.current.reconnectSession(sessionId).catch(() => {});
            }
          }
          return;
        }
        const autocomplete = activeAutocompleteRef.current;
        const activeAutocomplete =
          autocomplete?.sessionId === sessionId ? autocomplete : null;
        const autocompleteInput =
          autocompleteInputBufferRef.current[sessionId] ?? "";
        const autocompleteReady =
          !!activeAutocomplete?.items.length &&
          !!autocompleteInput.trim() &&
          !ensureCommandCaptureMeta(sessionId).waitingForNextPrompt;
        if (autocompleteReady && (data === "\u001b[A" || data === "\u001b[B")) {
          setActiveAutocomplete((prev) => {
            if (!prev || prev.sessionId !== sessionId || !prev.items.length) {
              return prev;
            }
            let nextIndex: number;
            if (data === "\u001b[A") {
              nextIndex =
                prev.selectedIndex < 0
                  ? prev.items.length - 1
                  : (prev.selectedIndex - 1 + prev.items.length) %
                    prev.items.length;
            } else {
              nextIndex =
                prev.selectedIndex < 0
                  ? 0
                  : (prev.selectedIndex + 1) % prev.items.length;
            }
            return { ...prev, selectedIndex: nextIndex };
          });
          return;
        }
        if (autocompleteReady && (data === "\u001b[C" || data === "\u001b[D")) {
          setActiveAutocomplete(null);
          handlersRef.current.writeToSession(sessionId, data).catch(() => {});
          scheduleCommandCaptureRefresh(sessionId);
          return;
        }
        if (data === "\r" || data === "\n") {
          if (
            (activeAutocomplete?.selectedIndex ?? -1) >= 0 &&
            autocompleteReady
          ) {
            applyAutocompleteSuggestion(sessionId).catch(() => {});
            return;
          }
          const committedCommand =
            activeCommandCaptureBySessionRef.current[
              sessionId
            ]?.command.trim() || resolveTrackedCommand(sessionId).command;
          if (committedCommand) {
            handlersRef.current.setLastCommand(sessionId, committedCommand);
            handlersRef.current.onCommandCommit?.(sessionId, committedCommand);
          }
          ensureCommandCaptureMeta(sessionId).waitingForNextPrompt = true;
          publishCommandCapture(sessionId, {
            state: "listening",
            command: "",
            updatedAt: Date.now(),
          });
          const nextInput = updateCommandInputBuffer(
            autocompleteInputBufferRef.current[sessionId] ?? "",
            data,
          ).buffer;
          refreshAutocomplete(sessionId, nextInput);
          handlersRef.current.writeToSession(sessionId, data).catch(() => {});
          return;
        }
        if (data === "\u001b") {
          setActiveAutocomplete((prev) =>
            prev?.sessionId === sessionId ? null : prev,
          );
          // Esc 既要关闭联想面板，也必须透传到 PTY，保证 vim 等 TUI 能正确退出插入模式。
          handlersRef.current.writeToSession(sessionId, data).catch(() => {});
          scheduleCommandCaptureRefresh(sessionId);
          return;
        }
        const nextInput = updateCommandInputBuffer(
          autocompleteInputBufferRef.current[sessionId] ?? "",
          data,
        ).buffer;
        refreshAutocomplete(sessionId, nextInput);
        handlersRef.current.writeToSession(sessionId, data).catch(() => {});
        scheduleCommandCaptureRefresh(sessionId);
      }),
    );

    bundle.disposables.push(
      term.onSelectionChange(() => {
        disposeSelectionAutoCopyTimer(sessionId);
        if (!selectionAutoCopyEnabledRef.current) return;
        // 拖动选区时会连续触发选择变更，这里做短防抖，避免频繁覆盖系统剪贴板。
        selectionAutoCopyTimerRef.current[sessionId] = window.setTimeout(() => {
          delete selectionAutoCopyTimerRef.current[sessionId];
          const text = term.getSelection();
          if (!text) return;
          writeText(text).catch((error) => {
            void warn(
              JSON.stringify({
                event: "terminal:selection-auto-copy-failed",
                sessionId,
                textLength: text.length,
                error: extractErrorMessage(error),
              }),
            );
          });
        }, SELECTION_AUTO_COPY_DEBOUNCE_MS);
      }),
    );

    // 搜索插件结果变更时同步统计信息，供 UI 展示。
    if (searchAddon) {
      bundle.disposables.push(
        searchAddon.onDidChangeResults((event: ISearchResultChangeEvent) => {
          setSearchStatsBySession((prev) => ({
            ...prev,
            [sessionId]: {
              resultIndex: event.resultIndex,
              resultCount: event.resultCount,
              decorations: true,
            },
          }));
        }),
      );
    }

    terminalsRef.current[sessionId] = bundle;
    setTerminalReadyBySession((prev) => ({ ...prev, [sessionId]: true }));

    const bufferedData = sessionBuffersRef.current[sessionId];
    if (bufferedData) {
      writeToBundle(bundle, bufferedData);
    }

    // 首次挂载时，pane/header 布局和字体测量可能还没稳定。
    // 这里补一轮延迟 fit/focus，避免首个默认会话进入“active ready 但无法正常交互”的状态。
    window.requestAnimationFrame(() => {
      finalizeTerminalMount(sessionId);
      scheduleCommandCaptureRefresh(sessionId);
    });
  }

  function disposeTerminal(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return;
    const captureTimer = commandCaptureTimersRef.current[sessionId];
    if (captureTimer) {
      window.clearTimeout(captureTimer);
      delete commandCaptureTimersRef.current[sessionId];
    }
    delete commandCaptureMetaRef.current[sessionId];
    delete activeCommandCaptureBySessionRef.current[sessionId];
    disposeSelectionAutoCopyTimer(sessionId);
    disposeFocusedLine(sessionId);
    disposePromptParseState(sessionId);
    bundle.disposables.forEach((disposable) => disposable.dispose());
    bundle.terminal.dispose();
    delete terminalsRef.current[sessionId];
    delete containersRef.current[sessionId];
    delete lastResizedSizeRef.current[sessionId];
    setSearchStatsBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setTerminalReadyBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }

  // 依赖的工具函数会在运行时按会话状态重建，这里保持注册回调稳定避免反复重绑容器。
  const registerTerminalContainer = useCallback(
    (sessionId: string, element: HTMLDivElement | null) => {
      containersRef.current[sessionId] = element;
      if (element) {
        ensureTerminalRef.current(sessionId, element).catch(() => {});
        observeTerminalContainerRef.current(element, sessionId);
      } else {
        const observedContainer = observedContainersRef.current.get(sessionId);
        if (observedContainer && resizeObserverRef.current) {
          resizeObserverRef.current.unobserve(observedContainer);
        }
        observedContainersRef.current.delete(sessionId);
        disposeTerminalRef.current(sessionId);
      }
    },
    [],
  );

  // 终端输出监听需要维持单次注册，避免因函数 identity 变化而重复订阅。
  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | null = null;

    const registerListeners = async () => {
      const outputUnlisten = await registerTerminalOutputListener(
        ({ sessionId, data }) => {
          parseWorkingDirectoryFromPromptRef.current(sessionId, data);
          appendSessionBufferRef.current(sessionId, data);
          const bundle = terminalsRef.current[sessionId];
          if (bundle) {
            writeToBundle(bundle, data);
            scheduleCommandCaptureRefreshRef.current(sessionId);
          }
        },
      );
      if (cancelled) {
        try {
          outputUnlisten();
        } catch {
          // ignore listener teardown race
        }
        return;
      }
      teardown = outputUnlisten;
    };

    registerListeners().catch(() => {});

    return () => {
      cancelled = true;
      if (teardown) {
        try {
          teardown();
        } catch {
          // ignore listener teardown race
        }
      }
    };
  }, []);

  // 会话切换时需要立即观察并挂载活动终端，依赖按会话数据驱动即可。
  useEffect(() => {
    Object.values(terminalsRef.current).forEach((bundle) => {
      bundle.terminal.options.theme = theme;
    });
    if (!hasTranslucentAlpha(theme.background)) return;
    // 切换到半透明主题时释放 WebGL，回退默认渲染器以确保透明背景生效。
    Object.values(terminalsRef.current).forEach((bundle) => {
      if (!bundle.webglAddon) return;
      bundle.webglAddon.dispose();
      bundle.webglAddon = null;
    });
  }, [theme]);

  // 清理失效会话终端，避免随着 disposeTerminal identity 变化重复清理扫描。
  useEffect(() => {
    Object.values(terminalsRef.current).forEach((bundle) => {
      bundle.terminal.options.scrollback = scrollback;
    });
  }, [scrollback]);

  useEffect(() => {
    const normalizedCursorStyle =
      normalizeTerminalCursorStyle(cursorStyle) ??
      DEFAULT_TERMINAL_CURSOR_STYLE;
    Object.values(terminalsRef.current).forEach((bundle) => {
      bundle.terminal.options.cursorStyle = normalizedCursorStyle;
    });
  }, [cursorStyle]);

  useEffect(() => {
    if (!activeSessionId || !activeSession) return;
    observeTerminalContainerRef.current(
      terminalsRef.current[activeSessionId]?.container ?? null,
      activeSessionId,
    );
    finalizeTerminalMountRef.current(activeSessionId);
    const bundle = terminalsRef.current[activeSessionId];
    if (!bundle) return;
    onSizeChange?.({
      cols: bundle.terminal.cols,
      rows: bundle.terminal.rows,
    });
  }, [activeSession, activeSessionId, onSizeChange, terminalReadyBySession]);

  useEffect(() => {
    const activeIds = new Set(sessions.map((item) => item.sessionId));
    Object.keys(terminalsRef.current).forEach((sessionId) => {
      if (!activeIds.has(sessionId)) {
        disposeTerminalRef.current(sessionId);
      }
    });
  }, [sessions]);

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
      observedContainersRef.current.clear();
    },
    [],
  );

  function isTerminalReady(sessionId: string) {
    return !!terminalReadyBySession[sessionId];
  }

  function getActiveBundle() {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return null;
    return terminalsRef.current[sessionId] ?? null;
  }

  function getActiveTerminalStats() {
    const bundle = getActiveBundle();
    if (!bundle) {
      return {
        windowRows: 0,
        windowCols: 0,
        bufferLines: 0,
      };
    }
    // buffer 真实行数按“当前已经写到的最后一条 buffer 行”计算，
    // 它反映的是当前会话已经累计产生了多少行终端内容，而不是窗口可见高度。
    return {
      windowRows: bundle.terminal.rows,
      windowCols: bundle.terminal.cols,
      bufferLines: getAbsoluteCursorLine(bundle.terminal) + 1,
    };
  }

  function getSessionBufferText(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return sessionBuffersRef.current[sessionId] ?? null;
    const maxLine = getAbsoluteCursorLine(bundle.terminal);
    const lines: string[] = [];
    for (let lineIndex = 0; lineIndex <= maxLine; lineIndex += 1) {
      const line = bundle.terminal.buffer.active.getLine(lineIndex);
      lines.push(line ? line.translateToString(true) : "");
    }
    return lines.join("\n");
  }

  /** 获取当前终端的搜索统计信息（仅在开启高亮时可用）。 */
  function getActiveSearchStats() {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return null;
    const stats = searchStatsBySession[sessionId] ?? null;
    if (!stats?.decorations) return null;
    return { resultIndex: stats.resultIndex, resultCount: stats.resultCount };
  }

  /** 仅暴露当前活动会话的链接菜单，避免切换会话后串用旧菜单状态。 */
  function getActiveLinkMenu() {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return null;
    if (linkMenu?.sessionId !== sessionId) return null;
    return {
      x: linkMenu.x,
      y: linkMenu.y,
      uri: linkMenu.uri,
    };
  }

  function hasActiveSelection() {
    return !!getActiveBundle()?.terminal.getSelection();
  }

  function getActiveSelectionText() {
    return getActiveBundle()?.terminal.getSelection() ?? "";
  }

  function hasFocusedLine() {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return false;
    return !!focusedLineBySessionRef.current[sessionId];
  }

  function focusActiveTerminal() {
    const bundle = getActiveBundle();
    if (!bundle) return false;
    bundle.terminal.focus();
    return true;
  }

  function focusTerminalLineAtPoint(sessionId: string, clientY: number) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return false;
    const line = resolveBufferLineFromPoint(bundle, clientY);
    if (line === null) return false;
    return setFocusedLine(sessionId, line);
  }

  /** 复制当前聚焦的 buffer 行文本，供右键菜单在无选区时复用。 */
  async function copyActiveFocusedLine() {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return false;
    const text = getFocusedLineText(sessionId);
    if (text === null) return false;
    try {
      await writeText(text);
      return true;
    } catch (error) {
      void warn(
        JSON.stringify({
          event: "terminal:focused-line-copy-failed",
          sessionId,
          textLength: text.length,
          error: extractErrorMessage(error),
        }),
      );
      return false;
    }
  }

  async function copyActiveSelection() {
    const text = getActiveBundle()?.terminal.getSelection() ?? "";
    if (!text) return false;
    try {
      await writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /** 在默认浏览器中打开当前链接，并在操作结束后关闭菜单。 */
  async function openActiveLink() {
    const menu = getActiveLinkMenu();
    if (!menu?.uri) return false;
    try {
      await openUrl(menu.uri);
      return true;
    } catch {
      return false;
    } finally {
      setLinkMenu((current) =>
        current?.uri === menu.uri &&
        current.x === menu.x &&
        current.y === menu.y
          ? null
          : current,
      );
    }
  }

  /** 复制当前链接地址，并在操作结束后关闭菜单。 */
  async function copyActiveLink() {
    const menu = getActiveLinkMenu();
    if (!menu?.uri) return false;
    try {
      await writeText(menu.uri);
      return true;
    } catch {
      return false;
    } finally {
      setLinkMenu((current) =>
        current?.uri === menu.uri &&
        current.x === menu.x &&
        current.y === menu.y
          ? null
          : current,
      );
    }
  }

  /** 统一关闭当前活动会话的链接菜单，供外层点击或其他菜单打开时复用。 */
  function closeActiveLinkMenu() {
    const sessionId = activeSessionIdRef.current;
    setLinkMenu((current) => {
      if (!current) return null;
      if (!sessionId || current.sessionId === sessionId) {
        return null;
      }
      return current;
    });
  }

  async function pasteToActiveTerminal() {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return false;
    try {
      const text = await readText();
      if (!text) return false;
      await handlersRef.current.writeToSession(sessionId, text);
      return true;
    } catch {
      return false;
    }
  }

  function clearActiveTerminal() {
    const sessionId = activeSessionIdRef.current;
    const bundle = getActiveBundle();
    if (!bundle || !sessionId) return false;
    bundle.terminal.clear();
    sessionBuffersRef.current[sessionId] = "";
    return true;
  }

  /** 清理当前终端的搜索高亮与统计（关闭搜索栏或关闭高亮时调用）。 */
  function clearActiveSearchDecorations() {
    const bundle = getActiveBundle();
    const sessionId = activeSessionIdRef.current;
    if (!bundle || !sessionId) return;
    if (!bundle.searchAddon) return;
    bundle.searchAddon.clearDecorations();
    setSearchStatsBySession((prev) => ({
      ...prev,
      [sessionId]: null,
    }));
  }

  /** 使用搜索插件执行查找；插件不可用或异常时写日志并返回失败。 */
  function searchActiveTerminal(
    keyword: string,
    direction: SearchDirection,
    options?: ISearchOptions,
  ) {
    const bundle = getActiveBundle();
    const sessionId = activeSessionIdRef.current;
    const value = keyword.trim();
    if (!bundle || !sessionId || !value) return false;

    if (!bundle.searchAddon) {
      void warn(
        JSON.stringify({
          event: "terminal:search-addon-missing",
          sessionId,
          direction,
          keywordLength: value.length,
        }),
      );
      return false;
    }

    try {
      return direction === "next"
        ? bundle.searchAddon.findNext(value, options)
        : bundle.searchAddon.findPrevious(value, options);
    } catch (error) {
      void warn(
        JSON.stringify({
          event: "terminal:search-addon-failed",
          sessionId,
          direction,
          keywordLength: value.length,
          error: extractErrorMessage(error),
        }),
      );
      return false;
    }
  }

  function searchActiveTerminalNext(keyword: string, options?: ISearchOptions) {
    return searchActiveTerminal(keyword, "next", options);
  }

  function searchActiveTerminalPrev(keyword: string, options?: ISearchOptions) {
    return searchActiveTerminal(keyword, "prev", options);
  }

  function getActiveAutocomplete() {
    return activeAutocomplete;
  }

  function getActiveCommandCapture() {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return null;
    return (
      activeCommandCaptureBySessionRef.current[sessionId] ?? {
        state: "listening",
        command: "",
        updatedAt: 0,
      }
    );
  }

  /**
   * 计算联想浮层锚点。
   * 规则：
   * 1. 优先显示在 prompt 上方，空间不足时翻到下方
   * 2. 左侧起点尽量对齐当前光标列
   * 3. 始终保留 pane 内边距，避免浮层溢出
   */
  function getAutocompleteAnchor(sessionId: string): AutocompleteAnchor | null {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return null;
    const hostWidth = bundle.host.clientWidth;
    const hostHeight = bundle.host.clientHeight;
    const rows = bundle.terminal.rows;
    const cols = bundle.terminal.cols;
    if (hostWidth <= 0 || hostHeight <= 0 || rows <= 0 || cols <= 0) {
      return null;
    }
    const rowHeight = hostHeight / rows;
    const cellWidth = hostWidth / cols;
    if (rowHeight <= 0) return null;
    const cursorViewportRow = bundle.terminal.buffer.active.cursorY;
    const cursorViewportCol = bundle.terminal.buffer.active.cursorX;
    const lineTop = Math.max(0, cursorViewportRow * rowHeight);
    const promptBottom = Math.min(hostHeight, lineTop + rowHeight);
    const spaceAbove = Math.max(0, lineTop - 8);
    const spaceBelow = Math.max(0, hostHeight - promptBottom - 8);
    const preferredHeight = Math.max(
      AUTOCOMPLETE_MIN_PANEL_HEIGHT,
      rowHeight * AUTOCOMPLETE_VISIBLE_ITEMS + 16,
    );
    const horizontalGutter = 12;
    const preferredWidth = Math.min(320, Math.max(0, hostWidth - 24));
    const cursorLeft = horizontalGutter + cursorViewportCol * cellWidth;
    const maxLeft = Math.max(
      horizontalGutter,
      hostWidth - horizontalGutter - preferredWidth,
    );
    const left = Math.min(Math.max(horizontalGutter, cursorLeft), maxLeft);

    if (
      spaceAbove >= AUTOCOMPLETE_MIN_PANEL_HEIGHT ||
      spaceAbove >= spaceBelow
    ) {
      return {
        placement: "top",
        offset: Math.max(16, hostHeight - lineTop + 6),
        maxHeight: Math.max(AUTOCOMPLETE_MIN_PANEL_HEIGHT, spaceAbove),
        left,
      };
    }

    return {
      placement: "bottom",
      offset: Math.max(16, promptBottom + 6),
      maxHeight: Math.max(
        Math.min(
          preferredHeight,
          Math.max(spaceBelow, AUTOCOMPLETE_MIN_PANEL_HEIGHT),
        ),
        AUTOCOMPLETE_MIN_PANEL_HEIGHT,
      ),
      left,
    };
  }

  function getActiveAutocompleteAnchor() {
    if (!activeAutocomplete) return null;
    return getAutocompleteAnchor(activeAutocomplete.sessionId);
  }

  async function applyActiveAutocompleteSuggestion(command?: string) {
    if (!activeSessionIdRef.current) return false;
    return applyAutocompleteSuggestion(activeSessionIdRef.current, command);
  }

  function closeActiveAutocomplete() {
    setActiveAutocomplete(null);
  }

  return {
    registerTerminalContainer,
    isTerminalReady,
    getTerminalSize,
    getActiveTerminalStats,
    getSessionBufferText,
    getActiveSearchStats,
    getActiveLinkMenu,
    focusActiveTerminal,
    focusTerminalLineAtPoint,
    hasFocusedLine,
    copyActiveFocusedLine,
    hasActiveSelection,
    getActiveSelectionText,
    copyActiveSelection,
    openActiveLink,
    copyActiveLink,
    closeActiveLinkMenu,
    pasteToActiveTerminal,
    clearActiveTerminal,
    clearActiveSearchDecorations,
    searchActiveTerminalNext,
    searchActiveTerminalPrev,
    getActiveCommandCapture,
    getActiveAutocomplete,
    getActiveAutocompleteAnchor,
    applyActiveAutocompleteSuggestion,
    closeActiveAutocomplete,
  };
}
