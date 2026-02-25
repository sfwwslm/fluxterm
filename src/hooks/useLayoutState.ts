import { useEffect, useMemo, useRef, useState } from "react";
import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
  applySplitMode,
  defaultLayoutV2,
  normalizeLayoutV2,
} from "@/layout/model";
import type {
  LayoutConfigV2,
  WidgetGroup,
  WidgetSide,
  WidgetSlot as LayoutWidgetSlot,
} from "@/layout/types";
import type { PanelKey } from "@/types";

type LayoutState = {
  layoutSplit: Record<WidgetSide, boolean>;
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  layoutSplitRatio: Record<WidgetSide, number>;
  slotGroups: Record<LayoutWidgetSlot, WidgetGroup>;
  panelSizes: { left: number; right: number; bottom: number };
  leftVisible: boolean;
  rightVisible: boolean;
  bottomVisible: boolean;
  layoutVars: React.CSSProperties;
  setSlotGroups: React.Dispatch<
    React.SetStateAction<Record<LayoutWidgetSlot, WidgetGroup>>
  >;
  handleToggleSplit: (side: WidgetSide) => void;
  handleToggleCollapsed: (side: WidgetSide | "bottom") => void;
  startResize: (
    mode: "left" | "right" | "bottom",
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  startSlotResize: (
    side: WidgetSide,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
};

type UseLayoutStateProps = {
  floatingPanelKey: PanelKey | null;
  floatingOriginRef: React.MutableRefObject<
    Partial<Record<PanelKey, LayoutWidgetSlot>>
  >;
};

/** 布局状态管理（读取/保存/拖拽调整）。 */
export default function useLayoutState({
  floatingPanelKey,
  floatingOriginRef,
}: UseLayoutStateProps): LayoutState {
  const [layoutSplit, setLayoutSplit] = useState(defaultLayoutV2.split);
  const [layoutCollapsed, setLayoutCollapsed] = useState(
    defaultLayoutV2.collapsed,
  );
  const [layoutSplitRatio, setLayoutSplitRatio] = useState(
    defaultLayoutV2.splitRatio,
  );
  const [slotGroups, setSlotGroups] = useState(defaultLayoutV2.slots);
  const [panelSizes, setPanelSizes] = useState(defaultLayoutV2.sizes);

  const dragState = useRef<{
    mode: "left" | "right" | "bottom" | "leftSlot" | "rightSlot";
    startX: number;
    startY: number;
    startLeft: number;
    startRight: number;
    startBottom: number;
    startRatio: number;
    slotContainerHeight: number;
  } | null>(null);
  const layoutPathRef = useRef<string | null>(null);
  const layoutLoadedRef = useRef(false);
  const layoutSaveTimerRef = useRef<number | null>(null);
  const configDirRef = useRef<string | null>(null);

  function buildPersistentSlots(
    slots: Record<LayoutWidgetSlot, WidgetGroup>,
  ): Record<LayoutWidgetSlot, WidgetGroup> {
    const next: Record<LayoutWidgetSlot, WidgetGroup> = {
      leftTop: { ...slots.leftTop, widgets: [...slots.leftTop.widgets] },
      leftBottom: {
        ...slots.leftBottom,
        widgets: [...slots.leftBottom.widgets],
      },
      rightTop: { ...slots.rightTop, widgets: [...slots.rightTop.widgets] },
      rightBottom: {
        ...slots.rightBottom,
        widgets: [...slots.rightBottom.widgets],
      },
      bottom: { ...slots.bottom, widgets: [...slots.bottom.widgets] },
    };
    (Object.keys(floatingOriginRef.current) as PanelKey[]).forEach((panel) => {
      const origin = floatingOriginRef.current[panel];
      if (!origin) return;
      (Object.keys(next) as LayoutWidgetSlot[]).forEach((slot) => {
        const group = next[slot];
        group.widgets = group.widgets.filter((item) => item !== panel);
        if (group.active === panel) {
          group.active = group.widgets[0] ?? null;
        }
      });
      const target = next[origin];
      target.widgets.push(panel);
      target.active = target.active ?? panel;
    });
    return next;
  }

  async function getConfigDir() {
    if (configDirRef.current) return configDirRef.current;
    const dir = await appConfigDir();
    const path = await join(dir, "flux-term");
    configDirRef.current = path;
    return path;
  }

  async function getLayoutConfigPath() {
    if (layoutPathRef.current) return layoutPathRef.current;
    const dir = await getConfigDir();
    const path = await join(dir, "layout.json");
    layoutPathRef.current = path;
    return path;
  }

  async function loadLayoutConfig() {
    try {
      const path = await getLayoutConfigPath();
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
      const normalized = normalizeLayoutV2(parsed);
      if (!normalized) {
        layoutLoadedRef.current = true;
        return;
      }
      const totalWidgets = Object.values(normalized.slots).reduce(
        (count, group) => count + group.widgets.length,
        0,
      );
      if (totalWidgets === 0) {
        setLayoutSplit(defaultLayoutV2.split);
        setLayoutCollapsed(defaultLayoutV2.collapsed);
        setLayoutSplitRatio(defaultLayoutV2.splitRatio);
        setSlotGroups(defaultLayoutV2.slots);
        setPanelSizes(defaultLayoutV2.sizes);
        layoutLoadedRef.current = true;
        return;
      }
      setLayoutSplit(normalized.split);
      setLayoutCollapsed(normalized.collapsed);
      setLayoutSplitRatio(normalized.splitRatio);
      setSlotGroups(normalized.slots);
      setPanelSizes(normalized.sizes);
    } catch {
      // Ignore invalid layout config.
    } finally {
      layoutLoadedRef.current = true;
    }
  }

  async function saveLayoutConfig(payload: LayoutConfigV2) {
    const dir = await getConfigDir();
    await mkdir(dir, { recursive: true });
    const path = await getLayoutConfigPath();
    await writeTextFile(path, JSON.stringify(payload, null, 2));
  }

  function handleToggleSplit(side: WidgetSide) {
    const nextSplit = !layoutSplit[side];
    setLayoutSplit((prev) => ({ ...prev, [side]: nextSplit }));
    setSlotGroups((prev) => applySplitMode(prev, side, nextSplit));
  }

  function handleToggleCollapsed(side: WidgetSide | "bottom") {
    setLayoutCollapsed((prev) => ({ ...prev, [side]: !prev[side] }));
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
      startRatio: 0.5,
      slotContainerHeight: 1,
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

  function startSlotResize(
    side: WidgetSide,
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    dragState.current = {
      mode: side === "left" ? "leftSlot" : "rightSlot",
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panelSizes.left,
      startRight: panelSizes.right,
      startBottom: panelSizes.bottom,
      startRatio: layoutSplitRatio[side],
      slotContainerHeight: container.getBoundingClientRect().height,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", handleSlotResizeMove);
    window.addEventListener("mouseup", stopSlotResize);
  }

  function handleSlotResizeMove(event: MouseEvent) {
    const drag = dragState.current;
    if (!drag) return;
    if (drag.mode !== "leftSlot" && drag.mode !== "rightSlot") return;
    const next =
      drag.startRatio +
      (event.clientY - drag.startY) / drag.slotContainerHeight;
    const clamped = Math.min(0.8, Math.max(0.2, next));
    setLayoutSplitRatio((prev) => ({
      ...prev,
      [drag.mode === "leftSlot" ? "left" : "right"]: clamped,
    }));
  }

  function stopSlotResize() {
    dragState.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", handleSlotResizeMove);
    window.removeEventListener("mouseup", stopSlotResize);
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
      saveLayoutConfig({
        version: 2,
        collapsed: layoutCollapsed,
        split: layoutSplit,
        splitRatio: layoutSplitRatio,
        slots: persistedSlots,
        sizes: panelSizes,
      }).catch(() => {});
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
    layoutSplit,
    layoutSplitRatio,
    slotGroups,
    panelSizes,
  ]);

  return {
    layoutSplit,
    layoutCollapsed,
    layoutSplitRatio,
    slotGroups,
    panelSizes,
    leftVisible,
    rightVisible,
    bottomVisible,
    layoutVars,
    setSlotGroups,
    handleToggleSplit,
    handleToggleCollapsed,
    startResize,
    startSlotResize,
  };
}
