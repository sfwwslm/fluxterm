/** 单个组件槽位，负责标题栏操作与面板内容渲染。 */
import type React from "react";
import type { Translate } from "@/i18n";
import type { WidgetSlotId } from "@/layout/types";
import type { WidgetKey } from "@/types";
import WidgetTitleBar from "./WidgetTitleBar";

type WidgetSlotProps = {
  slot: WidgetSlotId;
  active: WidgetKey | null;
  allWidgets: WidgetKey[];
  labels: Record<WidgetKey, string>;
  body: React.ReactNode;
  onReplace: (slot: WidgetSlotId, key: WidgetKey) => void;
  onFloat: (slot: WidgetSlotId) => void;
  onClose?: (slot: WidgetSlotId) => void;
  onSplit?: (slot: WidgetSlotId) => void;
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
    <section className={`widget widget-slot ${!active ? "empty" : ""}`}>
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
      <div className="widget-body">
        {active ? (
          body
        ) : (
          <div className="empty-hint">{t("widget.emptyHint")}</div>
        )}
      </div>
    </section>
  );
}
