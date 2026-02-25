import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Translate } from "@/i18n";
import type { PanelKey } from "@/types";
import { VscClose, VscSettingsGear } from "react-icons/vsc";
import Button from "@/components/ui/button";

type WidgetTitleBarProps = {
  widgets: PanelKey[];
  active: PanelKey | null;
  allWidgets: PanelKey[];
  labels: Record<PanelKey, string>;
  draggableWidget?: PanelKey | null;
  onSelect: (key: PanelKey) => void;
  onAdd: (key: PanelKey) => void;
  onFloat?: () => void;
  onClose?: () => void;
  onSplit?: () => void;
  splitDisabled?: boolean;
  closeDisabled?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>, key: PanelKey) => void;
  t: Translate;
};

/** 组件槽位标题栏。 */
export default function WidgetTitleBar({
  widgets,
  active,
  allWidgets,
  labels,
  draggableWidget,
  onSelect,
  onAdd,
  onFloat,
  onClose,
  onSplit,
  splitDisabled,
  closeDisabled,
  onDragStart,
  t,
}: WidgetTitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  const displayName = active ? labels[active] : t("panel.empty");
  const componentItems = useMemo(
    () => allWidgets.filter((key) => Boolean(labels[key])),
    [allWidgets, labels],
  );

  return (
    <div
      className="widget-titlebar"
      draggable={!!draggableWidget}
      onDragStart={(event) => {
        if (!draggableWidget || !onDragStart) return;
        onDragStart(event, draggableWidget);
      }}
    >
      <div className="widget-title-name">{displayName}</div>
      <div className="widget-title-actions">
        <div className="widget-settings" ref={menuRef}>
          <Button
            className="ghost mini"
            variant="ghost"
            size="icon"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label={t("actions.settings")}
            title={t("actions.settings")}
          >
            <VscSettingsGear />
          </Button>
          {menuOpen && (
            <div
              className="widget-settings-menu"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="widget-settings-group">
                <div className="widget-settings-group-title">
                  {t("panel.group.actions")}
                </div>
                {onSplit && (
                  <Button
                    className="widget-settings-item"
                    variant="ghost"
                    size="sm"
                    disabled={splitDisabled}
                    onClick={() => {
                      onSplit();
                      setMenuOpen(false);
                    }}
                  >
                    {t("layout.split")}
                  </Button>
                )}
                <Button
                  className="widget-settings-item"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onFloat?.();
                    setMenuOpen(false);
                  }}
                  disabled={!active}
                >
                  {t("panel.float")}
                </Button>
              </div>
              <div className="widget-settings-divider" />
              <div className="widget-settings-group">
                <div className="widget-settings-group-title">
                  {t("panel.group.components")}
                </div>
                {componentItems.map((item) => (
                  <Button
                    key={item}
                    className={`widget-settings-item ${item === active ? "selected" : ""}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (widgets.includes(item)) {
                        onSelect(item);
                      } else {
                        onAdd(item);
                      }
                      setMenuOpen(false);
                    }}
                  >
                    {labels[item]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button
          className="ghost mini icon-close"
          variant="ghost"
          size="icon"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={t("actions.close")}
          title={t("actions.close")}
        >
          <VscClose />
        </Button>
      </div>
    </div>
  );
}
