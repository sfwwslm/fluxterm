/**
 * 终端运行时核心 Hook。
 * 职责：管理 xterm 生命周期、输入输出与搜索能力。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { warn } from "@tauri-apps/plugin-log";
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
import type { DisconnectReason, Session, SessionStateUi } from "@/types";
import { registerTerminalOutputListener } from "@/features/terminal/core/listeners";

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
  activeSessionId: string | null;
  activeSession: Session | null;
  sessions: Session[];
  onSizeChange?: (size: { cols: number; rows: number }) => void;
  sessionStatesRef: React.RefObject<Record<string, SessionStateUi>>;
  sessionReasonsRef: React.RefObject<Record<string, DisconnectReason>>;
  sessionBuffersRef: React.RefObject<Record<string, string>>;
  recordCommandInput: (sessionId: string, data: string) => void;
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
  };
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
  return (
    /(?:^|\s)(?:[^@\s]+@)?[^\s]+?\s+[^\s]+\s*%$/.test(trimmed) ||
    /(?:^|\s)(?:[^@\s]+@)?[^\s]+:[^\s]+\s*%$/.test(trimmed) ||
    /(?:^|\s)(?:[^@\s]+@)?[^\s]+\s*[$#]$/.test(trimmed)
  );
}

/** Xterm 初始化与输入输出处理。 */
export default function useTerminalRuntime({
  theme,
  webLinksEnabled = true,
  selectionAutoCopyEnabled = false,
  scrollback = 3000,
  activeSessionId,
  activeSession,
  sessions,
  onSizeChange,
  sessionStatesRef,
  sessionReasonsRef,
  sessionBuffersRef,
  recordCommandInput,
  writeToSession,
  resizeSession,
  onWorkingDirectoryChange,
  onPathSyncSupportChange,
  isLocalSession,
  reconnectSession,
  reconnectLocalShell,
}: UseTerminalRuntimeProps): TerminalRuntime {
  const terminalsRef = useRef<Record<string, TerminalBundle>>({});
  const containersRef = useRef<Record<string, HTMLDivElement | null>>({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastResizedSizeRef = useRef<Record<string, string>>({});
  const activeSessionIdRef = useRef<string | null>(null);
  const xtermModulesRef = useRef<XtermModules | null>(null);
  const themeRef = useRef(theme);
  const webLinksEnabledRef = useRef(webLinksEnabled);
  const selectionAutoCopyEnabledRef = useRef(selectionAutoCopyEnabled);
  const [searchStatsBySession, setSearchStatsBySession] = useState<
    Record<string, SearchStats | null>
  >({});
  const [linkMenu, setLinkMenu] = useState<LinkMenuState | null>(null);
  const [terminalReadyBySession, setTerminalReadyBySession] = useState<
    Record<string, boolean>
  >({});
  const focusedLineBySessionRef = useRef<Record<string, FocusedLineState>>({});
  const selectionAutoCopyTimerRef = useRef<Record<string, number>>({});
  const promptParseStateRef = useRef<Record<string, PromptParseState>>({});
  const workingDirectoryBySessionRef = useRef<Record<string, string>>({});
  const workingDirectoryUserBySessionRef = useRef<
    Record<string, string | null>
  >({});
  const disabledPromptParsingRef = useRef<Record<string, boolean>>({});
  const handlersRef = useRef({
    recordCommandInput,
    writeToSession,
    resizeSession,
    onWorkingDirectoryChange,
    onPathSyncSupportChange,
    isLocalSession,
    reconnectSession,
    reconnectLocalShell,
  });

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
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    handlersRef.current = {
      recordCommandInput,
      writeToSession,
      resizeSession,
      onWorkingDirectoryChange,
      onPathSyncSupportChange,
      isLocalSession,
      reconnectSession,
      reconnectLocalShell,
    };
  }, [
    isLocalSession,
    recordCommandInput,
    reconnectLocalShell,
    reconnectSession,
    resizeSession,
    onWorkingDirectoryChange,
    onPathSyncSupportChange,
    writeToSession,
  ]);

  function observeActiveContainer(
    container: HTMLDivElement | null,
    sessionId: string,
  ) {
    if (!container || !sessionId) return;
    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver(() => {
        const activeId = activeSessionIdRef.current;
        if (!activeId) return;
        const bundle = terminalsRef.current[activeId];
        if (!bundle) return;
        safeFit(bundle.fitAddon, bundle.host);
        const sizeKey = `${bundle.terminal.cols}x${bundle.terminal.rows}`;
        if (lastResizedSizeRef.current[activeId] !== sizeKey) {
          lastResizedSizeRef.current[activeId] = sizeKey;
          handlersRef.current
            .resizeSession(activeId, bundle.terminal.cols, bundle.terminal.rows)
            .catch(() => {});
        }
      });
    }
    resizeObserverRef.current.disconnect();
    resizeObserverRef.current.observe(container);
  }

  function writeToBundle(bundle: TerminalBundle, data: string) {
    bundle.terminal.write(data);
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
    warn(
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

    const decoration =
      bundle.terminal.registerDecoration({
        marker,
        x: 0,
        width: bundle.terminal.cols,
        height: 1,
        backgroundColor: "#2d4f85",
        layer: "bottom",
      }) ?? null;

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
    syncCursorBlink(sessionId, line === getAbsoluteCursorLine(bundle.terminal));
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
    const term = new modules.Terminal({
      allowProposedApi: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback,
      theme: themeRef.current,
    });
    const fit = new modules.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    safeFit(fit, host);
    let webglAddon: WebglAddon | null = null;
    // 优先启用 WebGL 渲染；不可用时保持默认渲染路径，确保兼容性。
    if (modules.WebglAddon) {
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
        handlersRef.current.recordCommandInput(sessionId, data);
        handlersRef.current.writeToSession(sessionId, data).catch(() => {});
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
            warn(
              JSON.stringify({
                event: "terminal:selection-auto-copy-failed",
                sessionId,
                textLength: text.length,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          });
        }, 120);
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

    // 新建或重建当前激活会话时立即聚焦，避免回车重连后需要鼠标点击。
    if (
      activeSessionIdRef.current === sessionId &&
      !shouldPreserveFocusedElement()
    ) {
      bundle.terminal.focus();
    }

    const bufferedData = sessionBuffersRef.current[sessionId];
    if (bufferedData) {
      writeToBundle(bundle, bufferedData);
      delete sessionBuffersRef.current[sessionId];
    }
  }

  function disposeTerminal(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return;
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

  const registerTerminalContainer = useCallback(
    (sessionId: string, element: HTMLDivElement | null) => {
      containersRef.current[sessionId] = element;
      if (element) {
        ensureTerminal(sessionId, element).catch(() => {});
        if (sessionId === activeSessionIdRef.current) {
          observeActiveContainer(element, sessionId);
        }
      } else {
        disposeTerminal(sessionId);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | null = null;

    const registerListeners = async () => {
      const outputUnlisten = await registerTerminalOutputListener(
        ({ sessionId, data }) => {
          parseWorkingDirectoryFromPrompt(sessionId, data);
          const bundle = terminalsRef.current[sessionId];
          if (bundle) {
            writeToBundle(bundle, data);
          } else {
            const buffer = sessionBuffersRef.current[sessionId] ?? "";
            sessionBuffersRef.current[sessionId] = buffer + data;
          }
        },
      );
      if (cancelled) {
        outputUnlisten();
        return;
      }
      teardown = outputUnlisten;
    };

    registerListeners().catch(() => {});

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [sessionBuffersRef]);

  useEffect(() => {
    Object.values(terminalsRef.current).forEach((bundle) => {
      bundle.terminal.options.theme = theme;
    });
  }, [theme]);

  useEffect(() => {
    Object.values(terminalsRef.current).forEach((bundle) => {
      bundle.terminal.options.scrollback = scrollback;
    });
  }, [scrollback]);

  useEffect(() => {
    if (!activeSessionId) return;
    const bundle = terminalsRef.current[activeSessionId];
    if (!bundle) return;
    safeFit(bundle.fitAddon, bundle.host);
    // 会话切换/重连替换后，主动恢复焦点到当前终端实例。
    if (!shouldPreserveFocusedElement()) {
      bundle.terminal.focus();
    }
    if (!activeSession) return;
    onSizeChange?.({
      cols: bundle.terminal.cols,
      rows: bundle.terminal.rows,
    });
    const sizeKey = `${bundle.terminal.cols}x${bundle.terminal.rows}`;
    if (lastResizedSizeRef.current[activeSession.sessionId] !== sizeKey) {
      lastResizedSizeRef.current[activeSession.sessionId] = sizeKey;
      resizeSession(
        activeSession.sessionId,
        bundle.terminal.cols,
        bundle.terminal.rows,
      ).catch(() => {});
    }
    observeActiveContainer(bundle.container, activeSessionId);
  }, [activeSession, activeSessionId, onSizeChange, resizeSession]);

  useEffect(() => {
    const activeIds = new Set(sessions.map((item) => item.sessionId));
    Object.keys(terminalsRef.current).forEach((sessionId) => {
      if (!activeIds.has(sessionId)) {
        disposeTerminal(sessionId);
      }
    });
  }, [sessions]);

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
      };
    }
    return {
      windowRows: bundle.terminal.rows,
      windowCols: bundle.terminal.cols,
    };
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
      warn(
        JSON.stringify({
          event: "terminal:focused-line-copy-failed",
          sessionId,
          textLength: text.length,
          error: error instanceof Error ? error.message : String(error),
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
    const bundle = getActiveBundle();
    if (!bundle) return false;
    bundle.terminal.clear();
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
      warn(
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
      warn(
        JSON.stringify({
          event: "terminal:search-addon-failed",
          sessionId,
          direction,
          keywordLength: value.length,
          error: error instanceof Error ? error.message : String(error),
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

  return {
    registerTerminalContainer,
    isTerminalReady,
    getTerminalSize,
    getActiveTerminalStats,
    getActiveSearchStats,
    getActiveLinkMenu,
    focusActiveTerminal,
    focusTerminalLineAtPoint,
    hasFocusedLine,
    copyActiveFocusedLine,
    hasActiveSelection,
    copyActiveSelection,
    openActiveLink,
    copyActiveLink,
    closeActiveLinkMenu,
    pasteToActiveTerminal,
    clearActiveTerminal,
    clearActiveSearchDecorations,
    searchActiveTerminalNext,
    searchActiveTerminalPrev,
  };
}
