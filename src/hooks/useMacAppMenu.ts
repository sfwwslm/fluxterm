import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { error as logError } from "@tauri-apps/plugin-log";
import type { Locale, Translate } from "@/i18n";
import type { ThemeId } from "@/types";
import { isMacOS } from "@/utils/platform";
import type { ConfigSectionKey } from "@/components/layout/ConfigModal";
import { extractErrorMessage } from "@/shared/errors/appError";

type UseMacAppMenuOptions = {
  locale: Locale;
  themeId: ThemeId;
  shellId: string | null;
  availableShells: Array<{ id: string; label: string }>;
  layoutCollapsed: Record<"left" | "right" | "bottom", boolean>;
  onToggleCollapsed: (side: "left" | "right" | "bottom") => void;
  footerVisibility?: { quickbar: boolean; statusbar: boolean };
  onToggleFooterPart?: (part: "quickbar" | "statusbar") => void;
  onOpenConfigSection: (section: ConfigSectionKey) => void;
  setLocale: (locale: Locale) => void;
  setThemeId: (themeId: ThemeId) => void;
  setShellId: (shellId: string | null) => void;
  onOpenAbout: () => void;
  t: Translate;
};

async function createAppMenu({
  appName,
  t,
  onOpenAbout,
}: {
  appName: string;
  t: Translate;
  onOpenAbout: () => void;
}) {
  return Submenu.new({
    id: "app-menu",
    text: appName,
    items: [
      await MenuItem.new({
        id: "app-about",
        text: t("menu.app.about"),
        action: onOpenAbout,
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });
}

async function createLayoutMenu(
  layoutCollapsed: Record<"left" | "right" | "bottom", boolean>,
  onToggleCollapsed: (side: "left" | "right" | "bottom") => void,
  footerVisibility: { quickbar: boolean; statusbar: boolean },
  onToggleFooterPart: (part: "quickbar" | "statusbar") => void,
  t: Translate,
) {
  const widgetsMenu = await Submenu.new({
    id: "layout-menu-widgets",
    text: t("menu.layout.sections.widgets"),
    items: [
      await MenuItem.new({
        id: "layout-left",
        text: `${layoutCollapsed.left ? t("layout.expand") : t("layout.collapse")} ${t("layout.left")}`,
        action: () => onToggleCollapsed("left"),
      }),
      await MenuItem.new({
        id: "layout-right",
        text: `${layoutCollapsed.right ? t("layout.expand") : t("layout.collapse")} ${t("layout.right")}`,
        action: () => onToggleCollapsed("right"),
      }),
      await MenuItem.new({
        id: "layout-bottom",
        text: `${layoutCollapsed.bottom ? t("layout.expand") : t("layout.collapse")} ${t("layout.bottom")}`,
        action: () => onToggleCollapsed("bottom"),
      }),
    ],
  });
  const footerMenu = await Submenu.new({
    id: "layout-menu-footer",
    text: t("menu.layout.sections.footer"),
    items: [
      await MenuItem.new({
        id: "layout-quickbar-visible",
        text: `${footerVisibility.quickbar ? t("layout.hide") : t("layout.show")} ${t("layout.footer.quickbar")}`,
        action: () => onToggleFooterPart("quickbar"),
      }),
      await MenuItem.new({
        id: "layout-statusbar-visible",
        text: `${footerVisibility.statusbar ? t("layout.hide") : t("layout.show")} ${t("layout.footer.statusbar")}`,
        action: () => onToggleFooterPart("statusbar"),
      }),
    ],
  });
  return Submenu.new({
    id: "layout-menu",
    text: t("menu.layout"),
    items: [widgetsMenu, footerMenu],
  });
}

async function createConfigMenu(
  onOpenConfigSection: (section: ConfigSectionKey) => void,
  t: Translate,
) {
  return Submenu.new({
    id: "config-menu",
    text: t("menu.config"),
    items: [
      await MenuItem.new({
        id: "config-app-settings",
        text: t("config.section.appSettings"),
        action: () => onOpenConfigSection("app-settings"),
      }),
      await MenuItem.new({
        id: "config-ai-settings",
        text: t("config.section.aiSettings"),
        action: () => onOpenConfigSection("ai-settings"),
      }),
      await MenuItem.new({
        id: "config-session-settings",
        text: t("config.section.sessionSettings"),
        action: () => onOpenConfigSection("session-settings"),
      }),
      await MenuItem.new({
        id: "config-directory",
        text: t("config.section.configDirectory"),
        action: () => onOpenConfigSection("config-directory"),
      }),
    ],
  });
}

async function createPersonalizeMenu(
  locale: Locale,
  themeId: ThemeId,
  shellId: string | null,
  availableShells: Array<{ id: string; label: string }>,
  setLocale: (locale: Locale) => void,
  setThemeId: (themeId: ThemeId) => void,
  setShellId: (shellId: string | null) => void,
  t: Translate,
) {
  const languageMenu = await Submenu.new({
    id: "personalize-language",
    text: t("menu.app.language"),
    items: [
      await MenuItem.new({
        id: "personalize-language-zh",
        text: t("language.zh"),
        action: () => setLocale("zh"),
        enabled: locale !== "zh",
      }),
      await MenuItem.new({
        id: "personalize-language-en",
        text: t("language.en"),
        action: () => setLocale("en"),
        enabled: locale !== "en",
      }),
    ],
  });

  const themeMenu = await Submenu.new({
    id: "personalize-theme",
    text: t("menu.app.theme"),
    items: [
      await MenuItem.new({
        id: "personalize-theme-dark",
        text: t("theme.dark"),
        action: () => setThemeId("dark"),
        enabled: themeId !== "dark",
      }),
      await MenuItem.new({
        id: "personalize-theme-light",
        text: t("theme.light"),
        action: () => setThemeId("light"),
        enabled: themeId !== "light",
      }),
    ],
  });

  const shellItems = availableShells.length
    ? await Promise.all(
        availableShells.map((shell) =>
          MenuItem.new({
            id: `personalize-shell-${shell.id}`,
            text: shell.label,
            action: () => setShellId(shell.id),
            enabled: shellId !== shell.id,
          }),
        ),
      )
    : [
        await MenuItem.new({
          id: "personalize-shell-empty",
          text: t("menu.app.shellEmpty"),
          enabled: false,
        }),
      ];

  const shellMenu = await Submenu.new({
    id: "personalize-shell",
    text: t("menu.app.shell"),
    items: shellItems,
  });

  return Submenu.new({
    id: "personalize-menu",
    text: t("menu.personalize"),
    items: [languageMenu, themeMenu, shellMenu],
  });
}

async function createEditMenu(title: string) {
  return Submenu.new({
    id: "edit-menu",
    text: title,
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
    ],
  });
}

async function createWindowMenu(title: string) {
  return Submenu.new({
    id: "window-menu",
    text: title,
    items: [
      await PredefinedMenuItem.new({ item: "Minimize" }),
      await PredefinedMenuItem.new({ item: "Fullscreen" }),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
    ],
  });
}

async function createHelpMenu(
  title: string,
  onOpenAbout: () => void,
  t: Translate,
) {
  return Submenu.new({
    id: "help-menu",
    text: title,
    items: [
      await MenuItem.new({
        id: "help-about",
        text: t("menu.help.about"),
        action: onOpenAbout,
      }),
    ],
  });
}

/** macOS 原生菜单适配。 */
export default function useMacAppMenu({
  locale,
  themeId,
  shellId,
  availableShells,
  layoutCollapsed,
  onToggleCollapsed,
  footerVisibility = { quickbar: true, statusbar: true },
  onToggleFooterPart,
  onOpenConfigSection,
  setLocale,
  setThemeId,
  setShellId,
  onOpenAbout,
  t,
}: UseMacAppMenuOptions) {
  useEffect(() => {
    if (!isMacOS() || !isTauri()) {
      return;
    }

    let cancelled = false;

    const applyMenu = async () => {
      try {
        const appMenu = await createAppMenu({
          appName: t("app.name"),
          t,
          onOpenAbout,
        });
        // macOS 原生菜单的“配置”入口必须与 Windows/Web 的 Menus.tsx 保持同步，
        // 后续新增或调整配置分组时，两处都要一起修改，避免某个平台缺入口。
        const configMenu = await createConfigMenu(onOpenConfigSection, t);
        const layoutMenu = await createLayoutMenu(
          layoutCollapsed,
          onToggleCollapsed,
          footerVisibility,
          onToggleFooterPart ?? (() => {}),
          t,
        );
        const personalizeMenu = await createPersonalizeMenu(
          locale,
          themeId,
          shellId,
          availableShells,
          setLocale,
          setThemeId,
          setShellId,
          t,
        );
        const editMenu = await createEditMenu(t("menu.edit.title"));
        const windowMenu = await createWindowMenu(t("menu.window.title"));
        const helpMenu = await createHelpMenu(
          t("menu.help.title"),
          onOpenAbout,
          t,
        );

        const menu = await Menu.new();
        await menu.append([
          appMenu,
          configMenu,
          layoutMenu,
          personalizeMenu,
          editMenu,
          windowMenu,
          helpMenu,
        ]);

        if (cancelled) {
          await menu.close();
          return;
        }

        await helpMenu.setAsHelpMenuForNSApp();
        const previousMenu = await menu.setAsAppMenu();
        await windowMenu.setAsWindowsMenuForNSApp();

        if (previousMenu) {
          await previousMenu.close();
        }
      } catch (error) {
        void logError(
          JSON.stringify({
            event: "mac-app-menu:apply-failed",
            message: extractErrorMessage(error),
          }),
        );
      }
    };

    applyMenu();

    return () => {
      cancelled = true;
    };
  }, [
    locale,
    themeId,
    shellId,
    availableShells,
    layoutCollapsed,
    onToggleCollapsed,
    footerVisibility,
    onToggleFooterPart,
    onOpenConfigSection,
    setLocale,
    setThemeId,
    setShellId,
    onOpenAbout,
    t,
  ]);
}
