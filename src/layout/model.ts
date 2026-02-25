import type { PanelKey } from "@/types";
import type {
  LayoutConfigV2,
  LayoutConfigV3,
  WidgetGroup,
  WidgetSide,
  WidgetSlot,
} from "./types";

/** 每侧最大槽位数量。 */
export const MAX_SIDE_SLOTS = 10;

/** 所有可用组件键。 */
export const allPanelKeys: PanelKey[] = [
  "profiles",
  "files",
  "transfers",
  "events",
];

/** 默认布局（v3）。 */
export const defaultLayoutV3: LayoutConfigV3 = {
  version: 3,
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
  sideSlotCounts: {
    left: 1,
    right: 1,
  },
  slots: {
    "left:0": { widgets: ["profiles"], active: "profiles", floating: false },
    "right:0": { widgets: ["files"], active: "files", floating: false },
    bottom: {
      widgets: ["transfers", "events"],
      active: "transfers",
      floating: false,
    },
  },
};

/** 创建侧边槽位 key。 */
export function sideSlotKey(side: WidgetSide, index: number): WidgetSlot {
  return `${side}:${index}`;
}

/** 创建空组件组。 */
export function createEmptyGroup(): WidgetGroup {
  return { widgets: [], active: null, floating: false };
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
    floating: false,
  };
}

/** 获取某侧槽位 key（按索引升序）。 */
export function getSideSlotKeys(
  slots: Record<string, WidgetGroup>,
  side: WidgetSide,
) {
  return Object.keys(slots)
    .map((key) => parseSideSlotKey(key))
    .filter(
      (item): item is { side: WidgetSide; index: number } =>
        item !== null && item.side === side,
    )
    .sort((a, b) => a.index - b.index)
    .map((item) => sideSlotKey(item.side, item.index));
}

/** 深拷贝槽位集合。 */
export function cloneSlots(slots: Record<string, WidgetGroup>) {
  const next: Record<string, WidgetGroup> = {};
  Object.entries(slots).forEach(([slot, group]) => {
    next[slot as WidgetSlot] = { ...group, widgets: [...group.widgets] };
  });
  return next;
}

/** 保证左右槽位索引连续且数量满足 sideSlotCounts。 */
export function normalizeSideSlotStructure(
  slots: Record<string, WidgetGroup>,
  sideSlotCounts: Record<WidgetSide, number>,
) {
  const next: Record<string, WidgetGroup> = {};
  const normalizedCounts: Record<WidgetSide, number> = {
    left: clampNumber(sideSlotCounts.left, 1, MAX_SIDE_SLOTS, 1),
    right: clampNumber(sideSlotCounts.right, 1, MAX_SIDE_SLOTS, 1),
  };
  (["left", "right"] as WidgetSide[]).forEach((side) => {
    const keys = getSideSlotKeys(slots, side);
    for (let index = 0; index < normalizedCounts[side]; index += 1) {
      const source = keys[index];
      next[sideSlotKey(side, index)] = source
        ? normalizeGroup(slots[source])
        : createEmptyGroup();
    }
  });
  next.bottom = normalizeGroup(slots.bottom);
  return { slots: next, sideSlotCounts: normalizedCounts };
}

/** 规范布局配置（兼容 v2/v3）。 */
export function normalizeLayoutConfig(raw: unknown): LayoutConfigV3 | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as any;
  if (value.version !== 2 && value.version !== 3) return null;
  if (!value.sizes || !value.slots) return null;

  const baseSlots: Record<string, WidgetGroup> =
    value.version === 3
      ? normalizeV3Slots(value.slots as Record<string, unknown>)
      : normalizeV2Slots(value as LayoutConfigV2);

  const initialCounts: Record<WidgetSide, number> =
    value.version === 3
      ? {
          left: clampNumber(value.sideSlotCounts?.left, 1, MAX_SIDE_SLOTS, 1),
          right: clampNumber(value.sideSlotCounts?.right, 1, MAX_SIDE_SLOTS, 1),
        }
      : deriveCountsFromV2(value as LayoutConfigV2);

  const structured = normalizeSideSlotStructure(baseSlots, initialCounts);
  const dedupedSlots = dedupeWidgets(structured.slots);

  return {
    version: 3,
    sizes: {
      left: clampNumber(value.sizes.left, 220, 520, defaultLayoutV3.sizes.left),
      right: clampNumber(
        value.sizes.right,
        260,
        560,
        defaultLayoutV3.sizes.right,
      ),
      bottom: clampNumber(
        value.sizes.bottom,
        160,
        420,
        defaultLayoutV3.sizes.bottom,
      ),
    },
    collapsed: {
      left:
        typeof value.collapsed?.left === "boolean"
          ? value.collapsed.left
          : defaultLayoutV3.collapsed.left,
      right:
        typeof value.collapsed?.right === "boolean"
          ? value.collapsed.right
          : defaultLayoutV3.collapsed.right,
      bottom:
        typeof value.collapsed?.bottom === "boolean"
          ? value.collapsed.bottom
          : defaultLayoutV3.collapsed.bottom,
    },
    sideSlotCounts: structured.sideSlotCounts,
    slots: dedupedSlots,
  };
}

