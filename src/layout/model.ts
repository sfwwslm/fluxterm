import type { PanelKey } from "@/types";
import type {
  LayoutConfigV2,
  WidgetGroup,
  WidgetSide,
  WidgetSlot,
} from "./types";

/** 所有可用组件键。 */
export const allPanelKeys: PanelKey[] = [
  "profiles",
  "files",
  "transfers",
  "events",
];

/** 默认布局（v2）。 */
export const defaultLayoutV2: LayoutConfigV2 = {
  version: 2,
  sizes: {
    left: 320,
    right: 360,
    bottom: 240,
  },
  collapsed: {
    left: false,
    right: false,
    bottom: false,
  },
  split: {
    left: true,
    right: true,
  },
  splitRatio: {
    left: 0.5,
    right: 0.5,
  },
  slots: {
    leftTop: { widgets: ["profiles"], active: "profiles", floating: false },
    leftBottom: { widgets: [], active: null, floating: false },
    rightTop: { widgets: ["files"], active: "files", floating: false },
    rightBottom: { widgets: [], active: null, floating: false },
    bottom: {
      widgets: ["transfers", "events"],
      active: "transfers",
      floating: false,
    },
  },
};

/** 创建空组件组。 */
export function createEmptyGroup(): WidgetGroup {
  return { widgets: [], active: null, floating: false };
}

/** 判断槽位组件组是否可显示。 */
export function hasVisibleWidget(group: WidgetGroup) {
  return !group.floating && group.widgets.length > 0 && group.active !== null;
}

/** 获取左右区域包含的槽位。 */
export function sideSlots(side: WidgetSide): [WidgetSlot, WidgetSlot] {
  return side === "left"
    ? ["leftTop", "leftBottom"]
    : ["rightTop", "rightBottom"];
}

/** 统一规范组件组，确保 active 合法。 */
export function normalizeGroup(group: unknown): WidgetGroup {
  if (!group || typeof group !== "object") return createEmptyGroup();
  const raw = group as Partial<WidgetGroup>;
  const widgets = Array.isArray(raw.widgets)
    ? raw.widgets
        .map((item) => normalizePanelKey(item))
        .filter((item): item is PanelKey => Boolean(item))
    : [];
  const deduped = Array.from(new Set(widgets));
  const normalizedActive = normalizePanelKey(raw.active);
  const active =
    normalizedActive && deduped.includes(normalizedActive)
      ? normalizedActive
      : (deduped[0] ?? null);
  return {
    widgets: deduped,
    active,
    // 浮动窗口是运行时状态，不应持久化恢复为 true。
    floating: false,
  };
}

/** 规范布局配置。 */
export function normalizeLayoutV2(raw: unknown): LayoutConfigV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<LayoutConfigV2>;
  if (value.version !== 2) return null;
  if (!value.sizes || !value.split || !value.slots) return null;
  const slots: Record<WidgetSlot, WidgetGroup> = {
    leftTop: normalizeGroup(value.slots.leftTop),
    leftBottom: normalizeGroup(value.slots.leftBottom),
    rightTop: normalizeGroup(value.slots.rightTop),
    rightBottom: normalizeGroup(value.slots.rightBottom),
    bottom: normalizeGroup(value.slots.bottom),
  };
  const used = new Set<PanelKey>();
  (Object.keys(slots) as WidgetSlot[]).forEach((slot) => {
    const next = slots[slot].widgets.filter((item) => {
      if (used.has(item)) return false;
      used.add(item);
      return true;
    });
    slots[slot] = {
      ...slots[slot],
      widgets: next,
      active: next.includes(slots[slot].active as PanelKey)
        ? slots[slot].active
        : (next[0] ?? null),
    };
  });
  return {
    version: 2,
    sizes: {
      left: clampNumber(value.sizes.left, 220, 520, defaultLayoutV2.sizes.left),
      right: clampNumber(
        value.sizes.right,
        260,
        560,
        defaultLayoutV2.sizes.right,
      ),
      bottom: clampNumber(
        value.sizes.bottom,
        160,
        420,
        defaultLayoutV2.sizes.bottom,
      ),
    },
    collapsed: {
      left:
        typeof value.collapsed?.left === "boolean"
          ? value.collapsed.left
          : defaultLayoutV2.collapsed.left,
      right:
        typeof value.collapsed?.right === "boolean"
          ? value.collapsed.right
          : defaultLayoutV2.collapsed.right,
      bottom:
        typeof value.collapsed?.bottom === "boolean"
          ? value.collapsed.bottom
          : defaultLayoutV2.collapsed.bottom,
    },
    split: {
      left:
        typeof value.split.left === "boolean"
          ? value.split.left
          : defaultLayoutV2.split.left,
      right:
        typeof value.split.right === "boolean"
          ? value.split.right
          : defaultLayoutV2.split.right,
    },
    splitRatio: {
      left: clampNumber(
        value.splitRatio?.left,
        0.2,
        0.8,
        defaultLayoutV2.splitRatio.left,
      ),
      right: clampNumber(
        value.splitRatio?.right,
        0.2,
        0.8,
        defaultLayoutV2.splitRatio.right,
      ),
    },
    slots,
  };
}

