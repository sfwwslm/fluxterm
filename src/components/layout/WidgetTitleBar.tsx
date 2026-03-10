/** 组件槽位标题栏，提供替换/浮动/分割/关闭入口，并管理设置菜单状态。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Translate } from "@/i18n";
import type { WidgetKey } from "@/types";
import { IoClose, IoSettings } from "react-icons/io5";
import Button from "@/components/ui/button";
import "@/components/layout/WidgetTitleBar.css";

type WidgetTitleBarProps = {
  active: WidgetKey | null;
  allWidgets: WidgetKey[];
  labels: Record<WidgetKey, string>;
  onReplace: (key: WidgetKey) => void;
  onFloat?: () => void;
  onClose?: () => void;
  onSplit?: () => void;
  splitDisabled?: boolean;
  closeDisabled?: boolean;
  titleOnly?: boolean;
  t: Translate;
};

export default function WidgetTitleBar({
  active,
  allWidgets,
  labels,
  onReplace,
  onFloat,
  onClose,
  onSplit,
  splitDisabled,
  closeDisabled,
  titleOnly = false,
  t,
}: WidgetTitleBarProps) {
  const MENU_GAP = 6;
  const VIEWPORT_GAP = 8;
  const MENU_WIDTH = 196;
  const MENU_FALLBACK_HEIGHT = 320;
  const MIN_MENU_HEIGHT = 120;
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  }>({
    left: VIEWPORT_GAP,
    top: VIEWPORT_GAP,
    maxHeight: MENU_FALLBACK_HEIGHT,
  });

  const updateMenuPosition = useCallback(() => {
    if (!menuOpen || !anchorRef.current) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuHeight = menuRef.current?.offsetHeight ?? MENU_FALLBACK_HEIGHT;
    const left = Math.min(
      Math.max(VIEWPORT_GAP, anchorRect.right - MENU_WIDTH),
      viewportWidth - MENU_WIDTH - VIEWPORT_GAP,
    );
    const spaceBelow =
      viewportHeight - anchorRect.bottom - MENU_GAP - VIEWPORT_GAP;
    const spaceAbove = anchorRect.top - MENU_GAP - VIEWPORT_GAP;
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      MIN_MENU_HEIGHT,
      openUp ? spaceAbove : spaceBelow,
    );
    const top = openUp
      ? Math.max(
          VIEWPORT_GAP,
          anchorRect.top - MENU_GAP - Math.min(menuHeight, maxHeight),
        )
      : anchorRect.bottom + MENU_GAP;
    setMenuPosition({ left, top, maxHeight });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    const handleViewportChange = () => updateMenuPosition();
    window.requestAnimationFrame(updateMenuPosition);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [menuOpen, updateMenuPosition]);

  const displayName = active ? labels[active] : t("widget.empty");
  const componentItems = useMemo(
    () => allWidgets.filter((key) => Boolean(labels[key])),
    [allWidgets, labels],
  );

  return (
    <div
      className={`widget-titlebar ${titleOnly ? "is-title-only" : ""}`.trim()}
    >
      <div className="widget-title-name">{displayName}</div>
      {!titleOnly ? (
        <div className="widget-title-actions">
          <div className="widget-settings" ref={anchorRef}>
            <Button
              className="ghost mini icon-settings"
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label={t("actions.settings")}
              title={t("actions.settings")}
            >
              <IoSettings />
            </Button>
            {menuOpen &&
              createPortal(
                <div
                  ref={menuRef}
                  className="widget-settings-menu"
                  style={{
                    left: `${menuPosition.left}px`,
                    top: `${menuPosition.top}px`,
                    maxHeight: `${menuPosition.maxHeight}px`,
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="widget-settings-group">
                    <div className="widget-settings-group-title">
                      {t("widget.group.actions")}
                    </div>
                    {onSplit ? (
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
                    ) : null}
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
                      {t("widget.float")}
                    </Button>
                  </div>
                  <div className="widget-settings-divider" />
                  <div className="widget-settings-group">
                    <div className="widget-settings-group-title">
                      {t("widget.group.components")}
                    </div>
                    {componentItems.map((item) => (
                      <Button
                        key={item}
                        className={`widget-settings-item ${item === active ? "selected" : ""}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onReplace(item);
                          setMenuOpen(false);
                        }}
                      >
                        {labels[item]}
                      </Button>
                    ))}
                  </div>
                </div>,
                document.body,
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
            <IoClose />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