/** 将组件放入槽位：空槽迁移，非空合并。 */
export function moveWidgetToSlot(
  slots: Record<string, WidgetGroup>,
  widget: PanelKey,
  target: WidgetSlot,
) {
  const next = cloneSlots(slots);
  Object.values(next).forEach((group) => {
    group.widgets = group.widgets.filter((item) => item !== widget);
    if (group.active === widget) {
      group.active = group.widgets[0] ?? null;
    }
  });
  if (!next[target]) next[target] = createEmptyGroup();
  next[target].widgets.push(widget);
  next[target].active = next[target].active ?? widget;
  next[target].floating = false;
  return next;
}

/** 某一侧增加一个槽位（上限 MAX_SIDE_SLOTS）。 */
export function increaseSideSlots(
  slots: Record<string, WidgetGroup>,
  side: WidgetSide,
  currentCount: number,
) {
  const nextCount = Math.min(MAX_SIDE_SLOTS, currentCount + 1);
  if (nextCount === currentCount) {
    return { slots: cloneSlots(slots), nextCount };
  }
  const next = cloneSlots(slots);
  next[sideSlotKey(side, nextCount - 1)] = createEmptyGroup();
  return { slots: next, nextCount };
}

/** 关闭槽位中当前激活组件。 */
export function closeActiveWidgetInSlot(
  slots: Record<string, WidgetGroup>,
  slot: WidgetSlot,
) {
  const next = cloneSlots(slots);
  const group = next[slot];
  if (!group || !group.active) return next;
  group.widgets = group.widgets.filter((item) => item !== group.active);
  group.active = group.widgets[0] ?? null;
  return next;
}

function normalizeV3Slots(rawSlots: Record<string, unknown>) {
  const next: Record<string, WidgetGroup> = { bottom: createEmptyGroup() };
  Object.entries(rawSlots).forEach(([key, value]) => {
    if (key === "bottom") {
      next.bottom = normalizeGroup(value);
      return;
    }
    const parsed = parseSideSlotKey(key);
    if (!parsed) return;
    next[sideSlotKey(parsed.side, parsed.index)] = normalizeGroup(value);
  });
  return next;
}

function normalizeV2Slots(value: LayoutConfigV2) {
  const leftTop = normalizeGroup(value.slots.leftTop);
  const leftBottom = normalizeGroup(value.slots.leftBottom);
  const rightTop = normalizeGroup(value.slots.rightTop);
  const rightBottom = normalizeGroup(value.slots.rightBottom);
  const bottom = normalizeGroup(value.slots.bottom);
  return {
    "left:0": leftTop,
    "left:1": leftBottom,
    "right:0": rightTop,
    "right:1": rightBottom,
    bottom,
  } as Record<string, WidgetGroup>;
}

function deriveCountsFromV2(value: LayoutConfigV2): Record<WidgetSide, number> {
  const leftBottomHasContent =
    value.slots.leftBottom.widgets.length > 0 || value.slots.leftBottom.active;
  const rightBottomHasContent =
    value.slots.rightBottom.widgets.length > 0 ||
    value.slots.rightBottom.active;
  return {
    left: value.split.left || leftBottomHasContent ? 2 : 1,
    right: value.split.right || rightBottomHasContent ? 2 : 1,
  };
}

function dedupeWidgets(slots: Record<string, WidgetGroup>) {
  const next = cloneSlots(slots);
  const used = new Set<PanelKey>();
  const orderedKeys = [
    ...getSideSlotKeys(next, "left"),
    ...getSideSlotKeys(next, "right"),
    "bottom" as WidgetSlot,
  ];
  orderedKeys.forEach((slot) => {
    const group = next[slot];
    if (!group) return;
    group.widgets = group.widgets.filter((item) => {
      if (used.has(item)) return false;
      used.add(item);
      return true;
    });
    if (group.active && !group.widgets.includes(group.active)) {
      group.active = group.widgets[0] ?? null;
    }
  });
  return next;
}

function parseSideSlotKey(value: string) {
  const match = value.match(/^(left|right):(\d+)$/);
  if (!match) return null;
  const side = match[1] as WidgetSide;
  const index = Number(match[2]);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SIDE_SLOTS) {
    return null;
  }
  return { side, index };
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
