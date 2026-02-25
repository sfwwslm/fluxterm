import type React from "react";
import type { Translate } from "@/i18n";
import type { PanelKey } from "@/types";
import type {
  WidgetGroup,
  WidgetSide,
  WidgetSlot as LayoutWidgetSlot,
} from "@/layout/types";
import WidgetContainer from "@/components/layout/WidgetContainer";
import WidgetSlot from "@/components/layout/WidgetSlot";

type WorkspaceProps = {
  layoutSplit: Record<WidgetSide, boolean>;
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  layoutSplitRatio: Record<WidgetSide, number>;
  slotGroups: Record<LayoutWidgetSlot, WidgetGroup>;
  panelLabels: Record<PanelKey, string>;
  panels: Record<PanelKey, React.ReactNode>;
  terminalPanel: React.ReactNode;
  availableWidgets: PanelKey[];
  leftVisible: boolean;
  rightVisible: boolean;
  bottomVisible: boolean;
  onSelect: (slot: LayoutWidgetSlot, key: PanelKey) => void;
  onAdd: (slot: LayoutWidgetSlot, key: PanelKey) => void;
  onFloat: (slot: LayoutWidgetSlot) => void;
  onDropWidget: (slot: LayoutWidgetSlot, key: PanelKey) => void;
  onDragWidget: (
    event: React.DragEvent<HTMLDivElement>,
    slot: LayoutWidgetSlot,
    key: PanelKey,
  ) => void;
  onToggleSplit: (side: WidgetSide) => void;
  onToggleCollapsed: (side: WidgetSide | "bottom") => void;
  onStartSplitResize: (
    side: WidgetSide,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  onStartResize: (
    mode: "left" | "right" | "bottom",
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  t: Translate;
};

/** 主工作区布局（左右面板 + 底部面板）。 */
export default function Workspace({
  layoutSplit,
  layoutCollapsed,
  layoutSplitRatio,
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
  onDropWidget,
  onDragWidget,
  onToggleSplit,
  onToggleCollapsed,
  onStartSplitResize,
  onStartResize,
  t,
}: WorkspaceProps) {
  return (
    <>
      <div className={`workspace ${bottomVisible ? "with-bottom" : ""}`}>
        <WidgetContainer
          side="left"
          split={layoutSplit.left}
          visible={leftVisible}
          collapsed={layoutCollapsed.left}
          splitRatio={layoutSplitRatio.left}
          primary={{
            slot: "leftTop",
            widgets: slotGroups.leftTop.widgets,
            active: slotGroups.leftTop.active,
            body: slotGroups.leftTop.active
              ? panels[slotGroups.leftTop.active]
              : null,
          }}
          secondary={{
            slot: "leftBottom",
            widgets: slotGroups.leftBottom.widgets,
            active: slotGroups.leftBottom.active,
            body: slotGroups.leftBottom.active
              ? panels[slotGroups.leftBottom.active]
              : null,
          }}
          available={availableWidgets}
          labels={panelLabels}
          onSelect={onSelect}
          onAdd={onAdd}
          onFloat={onFloat}
          onDropWidget={onDropWidget}
          onDragWidget={onDragWidget}
          onToggleSplit={onToggleSplit}
          onToggleCollapsed={onToggleCollapsed}
          onStartSplitResize={onStartSplitResize}
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
          split={layoutSplit.right}
          visible={rightVisible}
          collapsed={layoutCollapsed.right}
          splitRatio={layoutSplitRatio.right}
          primary={{
            slot: "rightTop",
            widgets: slotGroups.rightTop.widgets,
            active: slotGroups.rightTop.active,
            body: slotGroups.rightTop.active
              ? panels[slotGroups.rightTop.active]
              : null,
          }}
          secondary={{
            slot: "rightBottom",
            widgets: slotGroups.rightBottom.widgets,
            active: slotGroups.rightBottom.active,
            body: slotGroups.rightBottom.active
              ? panels[slotGroups.rightBottom.active]
              : null,
          }}
          available={availableWidgets}
          labels={panelLabels}
          onSelect={onSelect}
          onAdd={onAdd}
          onFloat={onFloat}
          onDropWidget={onDropWidget}
          onDragWidget={onDragWidget}
          onToggleSplit={onToggleSplit}
          onToggleCollapsed={onToggleCollapsed}
          onStartSplitResize={onStartSplitResize}
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
            <button
              className="ghost mini"
              onClick={() => onToggleCollapsed("bottom")}
            >
              {t("layout.collapse")}
            </button>
          </div>
          <WidgetSlot
            slot="bottom"
            widgets={slotGroups.bottom.widgets}
            active={slotGroups.bottom.active}
            unassigned={availableWidgets}
            labels={panelLabels}
            body={
              slotGroups.bottom.active ? panels[slotGroups.bottom.active] : null
            }
            onSelect={onSelect}
            onAdd={onAdd}
            onFloat={onFloat}
            onDropWidget={onDropWidget}
            onDragWidget={onDragWidget}
            t={t}
          />
        </footer>
      )}
    </>
  );
}
