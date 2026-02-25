import type React from "react";
import type { Translate } from "@/i18n";
import type { PanelKey } from "@/types";
import type { WidgetSide, WidgetSlot } from "@/layout/types";
import WidgetSlotView from "./WidgetSlot";

type SlotData = {
  slot: WidgetSlot;
  widgets: PanelKey[];
  active: PanelKey | null;
  body: React.ReactNode;
};

type WidgetContainerProps = {
  side: WidgetSide;
  split: boolean;
  visible: boolean;
  collapsed: boolean;
  splitRatio: number;
  primary: SlotData;
  secondary: SlotData;
  available: PanelKey[];
  labels: Record<PanelKey, string>;
  onSelect: (slot: WidgetSlot, key: PanelKey) => void;
  onAdd: (slot: WidgetSlot, key: PanelKey) => void;
  onFloat: (slot: WidgetSlot) => void;
  onDropWidget: (slot: WidgetSlot, key: PanelKey) => void;
  onDragWidget: (
    event: React.DragEvent<HTMLDivElement>,
    slot: WidgetSlot,
    key: PanelKey,
  ) => void;
  onToggleSplit: (side: WidgetSide) => void;
  onToggleCollapsed: (side: WidgetSide) => void;
  onStartSplitResize: (
    side: WidgetSide,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  t: Translate;
};

/** 左右组件容器（支持单槽/双槽）。 */
export default function WidgetContainer({
  side,
  split,
  visible,
  collapsed,
  splitRatio,
  primary,
  secondary,
  available,
  labels,
  onSelect,
  onAdd,
  onFloat,
  onDropWidget,
  onDragWidget,
  onToggleSplit,
  onToggleCollapsed,
  onStartSplitResize,
  t,
}: WidgetContainerProps) {
  if (!visible) return null;
  return (
    <aside
      className={`widget-container ${side} ${collapsed ? "collapsed" : ""}`}
    >
      <div className="widget-container-header">
        <span>{side === "left" ? t("layout.left") : t("layout.right")}</span>
        <div className="widget-container-actions">
          <button className="ghost mini" onClick={() => onToggleSplit(side)}>
            {split ? t("layout.merge") : t("layout.split")}
          </button>
          <button
            className="ghost mini"
            onClick={() => onToggleCollapsed(side)}
          >
            {collapsed ? t("layout.expand") : t("layout.collapse")}
          </button>
        </div>
      </div>
      <div
        className={`widget-container-body ${split ? "split" : "single"} ${
          collapsed ? "hidden" : ""
        }`}
        style={
          split
            ? ({
                gridTemplateRows: `${splitRatio}fr 8px ${1 - splitRatio}fr`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <WidgetSlotView
          slot={primary.slot}
          widgets={primary.widgets}
          active={primary.active}
          unassigned={available}
          labels={labels}
          body={primary.body}
          onSelect={onSelect}
          onAdd={onAdd}
          onFloat={onFloat}
          onDropWidget={onDropWidget}
          onDragWidget={onDragWidget}
          t={t}
        />
        {split && (
          <>
            <div
              className="slot-resizer"
              onMouseDown={(event) => onStartSplitResize(side, event)}
            />
            <WidgetSlotView
              slot={secondary.slot}
              widgets={secondary.widgets}
              active={secondary.active}
              unassigned={available}
              labels={labels}
              body={secondary.body}
              onSelect={onSelect}
              onAdd={onAdd}
              onFloat={onFloat}
              onDropWidget={onDropWidget}
              onDragWidget={onDragWidget}
              t={t}
            />
          </>
        )}
      </div>
    </aside>
  );
}
