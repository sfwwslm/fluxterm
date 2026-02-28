/**
 * 会话设置持久化模块。
 * 职责：读写 session.json，并管理对所有终端会话统一生效的终端域全局配置。
 */
import { useEffect, useRef, useState } from "react";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { info, warn } from "@tauri-apps/plugin-log";
import {
  getFluxTermConfigDir,
  getSessionSettingsPath,
} from "@/shared/config/paths";

type SessionSettings = {
  version: 1;
  webLinksEnabled?: boolean;
  selectionAutoCopyEnabled?: boolean;
  scrollback?: number;
  terminalPathSyncEnabled?: boolean;
};

type UseSessionSettingsResult = {
  webLinksEnabled: boolean;
  selectionAutoCopyEnabled: boolean;
  scrollback: number;
  terminalPathSyncEnabled: boolean;
  setWebLinksEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectionAutoCopyEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setScrollback: React.Dispatch<React.SetStateAction<number>>;
  setTerminalPathSyncEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  sessionSettingsLoaded: boolean;
};

export const MIN_SCROLLBACK = 100;
export const MAX_SCROLLBACK = 50000;

function normalizeScrollback(value: number) {
  return Math.max(MIN_SCROLLBACK, Math.min(MAX_SCROLLBACK, Math.round(value)));
}

const defaultSessionSettings: Required<
  Pick<
    SessionSettings,
    | "webLinksEnabled"
    | "selectionAutoCopyEnabled"
    | "scrollback"
    | "terminalPathSyncEnabled"
  >
> = {
  webLinksEnabled: true,
  selectionAutoCopyEnabled: false,
  scrollback: 3000,
  terminalPathSyncEnabled: true,
};

