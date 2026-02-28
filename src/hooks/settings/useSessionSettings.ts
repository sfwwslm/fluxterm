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
import { warn } from "@tauri-apps/plugin-log";
import {
  getFluxTermConfigDir,
  getSessionSettingsPath,
} from "@/shared/config/paths";

type SessionSettings = {
  version: 1;
  webLinksEnabled?: boolean;
};

type UseSessionSettingsResult = {
  webLinksEnabled: boolean;
  setWebLinksEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  sessionSettingsLoaded: boolean;
};

const defaultSessionSettings: Required<
  Pick<SessionSettings, "webLinksEnabled">
> = {
  webLinksEnabled: true,
};

/** 会话设置持久化：管理终端域的全局配置，统一写入 session.json。 */
export default function useSessionSettings(): UseSessionSettingsResult {
  const [webLinksEnabled, setWebLinksEnabled] = useState(
    defaultSessionSettings.webLinksEnabled,
  );
  const [sessionSettingsLoaded, setSessionSettingsLoaded] = useState(false);
  const loadedRef = useRef(false);

  async function loadSessionSettings() {
    try {
      const path = await getSessionSettingsPath();
      if (!(await exists(path))) {
        return;
      }
      const raw = await readTextFile(path);
      const parsed = JSON.parse(raw) as SessionSettings;
      if (typeof parsed?.webLinksEnabled === "boolean") {
        setWebLinksEnabled(parsed.webLinksEnabled);
      }
    } catch (error) {
      warn(
        JSON.stringify({
          event: "session-settings:load-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
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
    }).catch((error) => {
      warn(
        JSON.stringify({
          event: "session-settings:save-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }, [webLinksEnabled]);

  return {
    webLinksEnabled,
    setWebLinksEnabled,
    sessionSettingsLoaded,
  };
}
