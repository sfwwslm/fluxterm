import type { PanelKey } from "@/types";

/** 组件槽位标识。 */
export type WidgetSlot = `${WidgetSide}:${number}` | "bottom";

/** 左右区域标识。 */
export type WidgetSide = "left" | "right";

/** 单个槽位的组件组。 */
export type WidgetGroup = {
  widgets: PanelKey[];
  active: PanelKey | null;
  floating: boolean;
};

/** 布局配置（v2）。 */
export type LayoutConfigV2 = {
  version: 2;
  sizes: {
    left: number;
    right: number;
    bottom: number;
  };
  collapsed: {
    left: boolean;
    right: boolean;
    bottom: boolean;
  };
  split: {
    left: boolean;
    right: boolean;
  };
  splitRatio: {
    left: number;
    right: number;
  };
  slots: {
    leftTop: WidgetGroup;
    leftBottom: WidgetGroup;
    rightTop: WidgetGroup;
    rightBottom: WidgetGroup;
    bottom: WidgetGroup;
  };
};

/** 布局配置（v3：左右动态槽位）。 */
export type LayoutConfigV3 = {
  version: 3;
  sizes: {
    left: number;
    right: number;
    bottom: number;
  };
  collapsed: {
    left: boolean;
    right: boolean;
    bottom: boolean;
  };
  sideSlotCounts: Record<WidgetSide, number>;
  slots: Record<string, WidgetGroup>;
};
