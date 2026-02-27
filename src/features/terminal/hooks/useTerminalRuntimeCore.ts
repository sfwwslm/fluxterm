/**
 * 终端运行时核心 Hook。
 * 职责：管理 xterm 生命周期、输入输出、gutter 与搜索能力。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { DisconnectReason, Session, SessionStateUi } from "@/types";
import {
  formatGutterTime,
  resolveCellHeight,
  shouldResetLineNumbering,
} from "@/features/terminal/core/gutter";
import { findInTerminal } from "@/features/terminal/core/search";
import { registerTerminalOutputListener } from "@/features/terminal/core/listeners";

type TerminalTheme = {
  background: string;
  foreground: string;
  selectionBackground: string;
  cursor: string;
};

type UseTerminalRuntimeProps = {
  theme: TerminalTheme;
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
  hasActiveSelection: () => boolean;
  copyActiveSelection: () => Promise<boolean>;
  pasteToActiveTerminal: () => Promise<boolean>;
  clearActiveTerminal: () => boolean;
  searchActiveTerminalNext: (keyword: string) => boolean;
  searchActiveTerminalPrev: (keyword: string) => boolean;
};

type XtermModules = {
  Terminal: typeof import("@xterm/xterm").Terminal;
  FitAddon: typeof import("@xterm/addon-fit").FitAddon;
};

type Disposable = { dispose: () => void };

type LineMeta = {
  number: number;
  timestamp: number;
};

type TerminalBundle = {
  terminal: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
  host: HTMLDivElement;
  gutter: HTMLDivElement;
  disposables: Disposable[];
  logicalLineIndexByRow: number[];
  logicalLineStartByRow: boolean[];
  logicalLineCount: number;
  nextLineNumber: number;
  lineMetaByLogicalIndex: Map<number, LineMeta>;
};

type SearchDirection = "next" | "prev";

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
  const activeSessionIdRef = useRef<string | null>(null);
  const xtermModulesRef = useRef<XtermModules | null>(null);
  const themeRef = useRef(theme);
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
  const searchStateRef = useRef<{
    sessionId: string;
    keyword: string;
    row: number;
    col: number;
  } | null>(null);

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
        refreshGutter(bundle);
        handlersRef.current
          .resizeSession(activeId, bundle.terminal.cols, bundle.terminal.rows)
          .catch(() => {});
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
      number: bundle.nextLineNumber,
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
          number: bundle.nextLineNumber,
          timestamp,
        });
        bundle.nextLineNumber += 1;
      }
    } else {
      addMissingCurrentLineMeta(bundle, timestamp);
    }
  }

  function resetLineNumberingState(bundle: TerminalBundle) {
    bundle.logicalLineIndexByRow = [];
    bundle.logicalLineStartByRow = [];
    bundle.logicalLineCount = 0;
    bundle.nextLineNumber = 1;
    bundle.lineMetaByLogicalIndex.clear();
  }

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
    const viewportY = buffer.viewportY;
    let html = "";
    // 绝对对齐关键点 3：顶部 spacer 与 xterm 的 paddingTop 保持一致。
    if (paddingTop > 0) {
      html += `<div class="terminal-gutter-spacer" style="height:${paddingTop}px;"></div>`;
    }
    for (let viewRow = 0; viewRow < rowCount; viewRow += 1) {
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
        ? String(meta.number)
        : wrappedContinuation
          ? "-"
          : "";
      html +=
        `<div class="terminal-gutter-row" style="height:${rowHeight}px;line-height:${rowHeight}px;">` +
        `<span class="terminal-gutter-time">${timeText}</span>` +
        `<span class="terminal-gutter-line">${lineText}</span>` +
        `</div>`;
    }
    // 绝对对齐关键点 4：底部 spacer 与 xterm 的 paddingBottom 保持一致。
    if (paddingBottom > 0) {
      html += `<div class="terminal-gutter-spacer" style="height:${paddingBottom}px;"></div>`;
    }
    gutter.innerHTML = html;
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
      refreshGutter(bundle);
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
    return { host, gutter };
  }

  async function ensureTerminal(sessionId: string, container: HTMLDivElement) {
    if (terminalsRef.current[sessionId]) return;
    const modules = await loadXtermModules();
    if (terminalsRef.current[sessionId]) return;
    const { host, gutter } = buildTerminalLayout(container);
    const term = new modules.Terminal({
      allowProposedApi: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: themeRef.current,
    });
    const fit = new modules.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    safeFit(fit, host);

    const bundle: TerminalBundle = {
      terminal: term,
      fitAddon: fit,
      container,
      host,
      gutter,
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
        refreshGutter(bundle);
      }),
    );

    bundle.disposables.push(
      term.onRender(() => {
        refreshGutter(bundle);
      }),
    );

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
    refreshGutter(bundle);
  }

  function disposeTerminal(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return;
    bundle.disposables.forEach((disposable) => disposable.dispose());
    bundle.terminal.dispose();
    delete terminalsRef.current[sessionId];
    delete containersRef.current[sessionId];
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
    refreshGutter(bundle);
    if (!activeSession) return;
    onSizeChange?.({
      cols: bundle.terminal.cols,
      rows: bundle.terminal.rows,
    });
    resizeSession(
      activeSession.sessionId,
      bundle.terminal.cols,
      bundle.terminal.rows,
    ).catch(() => {});
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

  function hasActiveSelection() {
    return !!getActiveBundle()?.terminal.getSelection();
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
    refreshGutter(bundle);
    return true;
  }

  function searchActiveTerminal(keyword: string, direction: SearchDirection) {
    const bundle = getActiveBundle();
    const sessionId = activeSessionIdRef.current;
    const value = keyword.trim();
    if (!bundle || !sessionId || !value) return false;

    const state = searchStateRef.current;
    const sameQuery = state?.sessionId === sessionId && state.keyword === value;
    const lineCount = bundle.terminal.buffer.active.length;
    const initialRow = direction === "next" ? 0 : Math.max(lineCount - 1, 0);
    const initialCol = direction === "next" ? 0 : Number.MAX_SAFE_INTEGER;

    const startRow = sameQuery ? state.row : initialRow;
    const startCol =
      sameQuery && state
        ? direction === "next"
          ? state.col + 1
          : Math.max(state.col - 1, 0)
        : initialCol;

    let match = findInTerminal(
      bundle.terminal,
      value,
      direction,
      startRow,
      startCol,
    );
    if (!match) {
      match = findInTerminal(
        bundle.terminal,
        value,
        direction,
        initialRow,
        initialCol,
      );
    }
    if (!match) return false;

    bundle.terminal.select(match.col, match.row, match.length);
    bundle.terminal.scrollToLine(match.row);
    searchStateRef.current = {
      sessionId,
      keyword: value,
      row: match.row,
      col: match.col,
    };
    return true;
  }

  function searchActiveTerminalNext(keyword: string) {
    return searchActiveTerminal(keyword, "next");
  }

  function searchActiveTerminalPrev(keyword: string) {
    return searchActiveTerminal(keyword, "prev");
  }

  return {
    registerTerminalContainer,
    isTerminalReady,
    getTerminalSize,
    hasActiveSelection,
    copyActiveSelection,
    pasteToActiveTerminal,
    clearActiveTerminal,
    searchActiveTerminalNext,
    searchActiveTerminalPrev,
  };
}
