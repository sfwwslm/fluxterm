import { useEffect, useMemo, useState } from "react";
import "@/App.css";
import { readFile } from "@tauri-apps/plugin-fs";
import { warn } from "@tauri-apps/plugin-log";
import useAppSettings, {
  DEFAULT_BACKGROUND_IMAGE_SURFACE_ALPHA,
  MAX_BACKGROUND_IMAGE_SURFACE_ALPHA,
  MIN_BACKGROUND_IMAGE_SURFACE_ALPHA,
} from "@/hooks/useAppSettings";
import { translations, type Locale, type Translate } from "@/i18n";
import type { ThemeId } from "@/types";
import { getBackgroundImageAssetPath } from "@/shared/config/paths";
import { extractErrorMessage } from "@/shared/errors/appError";
import { themePresets } from "@/main/theme/themePresets";
import { buildThemeCssVars } from "@/main/theme/buildThemeCssVars";
import {
  SUBAPP_LIFECYCLE_CHANNEL,
  createSubAppWindowLabel,
  parseSubAppIdFromHash,
  type SubAppLifecycleMessage,
} from "@/subapps/core/lifecycle";
import FtpSubApp from "@/subapps/ftp/FtpSubApp";
import "@/subapps/ftp/FtpSubApp.css";

function formatMessage(
  message: string,
  vars?: Record<string, string | number>,
) {
  if (!vars) return message;
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    message,
  );
}

function clampBackgroundImageSurfaceAlpha(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_IMAGE_SURFACE_ALPHA;
  return Math.min(
    MAX_BACKGROUND_IMAGE_SURFACE_ALPHA,
    Math.max(MIN_BACKGROUND_IMAGE_SURFACE_ALPHA, value),
  );
}

/** 子应用根入口，仅渲染独立 SubApp 窗口。 */
export default function SubAppRoot() {
  const themeIds = useMemo(() => Object.keys(themePresets) as ThemeId[], []);
  const {
    locale,
    themeId,
    backgroundImageEnabled,
    backgroundImageAsset,
    backgroundImageSurfaceAlpha,
  } = useAppSettings({
    themeIds,
    defaultThemeId: "dark",
  });
  const subAppId = useMemo(
    () => parseSubAppIdFromHash(window.location.hash),
    [],
  );
  const [appearanceSync, setAppearanceSync] = useState<{
    locale: Locale;
    themeId: ThemeId;
    backgroundImageEnabled: boolean;
    backgroundImageAsset: string;
    backgroundImageSurfaceAlpha: number;
  } | null>(null);

  useEffect(() => {
    if (!subAppId) return () => {};
    if (typeof BroadcastChannel === "undefined") return () => {};
    const channel = new BroadcastChannel(SUBAPP_LIFECYCLE_CHANNEL);
    const label = createSubAppWindowLabel(subAppId);
    channel.onmessage = (event) => {
      const payload = event.data as SubAppLifecycleMessage | undefined;
      if (!payload || payload.type !== "subapp:appearance-sync") return;
      if (
        payload.target &&
        (payload.target.id !== subAppId || payload.target.label !== label)
      ) {
        return;
      }
      setAppearanceSync({
        locale: payload.locale,
        themeId: payload.themeId,
        backgroundImageEnabled: payload.backgroundImageEnabled,
        backgroundImageAsset: payload.backgroundImageAsset,
        backgroundImageSurfaceAlpha: payload.backgroundImageSurfaceAlpha,
      });
    };
    return () => {
      channel.close();
    };
  }, [subAppId]);

  const effectiveLocale = appearanceSync?.locale ?? locale;
  const effectiveThemeId = appearanceSync?.themeId ?? themeId;
  const effectiveBackgroundImageEnabled =
    appearanceSync?.backgroundImageEnabled ?? backgroundImageEnabled;
  const effectiveBackgroundImageAsset =
    appearanceSync?.backgroundImageAsset ?? backgroundImageAsset;
  const effectiveBackgroundImageSurfaceAlpha =
    appearanceSync?.backgroundImageSurfaceAlpha ?? backgroundImageSurfaceAlpha;
  const t: Translate = useMemo(
    () => (key, vars) =>
      formatMessage(translations[effectiveLocale][key] ?? key, vars),
    [effectiveLocale],
  );

  const activeThemePreset = themePresets[effectiveThemeId];
  const normalizedBackgroundImageSurfaceAlpha = useMemo(
    () =>
      clampBackgroundImageSurfaceAlpha(effectiveBackgroundImageSurfaceAlpha),
    [effectiveBackgroundImageSurfaceAlpha],
  );

  useEffect(() => {
    const root = document.documentElement;
    const cssVars = buildThemeCssVars(activeThemePreset);
    root.dataset.theme = effectiveThemeId;
    Object.entries(cssVars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
  }, [activeThemePreset, effectiveThemeId]);

  useEffect(() => {
    document.documentElement.lang = effectiveLocale;
  }, [effectiveLocale]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--chrome-surface-alpha",
      `${Math.round(normalizedBackgroundImageSurfaceAlpha * 100)}%`,
    );
  }, [normalizedBackgroundImageSurfaceAlpha]);

  useEffect(() => {
    let disposed = false;
    let blobUrl: string | null = null;
    const root = document.documentElement;
    const applyBackgroundImageMode = (enabled: boolean) => {
      root.dataset.backgroundImageMode = enabled ? "on" : "off";
    };
    const applyDefaultBackground = () => {
      root.style.setProperty("--app-bg-image", "none");
      root.style.setProperty("--app-bg-overlay", "none");
      applyBackgroundImageMode(false);
    };

    if (!effectiveBackgroundImageEnabled || !effectiveBackgroundImageAsset) {
      applyDefaultBackground();
      return;
    }

    const overlay =
      effectiveThemeId === "light"
        ? "linear-gradient(0deg, rgba(255, 255, 255, 0.36), rgba(255, 255, 255, 0.36))"
        : "linear-gradient(0deg, rgba(7, 10, 14, 0.42), rgba(7, 10, 14, 0.42))";
    root.style.setProperty("--app-bg-overlay", overlay);

    (async () => {
      try {
        const filePath = await getBackgroundImageAssetPath(
          effectiveBackgroundImageAsset,
        );
        const bytes = await readFile(filePath);
        blobUrl = URL.createObjectURL(new Blob([bytes]));
        if (disposed) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        root.style.setProperty("--app-bg-image", `url("${blobUrl}")`);
        applyBackgroundImageMode(true);
      } catch (error) {
        if (disposed) return;
        applyDefaultBackground();
        warn(
          JSON.stringify({
            event: "subapp:background-image-load-failed",
            asset: effectiveBackgroundImageAsset,
            error: extractErrorMessage(error),
          }),
        );
      }
    })();

    return () => {
      disposed = true;
      if (!blobUrl) return;
      URL.revokeObjectURL(blobUrl);
    };
  }, [
    effectiveBackgroundImageEnabled,
    effectiveBackgroundImageAsset,
    effectiveThemeId,
  ]);

  if (subAppId === "ftp") {
    return <FtpSubApp id={subAppId} locale={effectiveLocale} t={t} />;
  }

  return (
    <div className="subapp-demo-shell">
      <main className="subapp-demo-content">
        <article className="subapp-demo-card">
          <h2>{t("subapp.unknown.title")}</h2>
          <p>{t("subapp.unknown.description")}</p>
        </article>
      </main>
    </div>
  );
}
