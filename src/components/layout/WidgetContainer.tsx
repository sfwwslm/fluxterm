/** 左右组件容器，承载多个槽位并支持折叠与动态分割的布局渲染。 */
import type React from "react";
import type { Translate } from "@/i18n";
import type { WidgetKey } from "@/types";
import type { WidgetSide, WidgetSlot } from "@/layout/types";
import { MAX_SIDE_SLOTS } from "@/layout/model";
import WidgetSlotView from "./WidgetSlot";

type SlotData = {
  slot: WidgetSlot;
  active: WidgetKey | null;
  body: React.ReactNode;
};

type WidgetContainerProps = {
  side: WidgetSide;
  visible: boolean;
  collapsed: boolean;
  slots: SlotData[];
  available: WidgetKey[];
  labels: Record<WidgetKey, string>;
  onReplace: (slot: WidgetSlot, key: WidgetKey) => void;
  onFloat: (slot: WidgetSlot) => void;
  onCloseWidget: (slot: WidgetSlot) => void;
  onToggleSplit: (side: WidgetSide) => void;
  t: Translate;
};

export default function WidgetContainer({
  side,
  visible,
  collapsed,
  slots,
  available,
  labels,
  onReplace,
  onFloat,
  onCloseWidget,
  onToggleSplit,
  t,
}: WidgetContainerProps) {
  if (!visible) return null;
  const disableSplit = slots.length >= MAX_SIDE_SLOTS;
  return (
    <aside
      className={`widget-container ${side} ${collapsed ? "collapsed" : ""}`}
    >
      <div
        className={`widget-container-body dynamic ${collapsed ? "hidden" : ""}`}
        style={{
          gridTemplateRows: `repeat(${Math.max(1, slots.length)}, minmax(0, 1fr))`,
        }}
      >
        {slots.map((slot) => (
          <WidgetSlotView
            key={slot.slot}
            slot={slot.slot}
            active={slot.active}
            allWidgets={available}
            labels={labels}
            body={slot.body}
            onReplace={onReplace}
            onFloat={onFloat}
            onClose={onCloseWidget}
            onSplit={() => onToggleSplit(side)}
            splitDisabled={disableSplit}
            t={t}
          />
        ))}
      </div>
    </aside>
  );
}
