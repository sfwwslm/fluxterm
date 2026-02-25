import type React from "react";
import type { PanelArea, PanelKey } from "@/types";
import type { Translate, TranslationKey } from "@/i18n";

type PanelHeaderProps = {
  area: PanelArea;
  selection: PanelKey;
  lockedKeys: PanelKey[];
  labels: Record<PanelKey, TranslationKey>;
  onSelect: (area: PanelArea, key: PanelKey) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  t: Translate;
};

/** 功能面板标题与切换器。 */
export default function PanelHeader({
  area,
  selection,
  lockedKeys,
  labels,
  onSelect,
  onContextMenu,
  t,
}: PanelHeaderProps) {
  return (
    <div className="panel-header" onContextMenu={onContextMenu}>
      <span>{t(labels[selection])}</span>
      <select
        value={selection}
        onChange={(event) => onSelect(area, event.target.value as PanelKey)}
      >
        {Object.keys(labels).map((key) => (
          <option
            key={key}
            value={key}
            disabled={lockedKeys.includes(key as PanelKey) && key !== selection}
          >
            {t(labels[key as PanelKey])}
          </option>
        ))}
      </select>
    </div>
  );
}
