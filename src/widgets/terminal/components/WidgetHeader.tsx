import type React from "react";
import type { WidgetArea, WidgetKey } from "@/types";
import type { Translate, TranslationKey } from "@/i18n";

type WidgetHeaderProps = {
  area: WidgetArea;
  selection: WidgetKey;
  lockedKeys: WidgetKey[];
  labels: Record<WidgetKey, TranslationKey>;
  onSelect: (area: WidgetArea, key: WidgetKey) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  t: Translate;
};

/** 功能面板标题与切换器。 */
export default function WidgetHeader({
  area,
  selection,
  lockedKeys,
  labels,
  onSelect,
  onContextMenu,
  t,
}: WidgetHeaderProps) {
  return (
    <div className="widget-header" onContextMenu={onContextMenu}>
      <span>{t(labels[selection])}</span>
      <select
        value={selection}
        onChange={(event) => onSelect(area, event.target.value as WidgetKey)}
      >
        {Object.keys(labels).map((key) => (
          <option
            key={key}
            value={key}
            disabled={
              lockedKeys.includes(key as WidgetKey) && key !== selection
            }
          >
            {t(labels[key as WidgetKey])}
          </option>
        ))}
      </select>
    </div>
  );
}
