import type React from "react";
import type { Translate } from "@/i18n";
import type { PanelKey } from "@/types";

type WidgetTitleBarProps = {
  widgets: PanelKey[];
  active: PanelKey | null;
  unassigned: PanelKey[];
  labels: Record<PanelKey, string>;
  draggableWidget?: PanelKey | null;
  onSelect: (key: PanelKey) => void;
  onAdd: (key: PanelKey) => void;
  onFloat?: () => void;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>, key: PanelKey) => void;
  t: Translate;
};

/** 组件槽位标题栏。 */
export default function WidgetTitleBar({
  widgets,
  active,
  unassigned,
  labels,
  draggableWidget,
  onSelect,
  onAdd,
  onFloat,
  onDragStart,
  t,
}: WidgetTitleBarProps) {
  return (
    <div
      className="widget-titlebar"
      draggable={!!draggableWidget}
      onDragStart={(event) => {
        if (!draggableWidget || !onDragStart) return;
        onDragStart(event, draggableWidget);
      }}
    >
      <div className="widget-title-selects">
        <select
          value={active ?? ""}
          onChange={(event) => onSelect(event.target.value as PanelKey)}
          disabled={!widgets.length}
        >
          {!widgets.length && <option value="">{t("panel.empty")}</option>}
          {widgets.map((item) => (
            <option key={item} value={item}>
              {labels[item]}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(event) => {
            const key = event.target.value as PanelKey;
            if (!key) return;
            onAdd(key);
            event.target.value = "";
          }}
        >
          <option value="">{t("panel.add")}</option>
          {unassigned.map((item) => (
            <option key={item} value={item}>
              {labels[item]}
            </option>
          ))}
        </select>
      </div>
      <button className="ghost mini" onClick={onFloat} disabled={!active}>
        {t("panel.float")}
      </button>
    </div>
  );
}
