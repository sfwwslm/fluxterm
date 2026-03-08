import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "@/App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readFile } from "@tauri-apps/plugin-fs";
import { warn } from "@/shared/logging/telemetry";
import useAppSettings, {
  DEFAULT_BACKGROUND_IMAGE_SURFACE_ALPHA,
  MAX_BACKGROUND_IMAGE_SURFACE_ALPHA,
  MIN_BACKGROUND_IMAGE_SURFACE_ALPHA,
} from "@/hooks/useAppSettings";
import { useDisableBrowserShortcuts } from "@/hooks/useDisableBrowserShortcuts";
import { usePreventBrowserDefaults } from "@/hooks/usePreventBrowserDefaults";
import { translations, type Locale, type Translate } from "@/i18n";
import type { ThemeId } from "@/types";
import { getBackgroundImageAssetPath } from "@/shared/config/paths";
import { extractErrorMessage } from "@/shared/errors/appError";
import { themePresets } from "@/main/theme/themePresets";
import { buildThemeCssVars } from "@/main/theme/buildThemeCssVars";
import {
  clampBackgroundVideoReplayIntervalSec,
  normalizeBackgroundMediaType,
  normalizeBackgroundRenderMode,
  normalizeBackgroundVideoReplayMode,
  type BackgroundMediaType,
  type BackgroundRenderMode,
  type BackgroundVideoReplayMode,
} from "@/constants/backgroundMedia";
import {
  SUBAPP_LIFECYCLE_CHANNEL,
  createSubAppWindowLabel,
  parseSubAppIdFromHash,
  type SubAppLifecycleMessage,
} from "@/subapps/core/lifecycle";
import ProxySubApp from "@/subapps/proxy/ProxySubApp";
import "@/subapps/SubAppShell.css";
import "@/subapps/proxy/ProxySubApp.css";

