/** 顶部菜单栏组件，用于布局折叠与个性化入口，支持下拉子菜单与全局点击关闭。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Locale, Translate } from "@/i18n";
import type { WidgetSide } from "@/layout/types";
import type { ThemeId } from "@/types";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";

type MenuAction = {
  type?: "action";
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type MenuCustom = {
  type?: "custom";
  id: string;
  render: React.ReactNode;
};

type MenuSectionTitle = {
  type: "section";
  id: string;
  label: string;
};

type MenuDivider = {
  type: "divider";
  id: string;
};

type MenuEntry = MenuAction | MenuCustom | MenuSectionTitle | MenuDivider;

type MenuItem = {
  id: string;
  label: string;
  actions?: MenuEntry[];
  onClick?: () => void;
  disabled?: boolean;
};

type MenusProps = {
  onOpenConfigSection: (
    section: "app-settings" | "session-settings" | "config-directory",
  ) => void;
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  onToggleCollapsed: (side: WidgetSide | "bottom") => void;
  onOpenAbout: () => void;
  footerVisibility?: { quickbar: boolean; statusbar: boolean };
  onToggleFooterPart?: (part: "quickbar" | "statusbar") => void;
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

export default function Menus({
  onOpenConfigSection,
  layoutCollapsed,
  onToggleCollapsed,
  onOpenAbout,
  footerVisibility = { quickbar: true, statusbar: true },
  onToggleFooterPart,
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
        id: "config",
        label: t("menu.config"),
        // “配置”菜单先提供统一入口，后续具体设置项都收敛到同一个模态框内扩展。
        actions: [
          {
            id: "config-app-settings",
            label: t("config.section.appSettings"),
            onClick: () => onOpenConfigSection("app-settings"),
          },
          {
            id: "config-session-settings",
            label: t("config.section.sessionSettings"),
            onClick: () => onOpenConfigSection("session-settings"),
          },
          {
            id: "config-directory",
            label: t("config.section.configDirectory"),
            onClick: () => onOpenConfigSection("config-directory"),
          },
        ],
      },
      {
        id: "layout",
        label: t("menu.layout"),
        disabled: layoutDisabled,
        actions: [
          {
            type: "section",
            id: "widgets-section",
            label: t("menu.layout.sections.widgets"),
          },
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
          { type: "divider", id: "layout-divider" },
          {
            type: "section",
            id: "footer-section",
            label: t("menu.layout.sections.footer"),
          },
          {
            id: "quickbar-visible",
            label: `${footerVisibility.quickbar ? t("layout.hide") : t("layout.show")} ${t("layout.footer.quickbar")}`,
            onClick: () => onToggleFooterPart?.("quickbar"),
            disabled: layoutDisabled,
          },
          {
            id: "statusbar-visible",
            label: `${footerVisibility.statusbar ? t("layout.hide") : t("layout.show")} ${t("layout.footer.statusbar")}`,
            onClick: () => onToggleFooterPart?.("statusbar"),
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
                <Select
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
                <Select
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
                <Select
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
      onOpenConfigSection,
      layoutCollapsed.bottom,
      layoutCollapsed.left,
      layoutCollapsed.right,
      footerVisibility.quickbar,
      footerVisibility.statusbar,
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
      onToggleFooterPart,
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
                  if ("type" in action && action.type === "divider") {
                    return <div key={action.id} className="menu-sub-divider" />;
                  }
                  if ("type" in action && action.type === "section") {
                    return (
                      <div key={action.id} className="menu-sub-section-title">
                        {action.label}
                      </div>
                    );
                  }
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
