/**
 * @module useFloatingPanels
 * @description
 * 管理小组件“浮动窗口”生命周期与主窗口联动：
 * 1) 将当前槽位激活组件拆出并创建独立浮动窗口；
 * 2) 通过 BroadcastChannel 同步主题/语言与关闭事件；
 * 3) 浮动窗口关闭时按“关闭组件”语义处理，不自动回收到原槽位；
 * 4) 主窗口关闭时先关闭全部浮动窗口，再关闭主窗口。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import type { Locale } from "@/i18n";
import type { ThemeId, PanelKey } from "@/types";
import type {
  FloatingPanelLayout,
  WidgetSlot as LayoutWidgetSlot,
} from "@/layout/types";

type UseFloatingPanelsProps = {
  floatingPanelKey?: PanelKey | null;
  floatingOrigins: FloatingPanelLayout;
  setFloatingOrigins: React.Dispatch<React.SetStateAction<FloatingPanelLayout>>;
  slotGroups: Record<string, { active: PanelKey | null }>;
  setSlotGroups: React.Dispatch<
    React.SetStateAction<Record<string, { active: PanelKey | null }>>
  >;
  panelLabels: Record<PanelKey, string>;
  layoutCollapsed: Record<"left" | "right" | "bottom", boolean>;
  locale: Locale;
  themeId: ThemeId;
  setLocale: (locale: Locale) => void;
  setThemeId: (themeId: ThemeId) => void;
  onOpenCurrentDevtools?: () => void;
};

type FloatingPanelsState = {
  floatingPanels: Partial<Record<PanelKey, boolean>>;
  handleFloat: (slot: LayoutWidgetSlot) => Promise<void>;
  restoreFloating: (panel: PanelKey) => void;
  openAllDevtools: () => void;
};

function normalizePanelKey(value: unknown): PanelKey | null {
  if (value === "profiles") return "profiles";
  if (value === "files") return "files";
  if (value === "transfers") return "transfers";
  if (value === "events") return "events";
  if (value === "history") return "history";
  if (value === "ai") return "ai";
  if (value === "logs") return "events";
  return null;
}

function normalizeThemeId(value: unknown): ThemeId | null {
  if (value === "dark" || value === "light") return value;
  if (value === "aurora" || value === "sahara") return "dark";
  if (value === "dawn") return "light";
  return null;
}

/** 悬浮窗口控制与同步。 */
export default function useFloatingPanels({
  floatingPanelKey: floatingPanelKeyProp,
  floatingOrigins,
  setFloatingOrigins,
  slotGroups,
  setSlotGroups,
  panelLabels,
  layoutCollapsed,
  locale,
  themeId,
  setLocale,
  setThemeId,
  onOpenCurrentDevtools,
}: UseFloatingPanelsProps): FloatingPanelsState {
  const floatingPanelKey = useMemo<PanelKey | null>(() => {
    if (typeof floatingPanelKeyProp !== "undefined") {
      return floatingPanelKeyProp;
    }
    const match = window.location.hash.match(/float=([a-z]+)/i);
    if (!match) return null;
    return normalizePanelKey(match[1]);
  }, [floatingPanelKeyProp]);

  const [floatingPanels, setFloatingPanels] = useState<
    Partial<Record<PanelKey, boolean>>
  >({});
  const floatingWindowRef = useRef<Partial<Record<PanelKey, WebviewWindow>>>(
    {},
  );
  const floatSyncChannelRef = useRef<BroadcastChannel | null>(null);
  const shuttingDownRef = useRef(false);

  /** 主窗口向浮动窗口广播布局与外观状态，保证视觉与语言一致。 */
  const broadcastFloatState = useCallback(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = floatSyncChannelRef.current;
    if (!channel) return;
    channel.postMessage({
      type: "layout",
      locale,
      themeId,
      collapsed: layoutCollapsed,
      slots: slotGroups,
    });
  }, [layoutCollapsed, locale, slotGroups, themeId]);

  const restoreFloating = useCallback((panel: PanelKey) => {
    floatSyncChannelRef.current?.postMessage({
      type: "restore",
      panel,
    });
  }, []);

  const cleanupFloatingRuntime = useCallback((panel: PanelKey) => {
    delete floatingWindowRef.current[panel];
    setFloatingPanels((prev) => {
      if (!prev[panel]) return prev;
      const next = { ...prev };
      delete next[panel];
      return next;
    });
  }, []);

  /**
   * 浮动窗口配置与主窗口槽位已经解耦。
   * 关闭浮窗时只删除该组件的浮动配置，不会再回收到原始槽位。
   */
  const dismissFloatingPanel = useCallback(
    (panel: PanelKey) => {
      cleanupFloatingRuntime(panel);
      setFloatingOrigins((prev) => {
        if (!prev[panel]) return prev;
        const next = { ...prev };
        delete next[panel];
        return next;
      });
    },
    [cleanupFloatingRuntime, setFloatingOrigins],
  );

  useEffect(() => {
    /** 浮动窗口主动关闭或刷新时，通知主窗口按“关闭组件”语义清理状态。 */
    if (!floatingPanelKey) return;
    const onUnload = () => {
      restoreFloating(floatingPanelKey);
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [floatingPanelKey, restoreFloating]);

  useEffect(() => {
    /** 主窗口/浮动窗口之间通过 BroadcastChannel 协调关闭语义与主题同步。 */
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("fluxterm-float-sync");
    floatSyncChannelRef.current = channel;
    channel.onmessage = (event) => {
      const payload = event.data as
        | {
            type?: string;
            panel?: string;
            locale?: Locale;
            themeId?: ThemeId;
          }
        | undefined;
      if (!payload) return;
      if (payload.type === "restore") {
        const panel = normalizePanelKey(payload.panel);
        if (!panel) return;
        if (shuttingDownRef.current) {
          cleanupFloatingRuntime(panel);
          return;
        }
        dismissFloatingPanel(panel);
      }
      if (payload.type === "shutdown-all" && floatingPanelKey) {
        getCurrentWindow()
          .close()
          .catch(() => {});
      }
      if (payload.type === "layout" && floatingPanelKey) {
        if (payload.locale === "zh" || payload.locale === "en") {
          setLocale(payload.locale);
        }
        const normalizedThemeId = normalizeThemeId(payload.themeId);
        if (normalizedThemeId) {
          setThemeId(normalizedThemeId);
        }
      }
      if (payload.type === "devtools:open") {
        onOpenCurrentDevtools?.();
      }
    };
    return () => {
      channel.close();
      if (floatSyncChannelRef.current === channel) {
        floatSyncChannelRef.current = null;
      }
    };
  }, [
    cleanupFloatingRuntime,
    dismissFloatingPanel,
    floatingPanelKey,
    onOpenCurrentDevtools,
    setLocale,
    setThemeId,
  ]);

  useEffect(() => {
    broadcastFloatState();
  }, [broadcastFloatState]);

  useEffect(() => {
    /**
     * 主窗口关闭时先关闭所有浮动窗口，再关闭主窗口自身。
     * 这里同时使用内存引用和运行时窗口枚举，避免遗漏未记录窗口。
     */
    const current = getCurrentWindow();
    if (current.label !== "main") return () => {};
    const closingRef = { current: false };
    let stopCloseRequested: (() => void) | null = null;

    const closeWindowAndWait = (
      win?: {
        close: () => Promise<unknown>;
        once?: (event: string, handler: () => void) => unknown;
      } | null,
    ) =>
      new Promise<void>((resolve) => {
        if (!win) {
          resolve();
          return;
        }
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve();
        }, 1200);
        if (typeof win.once === "function") {
          try {
            win.once("tauri://destroyed", () => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              resolve();
            });
          } catch {
            // ignore listener errors and fallback to timeout
          }
        }
        win.close().catch(() => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve();
        });
      });

    const unlisten = current.onCloseRequested(async (event) => {
      if (closingRef.current) return;
      closingRef.current = true;
      shuttingDownRef.current = true;
      event.preventDefault();
      floatSyncChannelRef.current?.postMessage({ type: "shutdown-all" });
      stopCloseRequested?.();
      stopCloseRequested = null;
      const merged = new Map<
        string,
        {
          close: () => Promise<unknown>;
          once?: (event: string, handler: () => void) => unknown;
        }
      >();
      Object.values(floatingWindowRef.current).forEach((win) => {
        if (!win) return;
        merged.set(win.label, win);
      });
      const runtimeWindows = await getAllWindows().catch(() => []);
      runtimeWindows
        .filter((win) => win.label.startsWith("float-"))
        .forEach((win) => {
          merged.set(win.label, win);
        });
      await Promise.all(
        Array.from(merged.values()).map((win) => closeWindowAndWait(win)),
      );
      current.close().catch(() => {});
    });

    unlisten
      .then((fn) => {
        stopCloseRequested = fn;
      })
      .catch(() => {});

    return () => {
      if (stopCloseRequested) {
        stopCloseRequested();
        stopCloseRequested = null;
        return;
      }
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const openFloatingWindow = useCallback(
    async (slot: LayoutWidgetSlot, widget: PanelKey) => {
      const existing = floatingWindowRef.current[widget];
      if (existing) {
        await existing.setFocus().catch(() => {});
        return;
      }

      setFloatingPanels((prev) => ({ ...prev, [widget]: true }));

      try {
        const label = `float-${widget}`;
        const win = new WebviewWindow(label, {
          url: `/#float=${widget}`,
          title: panelLabels[widget],
          width: 900,
          height: 640,
          resizable: true,
          decorations: false,
          transparent: true,
          center: true,
          visible: false,
        });
        floatingWindowRef.current[widget] = win;
        // 正常关闭路径以下层窗口销毁为唯一事实源。
        win.once("tauri://error", () => {
          cleanupFloatingRuntime(widget);
          setFloatingOrigins((prev) => {
            if (!prev[widget]) return prev;
            const next = { ...prev };
            delete next[widget];
            return next;
          });
          setSlotGroups((prev) => {
            const group = prev[slot];
            if (!group || group.active === widget) return prev;
            return {
              ...prev,
              [slot]: {
                active: widget,
              },
            };
          });
        });
        win.once("tauri://destroyed", () => {
          if (shuttingDownRef.current) {
            cleanupFloatingRuntime(widget);
            return;
          }
          dismissFloatingPanel(widget);
        });
      } catch {
        cleanupFloatingRuntime(widget);
        setFloatingOrigins((prev) => {
          if (!prev[widget]) return prev;
          const next = { ...prev };
          delete next[widget];
          return next;
        });
        setSlotGroups((prev) => {
          const group = prev[slot];
          if (!group || group.active === widget) return prev;
          return {
            ...prev,
            [slot]: {
              active: widget,
            },
          };
        });
      }
    },
    [
      cleanupFloatingRuntime,
      dismissFloatingPanel,
      panelLabels,
      setFloatingOrigins,
      setSlotGroups,
    ],
  );

  useEffect(() => {
    if (floatingPanelKey) return;
    // 主窗口已经进入退出流程时，不再根据持久化 floating 配置自动恢复浮窗；
    // 否则某个浮窗刚被 shutdown-all 关闭，又会因为配置仍在而被重新创建。
    if (shuttingDownRef.current) return;
    (
      Object.entries(floatingOrigins) as Array<
        [string, { origin: LayoutWidgetSlot }]
      >
    ).forEach(([panel, value]) => {
      const normalizedPanel = normalizePanelKey(panel);
      if (!normalizedPanel) return;
      if (
        floatingPanels[normalizedPanel] ||
        floatingWindowRef.current[normalizedPanel]
      ) {
        return;
      }
      openFloatingWindow(value.origin, normalizedPanel).catch(() => {});
    });
  }, [floatingPanelKey, floatingOrigins, floatingPanels, openFloatingWindow]);

  const handleFloat = useCallback(
    async (slot: LayoutWidgetSlot) => {
      const widget = slotGroups[slot].active;
      if (!widget) return;
      const hasTauriRuntime =
        typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
      if (!hasTauriRuntime) return;

      setFloatingOrigins((prev) => ({
        ...prev,
        [widget]: { origin: slot },
      }));
      setSlotGroups((prev) => {
        const group = prev[slot];
        if (!group || group.active !== widget) return prev;
        return {
          ...prev,
          [slot]: {
            active: null,
          },
        };
      });
      await openFloatingWindow(slot, widget);
    },
    [openFloatingWindow, setFloatingOrigins, setSlotGroups, slotGroups],
  );

  /** 通知所有窗口打开开发者工具。 */
  const openAllDevtools = useCallback(() => {
    floatSyncChannelRef.current?.postMessage({ type: "devtools:open" });
  }, []);

  return {
    floatingPanels,
    handleFloat,
    restoreFloating,
    openAllDevtools,
  };
}
