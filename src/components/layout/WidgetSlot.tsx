import type React from "react";
import type { Translate } from "@/i18n";
import type { PanelKey } from "@/types";
import type { WidgetSlot as WidgetSlotKey } from "@/layout/types";
import WidgetTitleBar from "./WidgetTitleBar";

type WidgetSlotProps = {
  slot: WidgetSlotKey;
  widgets: PanelKey[];
  active: PanelKey | null;
  allWidgets: PanelKey[];
  labels: Record<PanelKey, string>;
  body: React.ReactNode;
  onSelect: (slot: WidgetSlotKey, key: PanelKey) => void;
  onAdd: (slot: WidgetSlotKey, key: PanelKey) => void;
  onFloat: (slot: WidgetSlotKey) => void;
  onClose?: (slot: WidgetSlotKey) => void;
  onSplit?: (slot: WidgetSlotKey) => void;
  splitDisabled?: boolean;
  closeDisabled?: boolean;
  onDropWidget: (target: WidgetSlotKey, widget: PanelKey) => void;
  onDragWidget: (
    event: React.DragEvent<HTMLDivElement>,
    slot: WidgetSlotKey,
    key: PanelKey,
  ) => void;
  t: Translate;
};

/** 单个组件槽位。 */
export default function WidgetSlot({
  slot,
  widgets,
  active,
  allWidgets,
  labels,
  body,
  onSelect,
  onAdd,
  onFloat,
  onClose,
  onSplit,
  splitDisabled,
  closeDisabled,
  onDropWidget,
  onDragWidget,
  t,
}: WidgetSlotProps) {
  return (
    <section
      className={`panel widget-slot ${!widgets.length ? "empty" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const raw = event.dataTransfer.getData("application/x-flux-widget");
        if (!raw) return;
        try {
          const payload = JSON.parse(raw) as { key?: string };
          const key = payload.key as PanelKey | undefined;
          if (!key) return;
          onDropWidget(slot, key);
        } catch {
          // ignore invalid payload
        }
      }}
    >
      <WidgetTitleBar
        widgets={widgets}
        active={active}
        allWidgets={allWidgets}
        labels={labels}
        draggableWidget={active}
        onSelect={(key) => onSelect(slot, key)}
        onAdd={(key) => onAdd(slot, key)}
        onFloat={() => onFloat(slot)}
        onSplit={onSplit ? () => onSplit(slot) : undefined}
        splitDisabled={splitDisabled}
        onClose={onClose ? () => onClose(slot) : undefined}
        closeDisabled={closeDisabled}
        onDragStart={(event, key) => onDragWidget(event, slot, key)}
        t={t}
      />
      <div className="panel-body">
        {widgets.length ? (
          body
        ) : (
          <div className="empty-hint">{t("panel.emptyHint")}</div>
        )}
      </div>
    </section>
  );
}
