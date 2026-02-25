import { useEffect, useMemo, useRef, useState } from "react";
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
  onSizeChange?: (size: { cols: number; rows: number }) => void;
  sessionRef: React.MutableRefObject<Session | null>;
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
  terminalRef: React.RefObject<HTMLDivElement | null>;
  terminalReady: boolean;
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
  onSizeChange,
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
}: UseTerminalRuntimeProps): TerminalRuntime {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const xtermModulesRef = useRef<XtermModules | null>(null);
  const themeRef = useRef(theme);
  const [terminalReady, setTerminalReady] = useState(false);

  const getTerminalSize = useMemo(
    () => () => {
      const term = terminalInstance.current;
      return { cols: term?.cols ?? 80, rows: term?.rows ?? 24 };
    },
    [],
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
    let disposed = false;
    const container = terminalRef.current;
    if (!container || terminalInstance.current) return () => {};
    let cleanup: (() => void) | null = null;

    const initTerminal = async () => {
      const modules = await loadXtermModules();
      if (disposed || terminalInstance.current) return;
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
      fitAddon.current = fit;
      term.open(container);
      safeFit(fit, container);
      term.onData((data) => {
        const active = sessionRef.current;
        if (!active) return;
        const state = sessionStatesRef.current[active.sessionId];
        if (state === "disconnected") {
          const reason = sessionReasonsRef.current[active.sessionId];
          if (reason === "exit") {
            if (isLocalSession(active.sessionId)) {
              reconnectLocalShell(active.sessionId).catch(() => {});
            } else {
              reconnectSession(active.sessionId).catch(() => {});
            }
          }
          return;
        }
        recordCommandInput(active.sessionId, data);
        writeToSession(active.sessionId, data).catch(() => {});
      });
      terminalInstance.current = term;
      setTerminalReady(true);
      const resizeObserver = new ResizeObserver(() => {
        const active = sessionRef.current;
        if (!active || !fitAddon.current || !terminalInstance.current) return;
        safeFit(fitAddon.current, terminalRef.current);
        resizeSession(
          active.sessionId,
          terminalInstance.current.cols,
          terminalInstance.current.rows,
        ).catch(() => {});
      });
      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      cleanup = () => {
        resizeObserver.disconnect();
        term.dispose();
        if (terminalInstance.current === term) {
          terminalInstance.current = null;
        }
      };
    };

    initTerminal().catch(() => {});
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [
    isLocalSession,
    reconnectLocalShell,
    reconnectSession,
    recordCommandInput,
    resizeSession,
    sessionReasonsRef,
    sessionRef,
    sessionStatesRef,
    writeToSession,
  ]);

  useEffect(() => {
    if (!terminalReady || !terminalRef.current || !terminalInstance.current) {
      return;
    }
    const buffer =
      activeSessionId && sessionBuffersRef.current[activeSessionId]
        ? sessionBuffersRef.current[activeSessionId]
        : "";
    terminalInstance.current.reset();
    terminalInstance.current.write(buffer);
  }, [activeSessionId, terminalReady, sessionBuffersRef]);

  useEffect(() => {
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
    };

    registerListeners().catch(() => {});

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [sessionBuffersRef, sessionRef]);

  useEffect(() => {
    if (!terminalInstance.current) return;
    terminalInstance.current.options.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!terminalReady || !fitAddon.current || !terminalInstance.current)
      return;
    safeFit(fitAddon.current, terminalRef.current);
    if (!activeSession) return;
    onSizeChange?.({
      cols: terminalInstance.current.cols,
      rows: terminalInstance.current.rows,
    });
    resizeSession(
      activeSession.sessionId,
      terminalInstance.current.cols,
      terminalInstance.current.rows,
    ).catch(() => {});
  }, [activeSession, resizeSession, terminalReady]);

  return { terminalRef, terminalReady, getTerminalSize };
}
