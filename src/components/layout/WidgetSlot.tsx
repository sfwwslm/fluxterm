/** 单个组件槽位，负责拖拽投放与标题栏操作，并渲染对应的面板内容。 */
import type React from "react";
import type { Translate } from "@/i18n";
import type { PanelKey } from "@/types";
import type { WidgetSlot as WidgetSlotKey } from "@/layout/types";
import WidgetTitleBar from "./WidgetTitleBar";

type WidgetSlotProps = {
  slot: WidgetSlotKey;
  active: PanelKey | null;
  allWidgets: PanelKey[];
  labels: Record<PanelKey, string>;
  body: React.ReactNode;
  onReplace: (slot: WidgetSlotKey, key: PanelKey) => void;
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

export default function WidgetSlot({
  slot,
  active,
  allWidgets,
  labels,
  body,
  onReplace,
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
      className={`panel widget-slot ${!active ? "empty" : ""}`}
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
        active={active}
        allWidgets={allWidgets}
        labels={labels}
        draggableWidget={active}
        onReplace={(key) => onReplace(slot, key)}
        onFloat={() => onFloat(slot)}
        onSplit={onSplit ? () => onSplit(slot) : undefined}
        splitDisabled={splitDisabled}
        onClose={onClose ? () => onClose(slot) : undefined}
        closeDisabled={closeDisabled}
        onDragStart={(event, key) => onDragWidget(event, slot, key)}
        t={t}
      />
      <div className="panel-body">
        {active ? (
          body
        ) : (
          <div className="empty-hint">{t("panel.emptyHint")}</div>
        )}
      </div>
    </section>
  );
}
