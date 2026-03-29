import type React from "react";
import type { Translate } from "@/i18n";
import type { WidgetKey } from "@/types";
import type { WidgetGroup, WidgetSide, WidgetSlotId } from "@/layout/types";
import { sideSlotKey } from "@/layout/model";
import WidgetContainer from "@/components/layout/WidgetContainer";
import WidgetSlotView from "@/components/layout/WidgetSlot";
import "@/main/components/Workspace.css";

type WorkspaceProps = {
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  sideSlotCounts: Record<WidgetSide, number>;
  slotGroups: Record<string, WidgetGroup>;
  widgetLabels: Record<WidgetKey, string>;
  widgets: Record<WidgetKey, React.ReactNode>;
  terminalWidget: React.ReactNode;
  availableWidgets: WidgetKey[];
  leftVisible: boolean;
  rightVisible: boolean;
  bottomVisible: boolean;
  onReplace: (slot: WidgetSlotId, key: WidgetKey) => void;
  onFloat: (slot: WidgetSlotId) => void;
  onCloseWidget: (slot: WidgetSlotId) => void;
  onToggleSplit: (side: WidgetSide) => void;
  onStartResize: (
    mode: "left" | "right" | "bottom",
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  t: Translate;
};

/** 主工作区布局（左右面板 + 底部面板），当前只支持替换 / 浮动 / 关闭。 */
export default function Workspace({
  layoutCollapsed,
  sideSlotCounts,
  slotGroups,
  widgetLabels,
  widgets,
  terminalWidget,
  availableWidgets,
  leftVisible,
  rightVisible,
  bottomVisible,
  onReplace,
  onFloat,
  onCloseWidget,
  onToggleSplit,
  onStartResize,
  t,
}: WorkspaceProps) {
  const sideSlots = (side: WidgetSide) => {
    const count = Math.max(1, sideSlotCounts[side]);
    return Array.from({ length: count }, (_, index) => {
      const slot = sideSlotKey(side, index);
      const group = slotGroups[slot] ?? {
        active: null,
      };
      return {
        slot,
        active: group.active,
        body: group.active ? widgets[group.active] : null,
      };
    });
  };

  const leftSlots = sideSlots("left");
  const rightSlots = sideSlots("right");
  const bottomGroup = slotGroups.bottom ?? {
    active: null,
  };

  return (
    <>
      <div className={`workspace ${bottomVisible ? "with-bottom" : ""}`}>
        <WidgetContainer
          side="left"
          visible={leftVisible}
          collapsed={layoutCollapsed.left}
          slots={leftSlots}
          available={availableWidgets}
          labels={widgetLabels}
          onReplace={onReplace}
          onFloat={onFloat}
          onCloseWidget={onCloseWidget}
          onToggleSplit={onToggleSplit}
          t={t}
        />
        {leftVisible && (
          <div
            className="widget-resizer vertical left-resizer"
            onMouseDown={(event) => onStartResize("left", event)}
          />
        )}
        {terminalWidget}
        {rightVisible && (
          <div
            className="widget-resizer vertical right-resizer"
            onMouseDown={(event) => onStartResize("right", event)}
          />
        )}
        <WidgetContainer
          side="right"
          visible={rightVisible}
          collapsed={layoutCollapsed.right}
          slots={rightSlots}
          available={availableWidgets}
          labels={widgetLabels}
          onReplace={onReplace}
          onFloat={onFloat}
          onCloseWidget={onCloseWidget}
          onToggleSplit={onToggleSplit}
          t={t}
        />
      </div>

      {bottomVisible && (
        <div
          className="widget-resizer horizontal bottom-resizer"
          onMouseDown={(event) => onStartResize("bottom", event)}
        />
      )}

      {bottomVisible && (
        <footer className="bottom-widget">
          <WidgetSlotView
            slot="bottom"
            active={bottomGroup.active}
            allWidgets={availableWidgets}
            labels={widgetLabels}
            body={bottomGroup.active ? widgets[bottomGroup.active] : null}
            onReplace={onReplace}
            onFloat={onFloat}
            onClose={onCloseWidget}
            closeDisabled={!bottomGroup.active}
            t={t}
          />
        </footer>
      )}
    </>
  );
}
