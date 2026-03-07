import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Locale } from "@/i18n";
import type { Translate } from "@/i18n";
import {
  SUBAPP_LIFECYCLE_CHANNEL,
  createSubAppWindowLabel,
  type SubAppLifecycleMessage,
} from "@/subapps/core/lifecycle";
import type { SubAppId, SubAppRuntimeStatus } from "@/subapps/types";
import type { ThemeId } from "@/types";
import type {
  BackgroundMediaType,
  BackgroundRenderMode,
  BackgroundVideoReplayMode,
} from "@/constants/backgroundMedia";
import { isMacOS } from "@/utils/platform";

type SubAppDefinition = {
  id: SubAppId;
  menuLabel: string;
  windowTitle: string;
};

type SubAppRuntimeInfo = {
  id: SubAppId;
  label: string;
  status: SubAppRuntimeStatus;
};

type UseSubAppsOptions = {
  t: Translate;
  appearance: {
    locale: Locale;
    themeId: ThemeId;
    backgroundImageEnabled: boolean;
    backgroundImageAsset: string;
    backgroundImageSurfaceAlpha: number;
    backgroundMediaType: BackgroundMediaType;
    backgroundRenderMode: BackgroundRenderMode;
    backgroundVideoReplayMode: BackgroundVideoReplayMode;
    backgroundVideoReplayIntervalSec: number;
  };
};

type UseSubAppsState = {
  subApps: SubAppRuntimeInfo[];
  launchSubApp: (id: SubAppId) => Promise<void>;
  focusSubApp: (id: SubAppId) => Promise<void>;
  closeSubApp: (id: SubAppId) => Promise<void>;
  notifyMainShutdown: () => Promise<void>;
};

/** Main 侧 SubApp 生命周期与窗口管理。 */
export default function useSubApps({
  t,
  appearance,
}: UseSubAppsOptions): UseSubAppsState {
  const isMac = isMacOS();
  const defs = useMemo<SubAppDefinition[]>(
    () => [
      {
        id: "proxy",
        menuLabel: t("subapp.proxy.menuLabel"),
        windowTitle: t("subapp.proxy.title"),
      },
    ],
    [t],
  );
  const windowRef = useRef<Partial<Record<SubAppId, WebviewWindow>>>({});
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [statusById, setStatusById] = useState<
    Record<SubAppId, SubAppRuntimeStatus>
  >({
    proxy: "idle",
  });

  const postLifecycleMessage = useCallback(
    (message: SubAppLifecycleMessage) => {
      channelRef.current?.postMessage(message);
    },
    [],
  );
  const syncAppearance = useCallback(
    (target?: { id: SubAppId; label: string }) => {
      postLifecycleMessage({
        type: "subapp:appearance-sync",
        source: "main",
        target,
        locale: appearance.locale,
        themeId: appearance.themeId,
        backgroundImageEnabled: appearance.backgroundImageEnabled,
        backgroundImageAsset: appearance.backgroundImageAsset,
        backgroundImageSurfaceAlpha: appearance.backgroundImageSurfaceAlpha,
        backgroundMediaType: appearance.backgroundMediaType,
        backgroundRenderMode: appearance.backgroundRenderMode,
        backgroundVideoReplayMode: appearance.backgroundVideoReplayMode,
        backgroundVideoReplayIntervalSec:
          appearance.backgroundVideoReplayIntervalSec,
      });
    },
    [appearance, postLifecycleMessage],
  );

  const setRuntimeStatus = useCallback(
    (id: SubAppId, status: SubAppRuntimeStatus) => {
      setStatusById((prev) => {
        if (prev[id] === status) return prev;
        return { ...prev, [id]: status };
      });
    },
    [],
  );

  const clearWindowRuntime = useCallback(
    (id: SubAppId) => {
      delete windowRef.current[id];
      setRuntimeStatus(id, "idle");
    },
    [setRuntimeStatus],
  );

  const closeSubApp = useCallback(
    async (id: SubAppId) => {
      const label = createSubAppWindowLabel(id);
      postLifecycleMessage({
        type: "subapp:close-request",
        id,
        label,
        source: "main",
        reason: "menu",
      });
      const current = windowRef.current[id];
      if (!current) return;
      await current.close().catch(() => {});
    },
    [postLifecycleMessage],
  );

  useEffect(() => {
    const current = getCurrentWindow();
    if (current.label !== "main") return () => {};
    if (typeof BroadcastChannel === "undefined") return () => {};
    const channel = new BroadcastChannel(SUBAPP_LIFECYCLE_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const payload = event.data as SubAppLifecycleMessage | undefined;
      if (!payload) return;
      if (payload.type === "subapp:ready") {
        setRuntimeStatus(payload.id, "ready");
        syncAppearance({ id: payload.id, label: payload.label });
        return;
      }
      if (
        payload.type === "subapp:close-request" &&
        payload.source === "subapp"
      ) {
        closeSubApp(payload.id).catch(() => {});
        return;
      }
      if (payload.type === "subapp:closed") {
        clearWindowRuntime(payload.id);
      }
    };
    return () => {
      channel.close();
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
    };
  }, [clearWindowRuntime, closeSubApp, setRuntimeStatus, syncAppearance]);

  useEffect(() => {
    syncAppearance();
  }, [syncAppearance]);

  const focusSubApp = useCallback(
    async (id: SubAppId) => {
      const current = windowRef.current[id];
      if (!current) return;
      await current.setFocus().catch(() => {});
      postLifecycleMessage({
        type: "subapp:focused",
        id,
        label: createSubAppWindowLabel(id),
        source: "main",
      });
    },
    [postLifecycleMessage],
  );

  const launchSubApp = useCallback(
    async (id: SubAppId) => {
      const existing = windowRef.current[id];
      if (existing) {
        await focusSubApp(id);
        return;
      }
      const def = defs.find((item) => item.id === id);
      if (!def) return;
      const label = createSubAppWindowLabel(id);
      setRuntimeStatus(id, "launching");
      try {
        const win = new WebviewWindow(label, {
          url: `/#subapp=${id}`,
          title: def.windowTitle,
          width: 1080,
          height: 720,
          minWidth: 860,
          minHeight: 560,
          resizable: true,
          decorations: isMac,
          transparent: !isMac,
          center: true,
          visible: false,
        });
        windowRef.current[id] = win;
        postLifecycleMessage({
          type: "subapp:launch",
          id,
          label,
          source: "main",
        });
        syncAppearance({ id, label });
        win.once("tauri://destroyed", () => {
          clearWindowRuntime(id);
        });
        win.once("tauri://error", () => {
          clearWindowRuntime(id);
        });
      } catch {
        clearWindowRuntime(id);
      }
    },
    [
      clearWindowRuntime,
      defs,
      focusSubApp,
      isMac,
      postLifecycleMessage,
      setRuntimeStatus,
      syncAppearance,
    ],
  );

  const notifyMainShutdown = useCallback(async () => {
    postLifecycleMessage({
      type: "subapp:main-shutdown",
      source: "main",
    });
  }, [postLifecycleMessage]);

  const subApps = useMemo<SubAppRuntimeInfo[]>(
    () =>
      defs.map((def) => ({
        id: def.id,
        label: def.menuLabel,
        status: statusById[def.id] ?? "idle",
      })),
    [defs, statusById],
  );

  return {
    subApps,
    launchSubApp,
    focusSubApp,
    closeSubApp,
    notifyMainShutdown,
  };
}
