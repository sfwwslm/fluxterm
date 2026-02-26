import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Locale, Translate } from "@/i18n";
import type { WidgetSide } from "@/layout/types";
import type { ThemeId } from "@/types";
import Button from "@/components/ui/button";
import SelectMenu from "@/components/ui/select-menu";

type MenuAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type MenuCustom = {
  id: string;
  render: React.ReactNode;
};

type MenuEntry = MenuAction | MenuCustom;

type MenuItem = {
  id: string;
  label: string;
  actions?: MenuEntry[];
  onClick?: () => void;
  disabled?: boolean;
};

type MenusProps = {
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  onToggleCollapsed: (side: WidgetSide | "bottom") => void;
  onOpenAbout: () => void;
  layoutDisabled?: boolean;
  locale: Locale;
  themeId: ThemeId;
  shellId: string | null;
  availableShells: Array<{ id: string; label: string }>;
  themes: Record<ThemeId, { label: Record<Locale, string> }>;
  onLocaleChange: (locale: Locale) => void;
  onShellChange: (shellId: string | null) => void;
  onThemeChange: (themeId: ThemeId) => void;
  t: Translate;
};

/** 顶部菜单栏组件。 */
export default function Menus({
  layoutCollapsed,
  onToggleCollapsed,
  onOpenAbout,
  layoutDisabled,
  locale,
  themeId,
  shellId,
  availableShells,
  themes,
  onLocaleChange,
  onShellChange,
  onThemeChange,
  t,
}: MenusProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenus = useCallback(() => {
    setActiveMenuId(null);
  }, []);

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        closeMenus();
      }
    };
    document.addEventListener("mousedown", handleGlobalClick);
    return () => {
      document.removeEventListener("mousedown", handleGlobalClick);
    };
  }, [closeMenus]);

  const menuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: "layout",
        label: t("menu.layout"),
        disabled: layoutDisabled,
        actions: [
          {
            id: "left-collapse",
            label: `${layoutCollapsed.left ? t("layout.expand") : t("layout.collapse")} ${t("layout.left")}`,
            onClick: () => onToggleCollapsed("left"),
            disabled: layoutDisabled,
          },
          {
            id: "right-collapse",
            label: `${layoutCollapsed.right ? t("layout.expand") : t("layout.collapse")} ${t("layout.right")}`,
            onClick: () => onToggleCollapsed("right"),
            disabled: layoutDisabled,
          },
          {
            id: "bottom-collapse",
            label: `${layoutCollapsed.bottom ? t("layout.expand") : t("layout.collapse")} ${t("layout.bottom")}`,
            onClick: () => onToggleCollapsed("bottom"),
            disabled: layoutDisabled,
          },
        ],
      },
      {
        id: "personalize",
        label: t("menu.personalize"),
        actions: [
          {
            id: "language",
            render: (
              <label className="menu-field">
                <span>{t("settings.language")}</span>
                <SelectMenu
                  value={locale}
                  options={[
                    { value: "zh", label: "中文" },
                    { value: "en", label: "English" },
                  ]}
                  onChange={(next) => onLocaleChange(next as Locale)}
                  aria-label={t("settings.language")}
                />
              </label>
            ),
          },
          {
            id: "shell",
            render: (
              <label className="menu-field">
                <span>{t("settings.shell")}</span>
                <SelectMenu
                  value={shellId}
                  options={availableShells.map((shell) => ({
                    value: shell.id,
                    label: shell.label,
                  }))}
                  placeholder={t("menu.app.shellEmpty")}
                  disabled={!availableShells.length}
                  onChange={(next) => onShellChange(next || null)}
                  aria-label={t("settings.shell")}
                />
              </label>
            ),
          },
          {
            id: "theme",
            render: (
              <label className="menu-field">
                <span>{t("settings.theme")}</span>
                <SelectMenu
                  value={themeId}
                  options={Object.entries(themes).map(([key, theme]) => ({
                    value: key,
                    label: theme.label[locale],
                  }))}
                  onChange={(next) => onThemeChange(next as ThemeId)}
                  aria-label={t("settings.theme")}
                />
              </label>
            ),
          },
        ],
      },
      {
        id: "about",
        label: t("menu.about"),
        onClick: onOpenAbout,
      },
    ],
    [
      layoutCollapsed.bottom,
      layoutCollapsed.left,
      layoutCollapsed.right,
      layoutDisabled,
      locale,
      themeId,
      shellId,
      availableShells,
      themes,
      onLocaleChange,
      onShellChange,
      onThemeChange,
      onOpenAbout,
      onToggleCollapsed,
      t,
    ],
  );

  return (
    <div className="menu-bar" ref={menuRef}>
      {menuItems.map((item) => {
        const hasSubmenu = !!item.actions?.length;
        const isActive = activeMenuId === item.id;
        const isDisabled = item.disabled;
        return (
          <div
            key={item.id}
            className={`menu-item ${isActive ? "active" : ""} ${isDisabled ? "disabled" : ""}`}
            data-tauri-drag-region="false"
            onClick={() => {
              if (isDisabled) return;
              if (hasSubmenu) {
                setActiveMenuId((prev) => (prev === item.id ? null : item.id));
              } else {
                item.onClick?.();
                closeMenus();
              }
            }}
          >
            <span>{item.label}</span>
            {hasSubmenu && isActive && (
              <div
                className="menu-sub"
                data-tauri-drag-region="false"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                {item.actions?.map((action) => {
                  if ("render" in action) {
                    return (
                      <div
                        key={action.id}
                        className="menu-sub-item menu-sub-custom"
                        data-tauri-drag-region="false"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {action.render}
                      </div>
                    );
                  }
                  return (
                    <Button
                      key={action.id}
                      className="menu-sub-item"
                      variant="ghost"
                      size="sm"
                      data-tauri-drag-region="false"
                      onClick={() => {
                        if (action.disabled) return;
                        action.onClick();
                        closeMenus();
                      }}
                      disabled={action.disabled}
                    >
                      {action.label}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
