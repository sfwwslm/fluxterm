import { useCallback, useEffect, useMemo, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Locale } from "@/i18n";
import type { ThemeId, PanelKey } from "@/types";
import type {
  WidgetGroup,
  WidgetSlot as LayoutWidgetSlot,
} from "@/layout/types";
import { moveWidgetToSlot } from "@/layout/model";

type UseFloatingPanelsProps = {
  floatingPanelKey?: PanelKey | null;
  floatingOriginRef?: React.MutableRefObject<
    Partial<Record<PanelKey, LayoutWidgetSlot>>
  >;
  slotGroups: Record<LayoutWidgetSlot, WidgetGroup>;
  setSlotGroups: React.Dispatch<
    React.SetStateAction<Record<LayoutWidgetSlot, WidgetGroup>>
  >;
  panelLabels: Record<PanelKey, string>;
  layoutSplit: Record<"left" | "right", boolean>;
  layoutCollapsed: Record<"left" | "right" | "bottom", boolean>;
  layoutSplitRatio: Record<"left" | "right", number>;
  locale: Locale;
  themeId: ThemeId;
  setLocale: (locale: Locale) => void;
  setThemeId: (themeId: ThemeId) => void;
};

type FloatingPanelsState = {
  floatingOriginRef: React.MutableRefObject<
    Partial<Record<PanelKey, LayoutWidgetSlot>>
  >;
  handleFloat: (slot: LayoutWidgetSlot) => Promise<void>;
  restoreFloating: (panel: PanelKey) => void;
};

function normalizePanelKey(value: unknown): PanelKey | null {
  if (value === "profiles") return "profiles";
  if (value === "files") return "files";
  if (value === "transfers") return "transfers";
  if (value === "events") return "events";
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
  floatingOriginRef: floatingOriginRefProp,
  slotGroups,
  setSlotGroups,
  panelLabels,
  layoutSplit,
  layoutCollapsed,
  layoutSplitRatio,
  locale,
  themeId,
  setLocale,
  setThemeId,
}: UseFloatingPanelsProps): FloatingPanelsState {
  const floatingPanelKey = useMemo<PanelKey | null>(() => {
    if (typeof floatingPanelKeyProp !== "undefined") {
      return floatingPanelKeyProp;
    }
    const match = window.location.hash.match(/float=([a-z]+)/i);
    if (!match) return null;
    return normalizePanelKey(match[1]);
  }, [floatingPanelKeyProp]);

  const floatingOriginRef =
    floatingOriginRefProp ??
    useRef<Partial<Record<PanelKey, LayoutWidgetSlot>>>({});
  const floatingWindowRef = useRef<Partial<Record<PanelKey, WebviewWindow>>>(
    {},
  );
  const floatSyncChannelRef = useRef<BroadcastChannel | null>(null);

  const broadcastFloatState = useCallback(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = floatSyncChannelRef.current;
    if (!channel) return;
    channel.postMessage({
      type: "layout",
      locale,
      themeId,
      collapsed: layoutCollapsed,
      split: layoutSplit,
      splitRatio: layoutSplitRatio,
      slots: slotGroups,
    });
  }, [
    layoutCollapsed,
    layoutSplit,
    layoutSplitRatio,
    locale,
    slotGroups,
    themeId,
  ]);

  const restoreFloating = useCallback((panel: PanelKey) => {
    floatSyncChannelRef.current?.postMessage({
      type: "restore",
      panel,
    });
  }, []);

  useEffect(() => {
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
        const origin = floatingOriginRef.current[panel] ?? "bottom";
        delete floatingOriginRef.current[panel];
        delete floatingWindowRef.current[panel];
        setSlotGroups((prev) => moveWidgetToSlot(prev, panel, origin));
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
    };
    return () => {
      channel.close();
      if (floatSyncChannelRef.current === channel) {
        floatSyncChannelRef.current = null;
      }
    };
  }, [floatingPanelKey, setLocale, setThemeId, setSlotGroups]);

  useEffect(() => {
    broadcastFloatState();
  }, [broadcastFloatState]);

  useEffect(() => {
    const current = getCurrentWindow();
    if (current.label !== "main") return () => {};
    const closingRef = { current: false };

    const closeWindowAndWait = (win?: WebviewWindow | null) =>
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
        win.once("tauri://destroyed", () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve();
        });
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
      event.preventDefault();
      const windows = Object.values(floatingWindowRef.current);
      await Promise.all(windows.map((win) => closeWindowAndWait(win)));
      current.close().catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const handleFloat = useCallback(
    async (slot: LayoutWidgetSlot) => {
      const widget = slotGroups[slot].active;
      if (!widget) return;
      const hasTauriRuntime =
        typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
      if (!hasTauriRuntime) return;
      const existing = floatingWindowRef.current[widget];
      if (existing) {
        await existing.setFocus().catch(() => {});
        return;
      }
      floatingOriginRef.current[widget] = slot;
      setSlotGroups((prev) => {
        const group = prev[slot];
        const widgets = group.widgets.filter((item) => item !== widget);
        return {
          ...prev,
          [slot]: {
            ...group,
            widgets,
            active: widgets[0] ?? null,
          },
        };
      });
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
        win.once("tauri://close-requested", async () => {
          delete floatingWindowRef.current[widget];
          const origin = floatingOriginRef.current[widget] ?? slot;
          delete floatingOriginRef.current[widget];
          setSlotGroups((prev) => moveWidgetToSlot(prev, widget, origin));
          await win.close();
        });
        win.once("tauri://error", () => {
          delete floatingWindowRef.current[widget];
          const origin = floatingOriginRef.current[widget] ?? slot;
          delete floatingOriginRef.current[widget];
          setSlotGroups((prev) => moveWidgetToSlot(prev, widget, origin));
        });
        win.once("tauri://destroyed", () => {
          delete floatingWindowRef.current[widget];
          const origin = floatingOriginRef.current[widget] ?? slot;
          delete floatingOriginRef.current[widget];
          setSlotGroups((prev) => moveWidgetToSlot(prev, widget, origin));
        });
      } catch {
        const origin = floatingOriginRef.current[widget] ?? slot;
        delete floatingOriginRef.current[widget];
        setSlotGroups((prev) => moveWidgetToSlot(prev, widget, origin));
      }
    },
    [panelLabels, setSlotGroups, slotGroups],
  );

  return {
    floatingOriginRef,
    handleFloat,
    restoreFloating,
  };
}
