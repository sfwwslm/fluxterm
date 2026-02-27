/**
 * 终端运行时核心 Hook。
 * 职责：管理 xterm 生命周期、输入输出、gutter 与搜索能力。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { warn } from "@tauri-apps/plugin-log";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type {
  ISearchOptions,
  ISearchResultChangeEvent,
  SearchAddon,
} from "@xterm/addon-search";
import type { WebLinksAddon } from "@xterm/addon-web-links";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { DisconnectReason, Session, SessionStateUi } from "@/types";
import {
  formatGutterTime,
  resolveCellHeight,
  shouldResetLineNumbering,
} from "@/features/terminal/core/gutter";
import { registerTerminalOutputListener } from "@/features/terminal/core/listeners";

type TerminalTheme = {
  background: string;
  foreground: string;
  selectionBackground: string;
  cursor: string;
};

type UseTerminalRuntimeProps = {
  theme: TerminalTheme;
  /** TODO: 后续从用户设置读取并传入终端 scrollback 配置。 */
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
    logicalLineCount: number;
    currentLogicalLineCharCount: number;
  };
  getActiveSearchStats: () => {
    resultIndex: number;
    resultCount: number;
  } | null;
  focusActiveTerminal: () => boolean;
  hasActiveSelection: () => boolean;
  copyActiveSelection: () => Promise<boolean>;
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
  WebLinksAddon: typeof import("@xterm/addon-web-links").WebLinksAddon | null;
  WebglAddon: typeof import("@xterm/addon-webgl").WebglAddon | null;
};

type Disposable = { dispose: () => void };

type LineMeta = {
  timestamp: number;
};

type GutterRowNodes = {
  root: HTMLDivElement;
  time: HTMLSpanElement;
  line: HTMLSpanElement;
};

type TerminalBundle = {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon | null;
  webLinksAddon: WebLinksAddon | null;
  webglAddon: WebglAddon | null;
  container: HTMLDivElement;
  host: HTMLDivElement;
  gutter: HTMLDivElement;
  gutterTopSpacer: HTMLDivElement;
  gutterBottomSpacer: HTMLDivElement;
  gutterRows: GutterRowNodes[];
  gutterRowHeight: number;
  gutterPaddingTop: number;
  gutterPaddingBottom: number;
  gutterRefreshRafId: number | null;
  disposables: Disposable[];
  logicalLineIndexByRow: number[];
  logicalLineStartByRow: boolean[];
  logicalLineCount: number;
  nextLineNumber: number;
  lineMetaByLogicalIndex: Map<number, LineMeta>;
};

type SearchDirection = "next" | "prev";

type SearchStats = {
  resultIndex: number;
  resultCount: number;
  decorations: boolean;
};

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

