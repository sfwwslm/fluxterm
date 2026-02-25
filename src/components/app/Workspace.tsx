import type React from "react";
import type { Translate } from "@/i18n";
import type { PanelKey } from "@/types";
import type { WidgetGroup, WidgetSide, WidgetSlot } from "@/layout/types";
import { sideSlotKey } from "@/layout/model";
import WidgetContainer from "@/components/layout/WidgetContainer";
import WidgetSlotView from "@/components/layout/WidgetSlot";

type WorkspaceProps = {
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  sideSlotCounts: Record<WidgetSide, number>;
  slotGroups: Record<string, WidgetGroup>;
  panelLabels: Record<PanelKey, string>;
  panels: Record<PanelKey, React.ReactNode>;
  terminalPanel: React.ReactNode;
  availableWidgets: PanelKey[];
  leftVisible: boolean;
  rightVisible: boolean;
  bottomVisible: boolean;
  onSelect: (slot: WidgetSlot, key: PanelKey) => void;
  onAdd: (slot: WidgetSlot, key: PanelKey) => void;
  onFloat: (slot: WidgetSlot) => void;
  onCloseWidget: (slot: WidgetSlot) => void;
  onDropWidget: (slot: WidgetSlot, key: PanelKey) => void;
  onDragWidget: (
    event: React.DragEvent<HTMLDivElement>,
    slot: WidgetSlot,
    key: PanelKey,
  ) => void;
  onToggleSplit: (side: WidgetSide) => void;
  onStartResize: (
    mode: "left" | "right" | "bottom",
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  t: Translate;
};

/** 主工作区布局（左右面板 + 底部面板）。 */
export default function Workspace({
  layoutCollapsed,
  sideSlotCounts,
  slotGroups,
  panelLabels,
  panels,
  terminalPanel,
  availableWidgets,
  leftVisible,
  rightVisible,
  bottomVisible,
  onSelect,
  onAdd,
  onFloat,
  onCloseWidget,
  onDropWidget,
  onDragWidget,
  onToggleSplit,
  onStartResize,
  t,
}: WorkspaceProps) {
  const sideSlots = (side: WidgetSide) => {
    const count = Math.max(1, sideSlotCounts[side]);
    return Array.from({ length: count }, (_, index) => {
      const slot = sideSlotKey(side, index);
      const group = slotGroups[slot] ?? {
        widgets: [],
        active: null,
        floating: false,
      };
      return {
        slot,
        widgets: group.widgets,
        active: group.active,
        body: group.active ? panels[group.active] : null,
      };
    });
  };

  const leftSlots = sideSlots("left");
  const rightSlots = sideSlots("right");
  const bottomGroup = slotGroups.bottom ?? {
    widgets: [],
    active: null,
    floating: false,
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
          labels={panelLabels}
          onSelect={onSelect}
          onAdd={onAdd}
          onFloat={onFloat}
          onCloseWidget={onCloseWidget}
          onDropWidget={onDropWidget}
          onDragWidget={onDragWidget}
          onToggleSplit={onToggleSplit}
          t={t}
        />
        {leftVisible && (
          <div
            className="panel-resizer vertical left-resizer"
            onMouseDown={(event) => onStartResize("left", event)}
          />
        )}
        {terminalPanel}
        {rightVisible && (
          <div
            className="panel-resizer vertical right-resizer"
            onMouseDown={(event) => onStartResize("right", event)}
          />
        )}
        <WidgetContainer
          side="right"
          visible={rightVisible}
          collapsed={layoutCollapsed.right}
          slots={rightSlots}
          available={availableWidgets}
          labels={panelLabels}
          onSelect={onSelect}
          onAdd={onAdd}
          onFloat={onFloat}
          onCloseWidget={onCloseWidget}
          onDropWidget={onDropWidget}
          onDragWidget={onDragWidget}
          onToggleSplit={onToggleSplit}
          t={t}
        />
      </div>

      {bottomVisible && (
        <div
          className="panel-resizer horizontal bottom-resizer"
          onMouseDown={(event) => onStartResize("bottom", event)}
        />
      )}

      {bottomVisible && (
        <footer className="bottom-panel">
          <div className="bottom-panel-toolbar">
            <span>{t("layout.bottom")}</span>
          </div>
          <WidgetSlotView
            slot="bottom"
            widgets={bottomGroup.widgets}
            active={bottomGroup.active}
            allWidgets={availableWidgets}
            labels={panelLabels}
            body={bottomGroup.active ? panels[bottomGroup.active] : null}
            onSelect={onSelect}
            onAdd={onAdd}
            onFloat={onFloat}
            onClose={onCloseWidget}
            closeDisabled={!bottomGroup.active}
            onDropWidget={onDropWidget}
            onDragWidget={onDragWidget}
            t={t}
          />
        </footer>
      )}
    </>
  );
}