/** 获取当前未被使用的组件。 */
export function getUnassignedWidgets(slots: Record<WidgetSlot, WidgetGroup>) {
  const used = new Set<PanelKey>();
  (Object.keys(slots) as WidgetSlot[]).forEach((slot) => {
    slots[slot].widgets.forEach((item) => used.add(item));
  });
  return allPanelKeys.filter((item) => !used.has(item));
}

/** 将组件放入槽位：空槽迁移，非空合并。 */
export function moveWidgetToSlot(
  slots: Record<WidgetSlot, WidgetGroup>,
  widget: PanelKey,
  target: WidgetSlot,
) {
  const next: Record<WidgetSlot, WidgetGroup> = {
    leftTop: { ...slots.leftTop, widgets: [...slots.leftTop.widgets] },
    leftBottom: { ...slots.leftBottom, widgets: [...slots.leftBottom.widgets] },
    rightTop: { ...slots.rightTop, widgets: [...slots.rightTop.widgets] },
    rightBottom: {
      ...slots.rightBottom,
      widgets: [...slots.rightBottom.widgets],
    },
    bottom: { ...slots.bottom, widgets: [...slots.bottom.widgets] },
  };
  (Object.keys(next) as WidgetSlot[]).forEach((slot) => {
    const current = next[slot];
    current.widgets = current.widgets.filter((item) => item !== widget);
    if (current.active === widget) {
      current.active = current.widgets[0] ?? null;
    }
  });
  next[target].widgets.push(widget);
  next[target].active = next[target].active ?? widget;
  next[target].floating = false;
  return next;
}

/** 切换左右区域单槽/双槽。 */
export function applySplitMode(
  slots: Record<WidgetSlot, WidgetGroup>,
  side: WidgetSide,
  split: boolean,
) {
  const next: Record<WidgetSlot, WidgetGroup> = {
    leftTop: { ...slots.leftTop, widgets: [...slots.leftTop.widgets] },
    leftBottom: { ...slots.leftBottom, widgets: [...slots.leftBottom.widgets] },
    rightTop: { ...slots.rightTop, widgets: [...slots.rightTop.widgets] },
    rightBottom: {
      ...slots.rightBottom,
      widgets: [...slots.rightBottom.widgets],
    },
    bottom: { ...slots.bottom, widgets: [...slots.bottom.widgets] },
  };
  if (split) return next;
  const [top, bottom] = sideSlots(side);
  const merged = Array.from(
    new Set([...next[top].widgets, ...next[bottom].widgets]),
  );
  next[top].widgets = merged;
  next[top].active = merged.includes(next[top].active as PanelKey)
    ? next[top].active
    : (merged[0] ?? null);
  next[bottom] = createEmptyGroup();
  return next;
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizePanelKey(value: unknown): PanelKey | null {
  if (value === "profiles") return "profiles";
  if (value === "files") return "files";
  if (value === "transfers") return "transfers";
  if (value === "events") return "events";
  if (value === "logs") return "events";
  return null;
}
