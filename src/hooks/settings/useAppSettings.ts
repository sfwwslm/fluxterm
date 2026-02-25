import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { Locale } from "@/i18n";
import type { LocalShellProfile, ThemeId } from "@/types";

type AppSettings = {
  version: 1;
  shellId?: string | null;
  locale?: Locale;
  themeId?: ThemeId;
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
  availableShells: LocalShellProfile[];
  settingsLoaded: boolean;
};

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
    const saved = localStorage.getItem("fluxterm.theme") as ThemeId | null;
    if (saved && themeIds.includes(saved)) return saved;
    return defaultThemeId;
  });
  const [availableShells, setAvailableShells] = useState<LocalShellProfile[]>(
    [],
  );
  const [shellId, setShellId] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const settingsPathRef = useRef<string | null>(null);
  const configDirRef = useRef<string | null>(null);
  const pendingShellIdRef = useRef<string | null>(null);

  async function getConfigDir() {
    if (configDirRef.current) return configDirRef.current;
    const dir = await appConfigDir();
    const path = await join(dir, "flux-term");
    configDirRef.current = path;
    return path;
  }

  async function getSettingsPath() {
    if (settingsPathRef.current) return settingsPathRef.current;
    const dir = await getConfigDir();
    const path = await join(dir, "settings.json");
    settingsPathRef.current = path;
    return path;
  }

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
      if (parsed?.themeId && themeIds.includes(parsed.themeId)) {
        setThemeId(parsed.themeId);
      }
    } catch {
      // Ignore invalid settings.
    } finally {
      setSettingsLoaded(true);
    }
  }

  async function saveSettings(payload: AppSettings) {
    const dir = await getConfigDir();
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
    loadSettings().catch(() => {});
    invoke<LocalShellProfile[]>("local_shell_list")
      .then((shells) => {
        setAvailableShells(shells);
        const fallbackId = resolveDefaultShellId(shells);
        const preferred = pendingShellIdRef.current;
        const selected =
          (preferred && shells.some((shell) => shell.id === preferred)
            ? preferred
            : fallbackId) ?? null;
        setShellId(selected);
      })
      .catch(() => {
        setAvailableShells([]);
        setShellId(null);
      });
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings({
      version: 1,
      shellId,
      locale,
      themeId,
    }).catch(() => {});
  }, [shellId, locale, themeId, settingsLoaded]);

  return {
    locale,
    setLocale,
    themeId,
    setThemeId,
    shellId,
    setShellId,
    availableShells,
    settingsLoaded,
  };
}