function resolveBackgroundImageStyle(mode: BackgroundRenderMode) {
  if (mode === "contain") {
    return {
      size: "contain",
      repeat: "no-repeat",
      position: "center center",
    };
  }
  if (mode === "tile") {
    return {
      size: "auto",
      repeat: "repeat",
      position: "left top",
    };
  }
  return {
    size: "cover",
    repeat: "no-repeat",
    position: "center center",
  };
}

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
  useDisableBrowserShortcuts();
  usePreventBrowserDefaults();

  const themeIds = useMemo(() => Object.keys(themePresets) as ThemeId[], []);
  const {
    locale,
    themeId,
    backgroundImageEnabled,
    backgroundImageAsset,
    backgroundImageSurfaceAlpha,
    backgroundMediaType,
    backgroundRenderMode,
    backgroundVideoReplayMode,
    backgroundVideoReplayIntervalSec,
    settingsLoaded,
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
    backgroundMediaType: BackgroundMediaType;
    backgroundRenderMode: BackgroundRenderMode;
    backgroundVideoReplayMode: BackgroundVideoReplayMode;
    backgroundVideoReplayIntervalSec: number;
  } | null>(null);
  const [subAppWindowAppearanceReady, setSubAppWindowAppearanceReady] =
    useState(false);
  const subAppWindowShownRef = useRef(false);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const backgroundVideoReplayTimerRef = useRef<number | null>(null);
  const [backgroundMediaBlobUrl, setBackgroundMediaBlobUrl] = useState("");
  const [activeBackgroundMediaType, setActiveBackgroundMediaType] =
    useState<BackgroundMediaType>("image");

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
        backgroundMediaType: payload.backgroundMediaType,
        backgroundRenderMode: payload.backgroundRenderMode,
        backgroundVideoReplayMode: payload.backgroundVideoReplayMode,
        backgroundVideoReplayIntervalSec:
          payload.backgroundVideoReplayIntervalSec,
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
  const effectiveBackgroundMediaType =
    appearanceSync?.backgroundMediaType ?? backgroundMediaType;
  const effectiveBackgroundRenderMode =
    appearanceSync?.backgroundRenderMode ?? backgroundRenderMode;
  const effectiveBackgroundVideoReplayMode =
    appearanceSync?.backgroundVideoReplayMode ?? backgroundVideoReplayMode;
  const effectiveBackgroundVideoReplayIntervalSec =
    appearanceSync?.backgroundVideoReplayIntervalSec ??
    backgroundVideoReplayIntervalSec;
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
  const normalizedBackgroundMediaType = useMemo(
    () => normalizeBackgroundMediaType(effectiveBackgroundMediaType),
    [effectiveBackgroundMediaType],
  );
  const normalizedBackgroundRenderMode = useMemo(
    () => normalizeBackgroundRenderMode(effectiveBackgroundRenderMode),
    [effectiveBackgroundRenderMode],
  );
  const normalizedBackgroundVideoReplayMode = useMemo(
    () =>
      normalizeBackgroundVideoReplayMode(effectiveBackgroundVideoReplayMode),
    [effectiveBackgroundVideoReplayMode],
  );
  const normalizedBackgroundVideoReplayIntervalSec = useMemo(
    () =>
      clampBackgroundVideoReplayIntervalSec(
        effectiveBackgroundVideoReplayIntervalSec,
      ),
    [effectiveBackgroundVideoReplayIntervalSec],
  );
  const effectiveBackgroundVideoRenderMode = useMemo(() => {
    if (
      normalizedBackgroundMediaType === "video" &&
      normalizedBackgroundRenderMode === "tile"
    ) {
      return "cover";
    }
    return normalizedBackgroundRenderMode;
  }, [normalizedBackgroundMediaType, normalizedBackgroundRenderMode]);

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
      root.style.setProperty("--app-bg-image-size", "cover");
      root.style.setProperty("--app-bg-image-repeat", "no-repeat");
      root.style.setProperty("--app-bg-image-position", "center center");
      setBackgroundMediaBlobUrl("");
      setActiveBackgroundMediaType("image");
      applyBackgroundImageMode(false);
    };

    if (!settingsLoaded) {
      return;
    }

    if (!effectiveBackgroundImageEnabled || !effectiveBackgroundImageAsset) {
      applyDefaultBackground();
      queueMicrotask(() => {
        setSubAppWindowAppearanceReady(true);
      });
      return;
    }

    const overlay =
      effectiveThemeId === "light"
        ? "linear-gradient(0deg, rgba(255, 255, 255, 0.36), rgba(255, 255, 255, 0.36))"
        : "linear-gradient(0deg, rgba(7, 10, 14, 0.42), rgba(7, 10, 14, 0.42))";
    root.style.setProperty("--app-bg-overlay", overlay);

    void (async () => {
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
        const style = resolveBackgroundImageStyle(
          effectiveBackgroundVideoRenderMode,
        );
        root.style.setProperty("--app-bg-image-size", style.size);
        root.style.setProperty("--app-bg-image-repeat", style.repeat);
        root.style.setProperty("--app-bg-image-position", style.position);
        if (normalizedBackgroundMediaType === "video") {
          root.style.setProperty("--app-bg-image", "none");
          setBackgroundMediaBlobUrl(blobUrl);
          setActiveBackgroundMediaType("video");
        } else {
          root.style.setProperty("--app-bg-image", `url("${blobUrl}")`);
          setBackgroundMediaBlobUrl("");
          setActiveBackgroundMediaType("image");
        }
        applyBackgroundImageMode(true);
        setSubAppWindowAppearanceReady(true);
      } catch (error) {
        if (disposed) return;
        applyDefaultBackground();
        setSubAppWindowAppearanceReady(true);
        void warn(
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
    effectiveBackgroundVideoRenderMode,
    normalizedBackgroundMediaType,
    effectiveThemeId,
    settingsLoaded,
  ]);

  useEffect(() => {
    const video = backgroundVideoRef.current;
    if (!video || !backgroundMediaBlobUrl) return;
    backgroundVideoReplayTimerRef.current = null;
    const syncVisibility = () => {
      if (document.visibilityState !== "visible") {
        video.pause();
        return;
      }
      void video.play().catch(() => {});
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      if (backgroundVideoReplayTimerRef.current) {
        window.clearTimeout(backgroundVideoReplayTimerRef.current);
        backgroundVideoReplayTimerRef.current = null;
      }
    };
  }, [backgroundMediaBlobUrl]);

  useEffect(() => {
    if (!backgroundVideoReplayTimerRef.current) return;
    window.clearTimeout(backgroundVideoReplayTimerRef.current);
    backgroundVideoReplayTimerRef.current = null;
  }, [
    normalizedBackgroundVideoReplayMode,
    normalizedBackgroundVideoReplayIntervalSec,
  ]);

  function handleBackgroundVideoEnded() {
    const video = backgroundVideoRef.current;
    if (!video) return;
    if (normalizedBackgroundVideoReplayMode === "single") return;
    if (normalizedBackgroundVideoReplayMode === "loop") {
      video.currentTime = 0;
      void video.play().catch(() => {});
      return;
    }
    if (backgroundVideoReplayTimerRef.current) {
      window.clearTimeout(backgroundVideoReplayTimerRef.current);
      backgroundVideoReplayTimerRef.current = null;
    }
    backgroundVideoReplayTimerRef.current = window.setTimeout(() => {
      const currentVideo = backgroundVideoRef.current;
      if (!currentVideo) return;
      currentVideo.currentTime = 0;
      void currentVideo.play().catch(() => {});
    }, normalizedBackgroundVideoReplayIntervalSec * 1000);
  }

  useLayoutEffect(() => {
    document.body.style.visibility = subAppWindowAppearanceReady
      ? "visible"
      : "hidden";
    return () => {
      document.body.style.visibility = "";
    };
  }, [subAppWindowAppearanceReady]);

  useEffect(() => {
    if (!subAppWindowAppearanceReady) return;
    if (subAppWindowShownRef.current) return;
    subAppWindowShownRef.current = true;
    const current = getCurrentWindow();
    current
      .show()
      .then(() => current.setFocus().catch(() => {}))
      .catch(() => {});
  }, [subAppWindowAppearanceReady]);

  return (
    <>
      {activeBackgroundMediaType === "video" && backgroundMediaBlobUrl ? (
        <div className="app-background-media-layer" aria-hidden="true">
          <video
            ref={backgroundVideoRef}
            key={backgroundMediaBlobUrl}
            className={`app-background-video mode-${effectiveBackgroundVideoRenderMode}`}
            src={backgroundMediaBlobUrl}
            muted
            playsInline
            autoPlay
            preload="auto"
            onEnded={handleBackgroundVideoEnded}
          />
          <div className="app-background-media-overlay" />
        </div>
      ) : null}
      {subAppId === "proxy" ? (
        <ProxySubApp id={subAppId} locale={effectiveLocale} t={t} />
      ) : (
        <div className="subapp-shell">
          <main className="subapp-content">
            <article className="subapp-card">
              <h2>{t("subapp.unknown.title")}</h2>
              <p>{t("subapp.unknown.description")}</p>
            </article>
          </main>
        </div>
      )}
    </>
  );
}
