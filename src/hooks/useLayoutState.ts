import { useEffect, useMemo, useRef, useState } from "react";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { warn } from "@tauri-apps/plugin-log";
import {
  defaultWidgetLayout,
  increaseSideSlots,
  normalizeWidgetLayout,
  sideSlotKey,
} from "@/layout/model";
import type {
  WidgetLayout,
  WidgetGroup,
  WidgetSide,
  WidgetSlot,
} from "@/layout/types";
import type { PanelKey } from "@/types";
import { getFluxTermConfigDir, getLayoutPath } from "@/shared/config/paths";

type LayoutState = {
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  sideSlotCounts: Record<WidgetSide, number>;
  slotGroups: Record<string, WidgetGroup>;
  panelSizes: { left: number; right: number; bottom: number };
  leftVisible: boolean;
  rightVisible: boolean;
  bottomVisible: boolean;
  layoutVars: React.CSSProperties;
  setSlotGroups: React.Dispatch<
    React.SetStateAction<Record<string, WidgetGroup>>
  >;
  setPanelCollapsed: (side: WidgetSide | "bottom", collapsed: boolean) => void;
  handleToggleSplit: (side: WidgetSide) => void;
  handleCloseSlot: (slot: WidgetSlot) => void;
  handleToggleCollapsed: (side: WidgetSide | "bottom") => void;
  startResize: (
    mode: "left" | "right" | "bottom",
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
};

type UseLayoutStateProps = {
  floatingPanelKey: PanelKey | null;
  floatingOriginRef: React.RefObject<Partial<Record<PanelKey, WidgetSlot>>>;
};

/** 布局状态管理（读取/保存/拖拽调整）。 */
export default function useLayoutState({
  floatingPanelKey,
  floatingOriginRef,
}: UseLayoutStateProps): LayoutState {
  const [layoutCollapsed, setLayoutCollapsed] = useState(
    defaultWidgetLayout.collapsed,
  );
  const [sideSlotCounts, setSideSlotCounts] = useState(
    defaultWidgetLayout.sideSlotCounts,
  );
  const [slotGroups, setSlotGroups] = useState(defaultWidgetLayout.slots);
  const [panelSizes, setPanelSizes] = useState(defaultWidgetLayout.sizes);

  const dragState = useRef<{
    mode: "left" | "right" | "bottom";
    startX: number;
    startY: number;
    startLeft: number;
    startRight: number;
    startBottom: number;
  } | null>(null);
  const layoutLoadedRef = useRef(false);
  const layoutSaveTimerRef = useRef<number | null>(null);

  function buildPersistentSlots(
    slots: Record<string, WidgetGroup>,
  ): Record<string, WidgetGroup> {
    const next: Record<string, WidgetGroup> = {};
    Object.entries(slots).forEach(([slot, group]) => {
      next[slot as WidgetSlot] = { ...group };
    });
    (Object.keys(floatingOriginRef.current) as PanelKey[]).forEach((panel) => {
      const origin = floatingOriginRef.current[panel];
      if (!origin) return;
      Object.values(next).forEach((group) => {
        if (group.active === panel) {
          group.active = null;
        }
      });
      if (!next[origin]) {
        next[origin] = { active: null, floating: false };
      }
      next[origin].active = panel;
    });
    return next;
  }

  async function loadLayoutConfig() {
    try {
      const path = await getLayoutPath();
      const existsFile = await exists(path);
      let raw: string | null = null;
      if (existsFile) {
        raw = await readTextFile(path);
      }
      if (!raw) {
        layoutLoadedRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      // layout.json 缺少 version 视为无效并回退默认布局。
      const normalized = normalizeWidgetLayout(parsed);
      if (!normalized) {
        layoutLoadedRef.current = true;
        return;
      }
      const totalWidgets = Object.values(normalized.slots).reduce(
        (count, group) => count + (group.active ? 1 : 0),
        0,
      );
      if (totalWidgets === 0) {
        setLayoutCollapsed(defaultWidgetLayout.collapsed);
        setSideSlotCounts(defaultWidgetLayout.sideSlotCounts);
        setSlotGroups(defaultWidgetLayout.slots);
        setPanelSizes(defaultWidgetLayout.sizes);
        layoutLoadedRef.current = true;
        return;
      }
      setLayoutCollapsed(normalized.collapsed);
      setSideSlotCounts(normalized.sideSlotCounts);
      setSlotGroups(normalized.slots);
      setPanelSizes(normalized.sizes);
    } catch (error) {
      warn(
        JSON.stringify({
          event: "layout:load-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      layoutLoadedRef.current = true;
    }
  }

  async function saveLayoutConfig(payload: WidgetLayout) {
    const dir = await getFluxTermConfigDir();
    await mkdir(dir, { recursive: true });
    const path = await getLayoutPath();
    await writeTextFile(path, JSON.stringify(payload, null, 2));
  }

  function handleToggleSplit(side: WidgetSide) {
    setSideSlotCounts((prev) => {
      const currentCount = prev[side];
      const result = increaseSideSlots(slotGroups, side, currentCount);
      setSlotGroups(result.slots);
      return { ...prev, [side]: result.nextCount };
    });
  }

  function handleCloseSlot(slot: WidgetSlot) {
    if (slot === "bottom") {
      setSlotGroups((prev) => {
        const group = prev.bottom;
        if (!group?.active) return prev;
        return {
          ...prev,
          bottom: { ...group, active: null },
        };
      });
      return;
    }

    const match = slot.match(/^(left|right):(\d+)$/);
    if (!match) return;
    const side = match[1] as WidgetSide;
    const index = Number(match[2]);
    if (!Number.isInteger(index) || index < 0) return;

    const currentCount = sideSlotCounts[side];
    if (index >= currentCount) return;

    if (currentCount <= 1) {
      setSlotGroups((prev) => {
        const group = prev[slot];
        if (!group?.active) return prev;
        return {
          ...prev,
          [slot]: { ...group, active: null },
        };
      });
      return;
    }

    setSlotGroups((prev) => {
      const next: Record<string, WidgetGroup> = {};
      Object.entries(prev).forEach(([key, group]) => {
        if (key === "bottom") {
          next.bottom = { ...group };
          return;
        }
        const item = key.match(/^(left|right):(\d+)$/);
        if (!item) return;
        const itemSide = item[1] as WidgetSide;
        const itemIndex = Number(item[2]);
        if (itemSide !== side) {
          next[key] = { ...group };
          return;
        }
        if (itemIndex === index) return;
        const targetIndex = itemIndex > index ? itemIndex - 1 : itemIndex;
        next[`${side}:${targetIndex}`] = { ...group };
      });
      return next;
    });
    setSideSlotCounts((prev) => ({
      ...prev,
      [side]: Math.max(1, prev[side] - 1),
    }));
  }

  function handleToggleCollapsed(side: WidgetSide | "bottom") {
    setLayoutCollapsed((prev) => ({ ...prev, [side]: !prev[side] }));
  }

  function setPanelCollapsed(side: WidgetSide | "bottom", collapsed: boolean) {
    setLayoutCollapsed((prev) => {
      if (prev[side] === collapsed) return prev;
      return { ...prev, [side]: collapsed };
    });
  }

  function startResize(
    mode: "left" | "right" | "bottom",
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragState.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panelSizes.left,
      startRight: panelSizes.right,
      startBottom: panelSizes.bottom,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      mode === "bottom" ? "row-resize" : "col-resize";
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", stopResize);
  }

  function handleResizeMove(event: MouseEvent) {
    const drag = dragState.current;
    if (!drag) return;
    if (drag.mode === "left") {
      const min = 220;
      const max = Math.max(min, Math.min(520, window.innerWidth * 0.5));
      const next = Math.min(
        max,
        Math.max(min, drag.startLeft + (event.clientX - drag.startX)),
      );
      setPanelSizes((prev) => ({ ...prev, left: next }));
    } else if (drag.mode === "right") {
      const min = 260;
      const max = Math.max(min, Math.min(560, window.innerWidth * 0.5));
      const next = Math.min(
        max,
        Math.max(min, drag.startRight - (event.clientX - drag.startX)),
      );
      setPanelSizes((prev) => ({ ...prev, right: next }));
    } else if (drag.mode === "bottom") {
      const min = 160;
      const max = Math.max(min, Math.min(420, window.innerHeight * 0.6));
      const next = Math.min(
        max,
        Math.max(min, drag.startBottom - (event.clientY - drag.startY)),
      );
      setPanelSizes((prev) => ({ ...prev, bottom: next }));
    }
  }

  function stopResize() {
    dragState.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", stopResize);
  }

  const leftVisible = !layoutCollapsed.left;
  const rightVisible = !layoutCollapsed.right;
  const bottomVisible = !layoutCollapsed.bottom;

  const layoutVars = useMemo(() => {
    const hasSidePanels = leftVisible || rightVisible;
    const hasAnyPanels = hasSidePanels || bottomVisible;
    return {
      "--left-width": leftVisible ? `${panelSizes.left}px` : "0px",
      "--right-width": rightVisible ? `${panelSizes.right}px` : "0px",
      "--left-resizer": leftVisible ? "8px" : "0px",
      "--right-resizer": rightVisible ? "8px" : "0px",
      "--bottom-resizer": bottomVisible ? "8px" : "0px",
      "--bottom-height": bottomVisible ? `${panelSizes.bottom}px` : "0px",
      "--workspace-pad": hasAnyPanels ? "16px" : "0px",
    } as React.CSSProperties;
  }, [leftVisible, rightVisible, bottomVisible, panelSizes]);

  useEffect(() => {
    loadLayoutConfig().catch(() => {});
  }, []);

  useEffect(() => {
    if (!layoutLoadedRef.current) return;
    if (floatingPanelKey) return;
    if (layoutSaveTimerRef.current) {
      window.clearTimeout(layoutSaveTimerRef.current);
    }
    layoutSaveTimerRef.current = window.setTimeout(() => {
      const persistedSlots = buildPersistentSlots(slotGroups);
      const normalizedCounts = {
        left: Math.max(1, sideSlotCounts.left),
        right: Math.max(1, sideSlotCounts.right),
      };
      for (let i = 0; i < normalizedCounts.left; i += 1) {
        const key = sideSlotKey("left", i);
        if (!persistedSlots[key]) {
          persistedSlots[key] = { active: null, floating: false };
        }
      }
      for (let i = 0; i < normalizedCounts.right; i += 1) {
        const key = sideSlotKey("right", i);
        if (!persistedSlots[key]) {
          persistedSlots[key] = { active: null, floating: false };
        }
      }
      if (!persistedSlots.bottom) {
        persistedSlots.bottom = { active: null, floating: false };
      }
      saveLayoutConfig({
        version: 1,
        collapsed: layoutCollapsed,
        sideSlotCounts: normalizedCounts,
        slots: persistedSlots,
        sizes: panelSizes,
      }).catch((error) => {
        warn(
          JSON.stringify({
            event: "layout:save-failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    }, 300);
    return () => {
      if (layoutSaveTimerRef.current) {
        window.clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
    };
  }, [
    floatingPanelKey,
    layoutCollapsed,
    sideSlotCounts,
    slotGroups,
    panelSizes,
  ]);

  return {
    layoutCollapsed,
    sideSlotCounts,
    slotGroups,
    panelSizes,
    leftVisible,
    rightVisible,
    bottomVisible,
    layoutVars,
    setSlotGroups,
    setPanelCollapsed,
    handleToggleSplit,
    handleCloseSlot,
    handleToggleCollapsed,
    startResize,
  };
}
