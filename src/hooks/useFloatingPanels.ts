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
  WidgetGroup,
  WidgetSlot as LayoutWidgetSlot,
} from "@/layout/types";
import { moveWidgetToSlot } from "@/layout/model";

type UseFloatingPanelsProps = {
  floatingPanelKey?: PanelKey | null;
  floatingOriginRef?: React.RefObject<
    Partial<Record<PanelKey, LayoutWidgetSlot>>
  >;
  slotGroups: Record<string, WidgetGroup>;
  setSlotGroups: React.Dispatch<
    React.SetStateAction<Record<string, WidgetGroup>>
  >;
  panelLabels: Record<PanelKey, string>;
  layoutCollapsed: Record<"left" | "right" | "bottom", boolean>;
  locale: Locale;
  themeId: ThemeId;
  setLocale: (locale: Locale) => void;
  setThemeId: (themeId: ThemeId) => void;
};

type FloatingPanelsState = {
  floatingOriginRef: React.RefObject<
    Partial<Record<PanelKey, LayoutWidgetSlot>>
  >;
  floatingPanels: Partial<Record<PanelKey, boolean>>;
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
  layoutCollapsed,
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
  const [floatingPanels, setFloatingPanels] = useState<
    Partial<Record<PanelKey, boolean>>
  >({});
  const floatingWindowRef = useRef<Partial<Record<PanelKey, WebviewWindow>>>(
    {},
  );
  const floatSyncChannelRef = useRef<BroadcastChannel | null>(null);

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

  /**
   * 浮动窗口关闭后等价于“关闭组件”而不是“还原到主窗口”。
   * 这里只清理主窗口中的浮动记录，不把组件放回原始槽位。
   */
  const dismissFloatingPanel = useCallback((panel: PanelKey) => {
    delete floatingOriginRef.current[panel];
    delete floatingWindowRef.current[panel];
    setFloatingPanels((prev) => {
      if (!prev[panel]) return prev;
      const next = { ...prev };
      delete next[panel];
      return next;
    });
  }, []);

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
        // 收到关闭事件后，仅清理浮动状态，不回收到主窗口。
        const panel = normalizePanelKey(payload.panel);
        if (!panel) return;
        dismissFloatingPanel(panel);
      }
      if (payload.type === "layout" && floatingPanelKey) {
        // 浮动窗口仅消费主窗口广播的外观设置，不改动布局数据。
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
  }, [dismissFloatingPanel, floatingPanelKey, setLocale, setThemeId]);

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
      event.preventDefault();
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
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const handleFloat = useCallback(
    async (slot: LayoutWidgetSlot) => {
      // 1) 从当前槽位取出激活组件；2) 创建浮动窗口；3) 绑定关闭/销毁时的关闭逻辑。
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
      setFloatingPanels((prev) => ({ ...prev, [widget]: true }));
      setSlotGroups((prev) => {
        // 悬浮后立即从当前槽位移除该组件，避免主窗口和浮动窗口重复渲染。
        const group = prev[slot];
        return {
          ...prev,
          [slot]: {
            ...group,
            active: null,
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
        // 正常关闭路径以下层窗口销毁为唯一事实源：
        // 关闭按钮先让 Tauri 自己完成窗口关闭流程，只有真正 destroyed 后
        // 主窗口才把该面板视为“已关闭”，避免先停掉 SFTP/联动、再关窗口的两段式体验。
        win.once("tauri://error", () => {
          // 创建失败时回滚状态，保证组件不丢失。
          delete floatingWindowRef.current[widget];
          setFloatingPanels((prev) => {
            if (!prev[widget]) return prev;
            const next = { ...prev };
            delete next[widget];
            return next;
          });
          const origin = floatingOriginRef.current[widget] ?? slot;
          delete floatingOriginRef.current[widget];
          setSlotGroups((prev) => moveWidgetToSlot(prev, widget, origin));
        });
        win.once("tauri://destroyed", () => {
          // 窗口被系统销毁后同样视为组件关闭，不再放回主窗口。
          dismissFloatingPanel(widget);
        });
      } catch {
        // 创建过程中抛错时兜底恢复组件位置。
        setFloatingPanels((prev) => {
          if (!prev[widget]) return prev;
          const next = { ...prev };
          delete next[widget];
          return next;
        });
        const origin = floatingOriginRef.current[widget] ?? slot;
        delete floatingOriginRef.current[widget];
        setSlotGroups((prev) => moveWidgetToSlot(prev, widget, origin));
      }
    },
    [dismissFloatingPanel, panelLabels, setSlotGroups, slotGroups],
  );

  return {
    floatingOriginRef,
    floatingPanels,
    handleFloat,
    restoreFloating,
  };
}
