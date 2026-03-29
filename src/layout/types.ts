/** 布局相关类型定义，覆盖槽位标识与小组件布局配置结构。 */
import type { WidgetKey } from "@/types";

/** 组件槽位标识。 */
export type WidgetSlotId = `${WidgetSide}:${number}` | "bottom";

/** 左右区域标识。 */
export type WidgetSide = "left" | "right";

/** 单个槽位的组件组。 */
export type WidgetGroup = {
  active: WidgetKey | null;
};

/** 持久化的浮动窗口布局。 */
export type FloatingWidgetLayout = Partial<
  Record<
    WidgetKey,
    {
      origin: WidgetSlotId;
    }
  >
>;

/** 小组件布局配置（左右动态槽位）。 */
export type WidgetLayout = {
  version: 1;
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
  floating: FloatingWidgetLayout;
};
