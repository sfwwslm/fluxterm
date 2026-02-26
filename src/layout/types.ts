/** 布局相关类型定义，覆盖槽位标识与小组件布局配置结构。 */
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

/** 小组件布局配置（左右动态槽位）。 */
export type WidgetLayout = {
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
