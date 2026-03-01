import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { warn, debug } from "@tauri-apps/plugin-log";
import type { Locale } from "@/i18n";
import type { LocalShellProfile, ThemeId } from "@/types";
import { getFluxTermConfigDir, getSettingsPath } from "@/shared/config/paths";

type AppSettings = {
  version: 1;
  shellId?: string | null;
  locale?: Locale;
  themeId?: ThemeId;
  sftpEnabled?: boolean;
  fileDefaultEditorPath?: string | null;
};

type UseAppSettingsProps = {
  themeIds: ThemeId[];
  defaultThemeId: ThemeId;
};

type UseAppSettingsResult = {
  locale: Locale;
  setLocale: React.Dispatch<React.SetStateAction<Locale>>;
  themeId: ThemeId;
  setThemeId: React.Dispatch<React.SetStateAction<ThemeId>>;
  shellId: string | null;
  setShellId: React.Dispatch<React.SetStateAction<string | null>>;
  sftpEnabled: boolean;
  setSftpEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  fileDefaultEditorPath: string;
  setFileDefaultEditorPath: React.Dispatch<React.SetStateAction<string>>;
  availableShells: LocalShellProfile[];
  settingsLoaded: boolean;
};

function normalizeThemeId(value: unknown): ThemeId | null {
  if (value === "dark" || value === "light") return value;
  if (value === "aurora" || value === "sahara") return "dark";
  if (value === "dawn") return "light";
  return null;
}

/** 应用设置持久化与系统 shell 列表加载。 */
export default function useAppSettings({
  themeIds,
  defaultThemeId,
}: UseAppSettingsProps): UseAppSettingsResult {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem("fluxterm.locale");
    if (saved === "zh" || saved === "en") return saved;
    return navigator.language?.startsWith("zh") ? "zh" : "en";
  });
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const saved = normalizeThemeId(localStorage.getItem("fluxterm.theme"));
    if (saved && themeIds.includes(saved)) return saved;
    return defaultThemeId;
  });
  const [availableShells, setAvailableShells] = useState<LocalShellProfile[]>(
    [],
  );
  const [shellId, setShellId] = useState<string | null>(null);
  const [sftpEnabled, setSftpEnabled] = useState(true);
  const [fileDefaultEditorPath, setFileDefaultEditorPath] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const pendingShellIdRef = useRef<string | null>(null);

  function resolveDefaultShellId(shells: LocalShellProfile[]) {
    if (!shells.length) return null;
    const preferred = shells.find((shell) => shell.id === "powershell");
    if (preferred) return preferred.id;
    return shells[0].id;
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
      if (typeof parsed?.sftpEnabled === "boolean") {
        setSftpEnabled(parsed.sftpEnabled);
      }
      if (typeof parsed?.fileDefaultEditorPath === "string") {
        setFileDefaultEditorPath(parsed.fileDefaultEditorPath);
      }
      const normalizedThemeId = normalizeThemeId(parsed?.themeId);
      if (normalizedThemeId && themeIds.includes(normalizedThemeId)) {
        setThemeId(normalizedThemeId);
      }
    } catch (error) {
      warn(
        JSON.stringify({
          event: "settings:load-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      // 由初始化流程统一设置 settingsLoaded，避免竞态覆盖。
    }
  }

  async function saveSettings(payload: AppSettings) {
    const dir = await getFluxTermConfigDir();
    await mkdir(dir, { recursive: true });
    const path = await getSettingsPath();
    await writeTextFile(path, JSON.stringify(payload, null, 2));
  }

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("fluxterm.locale", locale);
  }, [locale]);

  useEffect(() => {
    localStorage.setItem("fluxterm.theme", themeId);
  }, [themeId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // 先加载本地设置，再拉取 shell 列表，避免竞态导致默认值覆盖。
        await loadSettings();
        const shells = await invoke<LocalShellProfile[]>("local_shell_list");
        if (!active) return;
        setAvailableShells(shells);
        const fallbackId = resolveDefaultShellId(shells);
        const preferred = pendingShellIdRef.current;
        const preferredAvailable =
          !!preferred && shells.some((shell) => shell.id === preferred);
        const selected = (preferredAvailable ? preferred : fallbackId) ?? null;
        setShellId(selected);
        // 记录初始化结果，便于验证持久化与回退是否生效。
        debug(
          JSON.stringify({
            event: "settings:init-shell",
            savedShellId: preferred ?? null,
            availableShellIds: shells.map((shell) => shell.id),
            selectedShellId: selected,
            fallbackUsed: !!preferred && !preferredAvailable,
          }),
        );
      } catch {
        if (!active) return;
        setAvailableShells([]);
        setShellId(null);
        // 初始化失败时记录日志，便于排查。
        warn(
          JSON.stringify({
            event: "settings:init-shell-failed",
          }),
        );
      } finally {
        if (!active) return;
        setSettingsLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings({
      version: 1,
      shellId,
      locale,
      themeId,
      sftpEnabled,
      fileDefaultEditorPath: fileDefaultEditorPath.trim() || null,
    }).catch((error) => {
      warn(
        JSON.stringify({
          event: "settings:save-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }, [
    shellId,
    locale,
    themeId,
    sftpEnabled,
    fileDefaultEditorPath,
    settingsLoaded,
  ]);

  return {
    locale,
    setLocale,
    themeId,
    setThemeId,
    shellId,
    setShellId,
    sftpEnabled,
    setSftpEnabled,
    fileDefaultEditorPath,
    setFileDefaultEditorPath,
    availableShells,
    settingsLoaded,
  };
}
