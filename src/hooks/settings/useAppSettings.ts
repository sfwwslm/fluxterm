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
import { getGlobalConfigDir, getSettingsPath } from "@/shared/config/paths";
import { extractErrorMessage } from "@/shared/errors/appError";

type AppSettings = {
  version: 1;
  shellId?: string | null;
  locale?: Locale;
  themeId?: ThemeId;
  sftpEnabled?: boolean;
  fileDefaultEditorPath?: string | null;
  backgroundImageEnabled?: boolean;
  backgroundImageAsset?: string | null;
  backgroundImageSurfaceAlpha?: number;
};

export const MIN_BACKGROUND_IMAGE_SURFACE_ALPHA = 0.2;
export const MAX_BACKGROUND_IMAGE_SURFACE_ALPHA = 0.9;
export const DEFAULT_BACKGROUND_IMAGE_SURFACE_ALPHA = 0.52;
const SAVE_SETTINGS_DEBOUNCE_MS = 200;

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
  backgroundImageEnabled: boolean;
  setBackgroundImageEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  backgroundImageAsset: string;
  setBackgroundImageAsset: React.Dispatch<React.SetStateAction<string>>;
  backgroundImageSurfaceAlpha: number;
  setBackgroundImageSurfaceAlpha: React.Dispatch<React.SetStateAction<number>>;
  availableShells: LocalShellProfile[];
  settingsLoaded: boolean;
};

function clampBackgroundImageSurfaceAlpha(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_IMAGE_SURFACE_ALPHA;
  return Math.min(
    MAX_BACKGROUND_IMAGE_SURFACE_ALPHA,
    Math.max(MIN_BACKGROUND_IMAGE_SURFACE_ALPHA, value),
  );
}

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
  const [backgroundImageEnabled, setBackgroundImageEnabled] = useState(false);
  const [backgroundImageAsset, setBackgroundImageAsset] = useState("");
  const [backgroundImageSurfaceAlpha, setBackgroundImageSurfaceAlpha] =
    useState(DEFAULT_BACKGROUND_IMAGE_SURFACE_ALPHA);
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
      if (typeof parsed?.backgroundImageEnabled === "boolean") {
        setBackgroundImageEnabled(parsed.backgroundImageEnabled);
      }
      if (typeof parsed?.backgroundImageAsset === "string") {
        setBackgroundImageAsset(parsed.backgroundImageAsset);
      }
      if (typeof parsed?.backgroundImageSurfaceAlpha === "number") {
        setBackgroundImageSurfaceAlpha(
          clampBackgroundImageSurfaceAlpha(parsed.backgroundImageSurfaceAlpha),
        );
      }
      const normalizedThemeId = normalizeThemeId(parsed?.themeId);
      if (normalizedThemeId && themeIds.includes(normalizedThemeId)) {
        setThemeId(normalizedThemeId);
      }
    } catch (error) {
      warn(
        JSON.stringify({
          event: "settings:load-failed",
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      // 由初始化流程统一设置 settingsLoaded，避免竞态覆盖。
    }
  }

  async function saveSettings(payload: AppSettings) {
    const dir = await getGlobalConfigDir();
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
    const timer = window.setTimeout(() => {
      saveSettings({
        version: 1,
        shellId,
        locale,
        themeId,
        sftpEnabled,
        fileDefaultEditorPath: fileDefaultEditorPath.trim() || null,
        backgroundImageEnabled,
        backgroundImageAsset: backgroundImageAsset.trim() || null,
        backgroundImageSurfaceAlpha: clampBackgroundImageSurfaceAlpha(
          backgroundImageSurfaceAlpha,
        ),
      }).catch((error) => {
        warn(
          JSON.stringify({
            event: "settings:save-failed",
            error: extractErrorMessage(error),
          }),
        );
      });
    }, SAVE_SETTINGS_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    shellId,
    locale,
    themeId,
    sftpEnabled,
    fileDefaultEditorPath,
    backgroundImageEnabled,
    backgroundImageAsset,
    backgroundImageSurfaceAlpha,
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
    backgroundImageEnabled,
    setBackgroundImageEnabled,
    backgroundImageAsset,
    setBackgroundImageAsset,
    backgroundImageSurfaceAlpha,
    setBackgroundImageSurfaceAlpha,
    availableShells,
    settingsLoaded,
  };
}
