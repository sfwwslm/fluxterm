/** 单个组件槽位，负责标题栏操作与面板内容渲染。 */
import type React from "react";
import type { Translate } from "@/i18n";
import type { WidgetSlot as WidgetSlotKey } from "@/layout/types";
import type { PanelKey } from "@/types";
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
  t,
}: WidgetSlotProps) {
  return (
    <section className={`panel widget-slot ${!active ? "empty" : ""}`}>
      <WidgetTitleBar
        active={active}
        allWidgets={allWidgets}
        labels={labels}
        onReplace={(key) => onReplace(slot, key)}
        onFloat={() => onFloat(slot)}
        onSplit={onSplit ? () => onSplit(slot) : undefined}
        splitDisabled={splitDisabled}
        onClose={onClose ? () => onClose(slot) : undefined}
        closeDisabled={closeDisabled}
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