/** Xterm 初始化与输入输出处理。 */
export default function useTerminalRuntime({
  theme,
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
  const [searchStatsBySession, setSearchStatsBySession] = useState<
    Record<string, SearchStats | null>
  >({});
  const [terminalReadyBySession, setTerminalReadyBySession] = useState<
    Record<string, boolean>
  >({});
  const handlersRef = useRef({
    recordCommandInput,
    writeToSession,
    resizeSession,
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
    const [xtermModule, fitModule, searchModule, webLinksModule, webglModule] =
      await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-search").catch(() => null),
        import("@xterm/addon-web-links").catch(() => null),
        import("@xterm/addon-webgl").catch(() => null),
      ]);
    const modules: XtermModules = {
      Terminal: xtermModule.Terminal,
      FitAddon: fitModule.FitAddon,
      SearchAddon: searchModule?.SearchAddon ?? null,
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
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    handlersRef.current = {
      recordCommandInput,
      writeToSession,
      resizeSession,
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
        scheduleRefreshGutter(bundle);
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

  function rebuildLogicalLines(bundle: TerminalBundle) {
    const buffer = bundle.terminal.buffer.active;
    const nextIndexByRow = new Array<number>(buffer.length);
    const nextStartByRow = new Array<boolean>(buffer.length);
    const cursorRow = buffer.baseY + buffer.cursorY;
    let lastNonEmptyRow = -1;
    for (let row = 0; row < buffer.length; row += 1) {
      const line = buffer.getLine(row);
      if (!line) continue;
      if (line.translateToString(true).length > 0) {
        lastNonEmptyRow = row;
      }
    }
    const maxRelevantRow = Math.max(cursorRow, lastNonEmptyRow);
    let logicalIndex = 0;
    for (let row = 0; row < buffer.length; row += 1) {
      const line = buffer.getLine(row);
      if (!line) {
        nextIndexByRow[row] = logicalIndex;
        nextStartByRow[row] = false;
        continue;
      }
      const start = !line.isWrapped;
      const relevantStart = start && row <= maxRelevantRow;
      if (relevantStart) logicalIndex += 1;
      nextIndexByRow[row] = logicalIndex;
      nextStartByRow[row] = relevantStart;
    }
    bundle.logicalLineIndexByRow = nextIndexByRow;
    bundle.logicalLineStartByRow = nextStartByRow;
    bundle.logicalLineCount = logicalIndex;
  }

  function addMissingCurrentLineMeta(
    bundle: TerminalBundle,
    timestamp: number,
  ) {
    const buffer = bundle.terminal.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    const logicalIndex = bundle.logicalLineIndexByRow[cursorRow];
    if (!logicalIndex) return;
    if (bundle.lineMetaByLogicalIndex.has(logicalIndex)) return;
    bundle.lineMetaByLogicalIndex.set(logicalIndex, {
      timestamp,
    });
    bundle.nextLineNumber += 1;
  }

  function updateMetaAfterWrite(bundle: TerminalBundle, timestamp: number) {
    const previousCount = bundle.logicalLineCount;
    rebuildLogicalLines(bundle);
    if (bundle.logicalLineCount > previousCount) {
      for (
        let index = previousCount + 1;
        index <= bundle.logicalLineCount;
        index += 1
      ) {
        bundle.lineMetaByLogicalIndex.set(index, {
          timestamp,
        });
        bundle.nextLineNumber += 1;
      }
      return;
    }
    addMissingCurrentLineMeta(bundle, timestamp);
  }

  function resetLineNumberingState(bundle: TerminalBundle) {
    bundle.logicalLineIndexByRow = [];
    bundle.logicalLineStartByRow = [];
    bundle.logicalLineCount = 0;
    bundle.nextLineNumber = 1;
    bundle.lineMetaByLogicalIndex.clear();
  }

  /** 创建并返回一行可复用的 gutter 节点。 */
  function createGutterRowNode() {
    const root = document.createElement("div");
    root.className = "terminal-gutter-row";
    const time = document.createElement("span");
    time.className = "terminal-gutter-time";
    const line = document.createElement("span");
    line.className = "terminal-gutter-line";
    root.append(time, line);
    return { root, time, line };
  }

  /** 按可视行数扩缩 gutter 行节点，避免每次刷新重建整棵 DOM。 */
  function ensureGutterRows(bundle: TerminalBundle, rowCount: number) {
    const current = bundle.gutterRows.length;
    if (current < rowCount) {
      for (let index = current; index < rowCount; index += 1) {
        const nodes = createGutterRowNode();
        bundle.gutterRows.push(nodes);
        bundle.gutter.insertBefore(nodes.root, bundle.gutterBottomSpacer);
      }
      return;
    }
    if (current > rowCount) {
      for (let index = current - 1; index >= rowCount; index -= 1) {
        const nodes = bundle.gutterRows[index];
        nodes.root.remove();
      }
      bundle.gutterRows.length = rowCount;
    }
  }

  /** 将 gutter 刷新合并到下一帧，降低高频输出时的重复渲染。 */
  function scheduleRefreshGutter(bundle: TerminalBundle) {
    if (bundle.gutterRefreshRafId !== null) return;
    bundle.gutterRefreshRafId = window.requestAnimationFrame(() => {
      bundle.gutterRefreshRafId = null;
      refreshGutter(bundle);
    });
  }

  /** 增量更新 gutter 内容与尺寸，不再使用 innerHTML 全量重建。 */
  function refreshGutter(bundle: TerminalBundle) {
    const { terminal, gutter, host } = bundle;
    const buffer = terminal.buffer.active;
    const rowCount = Math.max(terminal.rows, 1);
    // 绝对对齐关键点 1：读取 .xterm-screen 的上下 padding，
    // gutter 必须使用同样的上下留白，否则首末行会错位。
    const screen = host.querySelector(".xterm-screen") as HTMLDivElement | null;
    const style = screen ? window.getComputedStyle(screen) : null;
    const paddingTop = style ? Number.parseFloat(style.paddingTop) || 0 : 0;
    const paddingBottom = style
      ? Number.parseFloat(style.paddingBottom) || 0
      : 0;
    const screenHeight = screen?.clientHeight ?? host.clientHeight;
    const contentHeight = Math.max(
      screenHeight - paddingTop - paddingBottom,
      0,
    );
    const measuredRowHeight = contentHeight > 0 ? contentHeight / rowCount : 16;
    const cellHeight = resolveCellHeight(terminal);
    // 绝对对齐关键点 2：优先使用 xterm 内部 cell.height，
    // 避免由于 CSS 缩放、DPI、像素舍入导致的累计误差。
    const rowHeight = cellHeight > 0 ? cellHeight : measuredRowHeight;
    // 根据当前最大行号位数动态扩展 gutter 宽度，避免时间与行号拥挤。
    const maxLineNumber = Math.max(1, bundle.nextLineNumber - 1);
    const lineDigits = String(maxLineNumber).length;
    gutter.style.setProperty("--terminal-gutter-line-ch", String(lineDigits));
    ensureGutterRows(bundle, rowCount);
    if (bundle.gutterPaddingTop !== paddingTop) {
      bundle.gutterTopSpacer.style.height = `${paddingTop}px`;
      bundle.gutterPaddingTop = paddingTop;
    }
    if (bundle.gutterPaddingBottom !== paddingBottom) {
      bundle.gutterBottomSpacer.style.height = `${paddingBottom}px`;
      bundle.gutterPaddingBottom = paddingBottom;
    }
    if (bundle.gutterRowHeight !== rowHeight) {
      for (const row of bundle.gutterRows) {
        row.root.style.height = `${rowHeight}px`;
        row.root.style.lineHeight = `${rowHeight}px`;
      }
      bundle.gutterRowHeight = rowHeight;
    }

    const viewportY = buffer.viewportY;
    for (let viewRow = 0; viewRow < rowCount; viewRow += 1) {
      const rowNode = bundle.gutterRows[viewRow];
      const bufferRow = viewportY + viewRow;
      const bufferLine = buffer.getLine(bufferRow);
      const isLogicalStart = bundle.logicalLineStartByRow[bufferRow];
      const logicalIndex = bundle.logicalLineIndexByRow[bufferRow];
      const lineMeta = bundle.lineMetaByLogicalIndex.get(logicalIndex) ?? null;
      const wrappedContinuation =
        !!bufferLine && bufferLine.isWrapped && !isLogicalStart && !!lineMeta;
      const meta = isLogicalStart ? lineMeta : null;
      const timeText = meta
        ? formatGutterTime(meta.timestamp)
        : wrappedContinuation && lineMeta
          ? formatGutterTime(lineMeta.timestamp)
          : "";
      const lineText = meta
        ? String(logicalIndex)
        : wrappedContinuation
          ? "-"
          : "";
      rowNode.time.textContent = timeText;
      rowNode.line.textContent = lineText;
    }
  }

  function writeToBundle(
    bundle: TerminalBundle,
    data: string,
    timestamp: number,
  ) {
    if (shouldResetLineNumbering(data)) {
      // 兼容用户在 shell 中执行 clear：在处理清屏序列前先重置编号状态。
      resetLineNumberingState(bundle);
    }
    bundle.terminal.write(data, () => {
      updateMetaAfterWrite(bundle, timestamp);
      scheduleRefreshGutter(bundle);
    });
  }

  function buildTerminalLayout(container: HTMLDivElement) {
    container.innerHTML = "";
    const runtime = document.createElement("div");
    runtime.className = "terminal-runtime";

    const gutter = document.createElement("div");
    gutter.className = "terminal-gutter";

    const host = document.createElement("div");
    host.className = "terminal-xterm-host";

    runtime.append(gutter, host);
    container.append(runtime);
    const gutterTopSpacer = document.createElement("div");
    gutterTopSpacer.className = "terminal-gutter-spacer";
    const gutterBottomSpacer = document.createElement("div");
    gutterBottomSpacer.className = "terminal-gutter-spacer";
    gutter.append(gutterTopSpacer, gutterBottomSpacer);
    return { host, gutter, gutterTopSpacer, gutterBottomSpacer };
  }

  async function ensureTerminal(sessionId: string, container: HTMLDivElement) {
    if (terminalsRef.current[sessionId]) return;
    const modules = await loadXtermModules();
    if (terminalsRef.current[sessionId]) return;
    const { host, gutter, gutterTopSpacer, gutterBottomSpacer } =
      buildTerminalLayout(container);
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
    let webLinksAddon: WebLinksAddon | null = null;
    if (modules.WebLinksAddon) {
      try {
        // 将终端中识别到的 URL 交给 Tauri opener 打开，保持桌面端默认打开行为。
        webLinksAddon = new modules.WebLinksAddon((event, uri) => {
          event.preventDefault();
          openUrl(uri).catch(() => {});
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
      webLinksAddon,
      webglAddon,
      container,
      host,
      gutter,
      gutterTopSpacer,
      gutterBottomSpacer,
      gutterRows: [],
      gutterRowHeight: 0,
      gutterPaddingTop: -1,
      gutterPaddingBottom: -1,
      gutterRefreshRafId: null,
      disposables: [],
      logicalLineIndexByRow: [],
      logicalLineStartByRow: [],
      logicalLineCount: 0,
      nextLineNumber: 1,
      lineMetaByLogicalIndex: new Map(),
    };
    rebuildLogicalLines(bundle);
    refreshGutter(bundle);

    bundle.disposables.push(
      term.onData((data) => {
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
      term.onScroll(() => {
        scheduleRefreshGutter(bundle);
      }),
    );

    bundle.disposables.push(
      term.onRender(() => {
        scheduleRefreshGutter(bundle);
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
      writeToBundle(bundle, bufferedData, Date.now());
      delete sessionBuffersRef.current[sessionId];
      return;
    }

    // 为新会话的首行（如 shell prompt）预留行号与时间。
    addMissingCurrentLineMeta(bundle, Date.now());
    scheduleRefreshGutter(bundle);
  }

  function disposeTerminal(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return;
    if (bundle.gutterRefreshRafId !== null) {
      window.cancelAnimationFrame(bundle.gutterRefreshRafId);
      bundle.gutterRefreshRafId = null;
    }
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
          const bundle = terminalsRef.current[sessionId];
          if (bundle) {
            writeToBundle(bundle, data, Date.now());
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
    if (!activeSessionId) return;
    const bundle = terminalsRef.current[activeSessionId];
    if (!bundle) return;
    safeFit(bundle.fitAddon, bundle.host);
    scheduleRefreshGutter(bundle);
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
  }, [activeSession, activeSessionId, resizeSession]);

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
        logicalLineCount: 0,
        currentLogicalLineCharCount: 0,
      };
    }
    rebuildLogicalLines(bundle);
    const buffer = bundle.terminal.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    let startRow = cursorRow;
    while (startRow > 0) {
      const line = buffer.getLine(startRow);
      if (!line?.isWrapped) break;
      startRow -= 1;
    }
    let endRow = cursorRow;
    while (endRow + 1 < buffer.length) {
      const nextLine = buffer.getLine(endRow + 1);
      if (!nextLine?.isWrapped) break;
      endRow += 1;
    }
    let merged = "";
    for (let row = startRow; row <= endRow; row += 1) {
      merged += buffer.getLine(row)?.translateToString(true) ?? "";
    }
    return {
      windowRows: bundle.terminal.rows,
      windowCols: bundle.terminal.cols,
      logicalLineCount: bundle.logicalLineCount,
      currentLogicalLineCharCount: Array.from(merged).length,
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

  function hasActiveSelection() {
    return !!getActiveBundle()?.terminal.getSelection();
  }

  function focusActiveTerminal() {
    const bundle = getActiveBundle();
    if (!bundle) return false;
    bundle.terminal.focus();
    return true;
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
    resetLineNumberingState(bundle);
    rebuildLogicalLines(bundle);
    addMissingCurrentLineMeta(bundle, Date.now());
    scheduleRefreshGutter(bundle);
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
    focusActiveTerminal,
    hasActiveSelection,
    copyActiveSelection,
    pasteToActiveTerminal,
    clearActiveTerminal,
    clearActiveSearchDecorations,
    searchActiveTerminalNext,
    searchActiveTerminalPrev,
  };
}
