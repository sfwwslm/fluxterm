import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Button from "@/components/ui/button";
import WindowControls from "@/components/layout/WindowControls";
import type { Translate, TranslationKey } from "@/i18n";
import "./SubAppTitleBar.css";

type MenuI18nLabel = {
  labelKey: TranslationKey;
  labelVars?: Record<string, string | number>;
};

type SubAppMenuAction = MenuI18nLabel & {
  type?: "action";
  id: string;
  disabled?: boolean;
  onClick: () => void;
};

type SubAppMenuSection = MenuI18nLabel & {
  type: "section";
  id: string;
};

type SubAppMenuDivider = {
  type: "divider";
  id: string;
};

type SubAppMenuEntry = SubAppMenuAction | SubAppMenuSection | SubAppMenuDivider;

type SubAppMenu = MenuI18nLabel & {
  id: string;
  actions: SubAppMenuEntry[];
};

type SubAppTitleBarProps = {
  title: string;
  subtitle?: string;
  menus?: SubAppMenu[];
  t: Translate;
};

/** 子应用标题栏，支持拖动、窗口控制与菜单骨架。 */
export default function SubAppTitleBar({
  title,
  subtitle,
  menus = [],
  t,
}: SubAppTitleBarProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const hasTauriRuntime =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const closeMenus = useCallback(() => {
    setActiveMenuId(null);
  }, []);

  const handleTitleDoubleClick = useCallback(() => {
    if (!hasTauriRuntime) return;
    getCurrentWindow()
      .toggleMaximize()
      .catch(() => {});
  }, [hasTauriRuntime]);

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      if (!menuRootRef.current) return;
      if (!menuRootRef.current.contains(event.target as Node)) {
        closeMenus();
      }
    };
    document.addEventListener("mousedown", handleGlobalClick);
    return () => {
      document.removeEventListener("mousedown", handleGlobalClick);
    };
  }, [closeMenus]);

  const normalizedMenus = useMemo(() => menus, [menus]);

  return (
    <header className="titlebar subapp-titlebar" data-tauri-drag-region>
      <div
        className="titlebar-brand subapp-titlebar-brand"
        data-tauri-drag-region="false"
        onDoubleClick={handleTitleDoubleClick}
      >
        <img className="brand-logo" src="/icon.ico" alt="FluxTerm" />
        <span className="brand-name subapp-titlebar-brand-name">{title}</span>
        {subtitle ? (
          <span className="subapp-titlebar-brand-sub">{subtitle}</span>
        ) : null}
      </div>

      {normalizedMenus.length > 0 ? (
        <div
          className="menu-bar"
          ref={menuRootRef}
          data-tauri-drag-region="false"
        >
          {normalizedMenus.map((menu) => {
            const isActive = activeMenuId === menu.id;
            return (
              <div
                key={menu.id}
                className={`menu-item ${isActive ? "active" : ""}`}
                onClick={() => {
                  setActiveMenuId((prev) =>
                    prev === menu.id ? null : menu.id,
                  );
                }}
              >
                <span>{t(menu.labelKey, menu.labelVars)}</span>
                {isActive && (
                  <div
                    className="menu-sub"
                    data-tauri-drag-region="false"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {menu.actions.map((action) => {
                      if (action.type === "divider") {
                        return (
                          <div key={action.id} className="menu-sub-divider" />
                        );
                      }
                      if (action.type === "section") {
                        return (
                          <div
                            key={action.id}
                            className="menu-sub-section-title"
                          >
                            {t(action.labelKey, action.labelVars)}
                          </div>
                        );
                      }
                      return (
                        <Button
                          key={action.id}
                          className="menu-sub-item"
                          variant="ghost"
                          size="sm"
                          disabled={action.disabled}
                          data-tauri-drag-region="false"
                          onClick={() => {
                            if (action.disabled) return;
                            action.onClick();
                            closeMenus();
                          }}
                        >
                          {t(action.labelKey, action.labelVars)}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <WindowControls disabled={!hasTauriRuntime} />
    </header>
  );
}