/** 会话设置持久化：管理终端域的全局配置，统一写入 session.json。 */
export default function useSessionSettings(): UseSessionSettingsResult {
  const [webLinksEnabled, setWebLinksEnabled] = useState(
    defaultSessionSettings.webLinksEnabled,
  );
  const [selectionAutoCopyEnabled, setSelectionAutoCopyEnabled] = useState(
    defaultSessionSettings.selectionAutoCopyEnabled,
  );
  const [scrollback, setScrollback] = useState(
    defaultSessionSettings.scrollback,
  );
  const [terminalPathSyncEnabled, setTerminalPathSyncEnabled] = useState(
    defaultSessionSettings.terminalPathSyncEnabled,
  );
  const [sessionSettingsLoaded, setSessionSettingsLoaded] = useState(false);
  const loadedRef = useRef(false);
  const loggedSettingsRef = useRef({
    webLinksEnabled: defaultSessionSettings.webLinksEnabled,
    selectionAutoCopyEnabled: defaultSessionSettings.selectionAutoCopyEnabled,
    scrollback: defaultSessionSettings.scrollback,
    terminalPathSyncEnabled: defaultSessionSettings.terminalPathSyncEnabled,
  });

  async function loadSessionSettings() {
    let parsed: SessionSettings | null = null;
    let shouldRewrite = false;
    try {
      const path = await getSessionSettingsPath();
      if (!(await exists(path))) {
        return;
      }
      const raw = await readTextFile(path);
      parsed = JSON.parse(raw) as SessionSettings;
      if (typeof parsed?.webLinksEnabled === "boolean") {
        setWebLinksEnabled(parsed.webLinksEnabled);
      }
      if (typeof parsed?.selectionAutoCopyEnabled === "boolean") {
        setSelectionAutoCopyEnabled(parsed.selectionAutoCopyEnabled);
      }
      if (typeof parsed?.terminalPathSyncEnabled === "boolean") {
        setTerminalPathSyncEnabled(parsed.terminalPathSyncEnabled);
      }
      if (typeof parsed?.scrollback === "number") {
        const normalizedScrollback = normalizeScrollback(parsed.scrollback);
        setScrollback(normalizedScrollback);
        if (normalizedScrollback !== parsed.scrollback) {
          shouldRewrite = true;
          warn(
            JSON.stringify({
              event: "session-settings:scrollback-invalid",
              raw: parsed.scrollback,
              normalized: normalizedScrollback,
            }),
          );
        }
      }
    } catch (error) {
      warn(
        JSON.stringify({
          event: "session-settings:load-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      // 发现本地手改后的非法 scrollback 时，加载期先纠正内存值，再把合法值回写到 session.json。
      if (parsed && shouldRewrite) {
        saveSessionSettings({
          version: 1,
          webLinksEnabled:
            typeof parsed.webLinksEnabled === "boolean"
              ? parsed.webLinksEnabled
              : defaultSessionSettings.webLinksEnabled,
          selectionAutoCopyEnabled:
            typeof parsed.selectionAutoCopyEnabled === "boolean"
              ? parsed.selectionAutoCopyEnabled
              : defaultSessionSettings.selectionAutoCopyEnabled,
          terminalPathSyncEnabled:
            typeof parsed.terminalPathSyncEnabled === "boolean"
              ? parsed.terminalPathSyncEnabled
              : defaultSessionSettings.terminalPathSyncEnabled,
          scrollback:
            typeof parsed.scrollback === "number"
              ? normalizeScrollback(parsed.scrollback)
              : defaultSessionSettings.scrollback,
        }).catch((error) => {
          warn(
            JSON.stringify({
              event: "session-settings:rewrite-failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      }
      loggedSettingsRef.current = {
        webLinksEnabled:
          typeof parsed?.webLinksEnabled === "boolean"
            ? parsed.webLinksEnabled
            : defaultSessionSettings.webLinksEnabled,
        selectionAutoCopyEnabled:
          typeof parsed?.selectionAutoCopyEnabled === "boolean"
            ? parsed.selectionAutoCopyEnabled
            : defaultSessionSettings.selectionAutoCopyEnabled,
        terminalPathSyncEnabled:
          typeof parsed?.terminalPathSyncEnabled === "boolean"
            ? parsed.terminalPathSyncEnabled
            : defaultSessionSettings.terminalPathSyncEnabled,
        scrollback:
          typeof parsed?.scrollback === "number"
            ? normalizeScrollback(parsed.scrollback)
            : defaultSessionSettings.scrollback,
      };
      loadedRef.current = true;
      setSessionSettingsLoaded(true);
    }
  }

  async function saveSessionSettings(payload: SessionSettings) {
    const dir = await getFluxTermConfigDir();
    await mkdir(dir, { recursive: true });
    const path = await getSessionSettingsPath();
    await writeTextFile(path, JSON.stringify(payload, null, 2));
  }

  useEffect(() => {
    loadSessionSettings().catch(() => {
      loadedRef.current = true;
      setSessionSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    saveSessionSettings({
      version: 1,
      webLinksEnabled,
      selectionAutoCopyEnabled,
      terminalPathSyncEnabled,
      scrollback: normalizeScrollback(scrollback),
    }).catch((error) => {
      warn(
        JSON.stringify({
          event: "session-settings:save-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }, [
    scrollback,
    selectionAutoCopyEnabled,
    terminalPathSyncEnabled,
    webLinksEnabled,
  ]);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (
      loggedSettingsRef.current.selectionAutoCopyEnabled ===
      selectionAutoCopyEnabled
    ) {
      return;
    }
    info(
      JSON.stringify({
        event: "session-settings:selection-auto-copy-changed",
        enabled: selectionAutoCopyEnabled,
      }),
    ).catch(() => {});
    loggedSettingsRef.current.selectionAutoCopyEnabled =
      selectionAutoCopyEnabled;
  }, [selectionAutoCopyEnabled]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const nextScrollback = normalizeScrollback(scrollback);
    if (loggedSettingsRef.current.scrollback === nextScrollback) {
      return;
    }
    info(
      JSON.stringify({
        event: "session-settings:scrollback-changed",
        scrollback: nextScrollback,
      }),
    ).catch(() => {});
    loggedSettingsRef.current.scrollback = nextScrollback;
  }, [scrollback]);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (
      loggedSettingsRef.current.terminalPathSyncEnabled ===
      terminalPathSyncEnabled
    ) {
      return;
    }
    info(
      JSON.stringify({
        event: "session-settings:terminal-path-sync-changed",
        enabled: terminalPathSyncEnabled,
      }),
    ).catch(() => {});
    loggedSettingsRef.current.terminalPathSyncEnabled = terminalPathSyncEnabled;
  }, [terminalPathSyncEnabled]);

  return {
    webLinksEnabled,
    selectionAutoCopyEnabled,
    scrollback: normalizeScrollback(scrollback),
    terminalPathSyncEnabled,
    setWebLinksEnabled,
    setSelectionAutoCopyEnabled,
    setScrollback,
    setTerminalPathSyncEnabled,
    sessionSettingsLoaded,
  };
}
