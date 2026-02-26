import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { DisconnectReason, Session, SessionStateUi } from "@/types";

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
  sessionStatesRef: React.MutableRefObject<Record<string, SessionStateUi>>;
  sessionReasonsRef: React.MutableRefObject<Record<string, DisconnectReason>>;
  sessionBuffersRef: React.MutableRefObject<Record<string, string>>;
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
};

type XtermModules = {
  Terminal: typeof import("@xterm/xterm").Terminal;
  FitAddon: typeof import("@xterm/addon-fit").FitAddon;
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
  const terminalsRef = useRef<
    Record<
      string,
      { terminal: Terminal; fitAddon: FitAddon; container: HTMLDivElement }
    >
  >({});
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
        safeFit(bundle.fitAddon, bundle.container);
        handlersRef.current
          .resizeSession(activeId, bundle.terminal.cols, bundle.terminal.rows)
          .catch(() => {});
      });
    }
    resizeObserverRef.current.disconnect();
    resizeObserverRef.current.observe(container);
  }

  async function ensureTerminal(sessionId: string, container: HTMLDivElement) {
    if (terminalsRef.current[sessionId]) return;
    const modules = await loadXtermModules();
    if (terminalsRef.current[sessionId]) return;
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
    term.open(container);
    safeFit(fit, container);
    term.onData((data) => {
      const state = sessionStatesRef.current[sessionId];
      if (state === "disconnected") {
        const reason = sessionReasonsRef.current[sessionId];
        if (reason === "exit") {
          if (handlersRef.current.isLocalSession(sessionId)) {
            handlersRef.current.reconnectLocalShell(sessionId).catch(() => {});
          } else {
            handlersRef.current.reconnectSession(sessionId).catch(() => {});
          }
        }
        return;
      }
      handlersRef.current.recordCommandInput(sessionId, data);
      handlersRef.current.writeToSession(sessionId, data).catch(() => {});
    });
    terminalsRef.current[sessionId] = {
      terminal: term,
      fitAddon: fit,
      container,
    };
    setTerminalReadyBySession((prev) => ({ ...prev, [sessionId]: true }));
    const buffer = sessionBuffersRef.current[sessionId];
    if (buffer) {
      term.write(buffer);
      delete sessionBuffersRef.current[sessionId];
    }
  }

  function disposeTerminal(sessionId: string) {
    const bundle = terminalsRef.current[sessionId];
    if (!bundle) return;
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
    const unlisteners: Array<() => void> = [];

    const registerListeners = async () => {
      const outputUnlisten = await listen<{ sessionId: string; data: string }>(
        "terminal:output",
        (event) => {
          const sessionId = event.payload.sessionId;
          const terminal = terminalsRef.current[sessionId]?.terminal;
          if (terminal) {
            terminal.write(event.payload.data);
          } else {
            const buffer = sessionBuffersRef.current[sessionId] ?? "";
            sessionBuffersRef.current[sessionId] = buffer + event.payload.data;
          }
        },
      );
      if (cancelled) {
        outputUnlisten();
        return;
      }
      unlisteners.push(outputUnlisten);
    };

    registerListeners().catch(() => {});

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
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
    safeFit(bundle.fitAddon, bundle.container);
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

  return { registerTerminalContainer, isTerminalReady, getTerminalSize };
}
