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
};

type UseSessionSettingsResult = {
  webLinksEnabled: boolean;
  selectionAutoCopyEnabled: boolean;
  setWebLinksEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectionAutoCopyEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  sessionSettingsLoaded: boolean;
};

const defaultSessionSettings: Required<
  Pick<SessionSettings, "webLinksEnabled" | "selectionAutoCopyEnabled">
> = {
  webLinksEnabled: true,
  selectionAutoCopyEnabled: false,
};

/** 会话设置持久化：管理终端域的全局配置，统一写入 session.json。 */
export default function useSessionSettings(): UseSessionSettingsResult {
  const [webLinksEnabled, setWebLinksEnabled] = useState(
    defaultSessionSettings.webLinksEnabled,
  );
  const [selectionAutoCopyEnabled, setSelectionAutoCopyEnabled] = useState(
    defaultSessionSettings.selectionAutoCopyEnabled,
  );
  const [sessionSettingsLoaded, setSessionSettingsLoaded] = useState(false);
  const loadedRef = useRef(false);
  const loggedSettingsRef = useRef({
    webLinksEnabled: defaultSessionSettings.webLinksEnabled,
    selectionAutoCopyEnabled: defaultSessionSettings.selectionAutoCopyEnabled,
  });

  async function loadSessionSettings() {
    let parsed: SessionSettings | null = null;
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
    } catch (error) {
      warn(
        JSON.stringify({
          event: "session-settings:load-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      loggedSettingsRef.current = {
        webLinksEnabled:
          typeof parsed?.webLinksEnabled === "boolean"
            ? parsed.webLinksEnabled
            : defaultSessionSettings.webLinksEnabled,
        selectionAutoCopyEnabled:
          typeof parsed?.selectionAutoCopyEnabled === "boolean"
            ? parsed.selectionAutoCopyEnabled
            : defaultSessionSettings.selectionAutoCopyEnabled,
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
    }).catch((error) => {
      warn(
        JSON.stringify({
          event: "session-settings:save-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }, [selectionAutoCopyEnabled, webLinksEnabled]);

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

  return {
    webLinksEnabled,
    selectionAutoCopyEnabled,
    setWebLinksEnabled,
    setSelectionAutoCopyEnabled,
    sessionSettingsLoaded,
  };
}
