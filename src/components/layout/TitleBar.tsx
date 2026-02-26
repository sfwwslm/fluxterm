/** 自定义标题栏组件，包含品牌区、菜单栏与窗口控制，并支持双击切换最大化。 */
import { useCallback } from "react";
import type React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Locale, Translate } from "@/i18n";
import type { WidgetSide } from "@/layout/types";
import type { ThemeId } from "@/types";
import Menus from "./Menus";
import WindowControls from "./WindowControls";

type TitleBarProps = {
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  onToggleCollapsed: (side: WidgetSide | "bottom") => void;
  onOpenAbout: () => void;
  layoutDisabled?: boolean;
  onBrandContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  showMenus?: boolean;
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

export default function TitleBar({
  layoutCollapsed,
  onToggleCollapsed,
  onOpenAbout,
  layoutDisabled,
  onBrandContextMenu,
  showMenus = true,
  locale,
  themeId,
  shellId,
  availableShells,
  themes,
  onLocaleChange,
  onShellChange,
  onThemeChange,
  t,
}: TitleBarProps) {
  const hasTauriRuntime =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const handleTitleDoubleClick = useCallback(() => {
    if (!hasTauriRuntime) return;
    getCurrentWindow()
      .toggleMaximize()
      .catch(() => {});
  }, [hasTauriRuntime]);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div
        className="titlebar-brand"
        data-tauri-drag-region="false"
        onDoubleClick={handleTitleDoubleClick}
        onContextMenu={onBrandContextMenu}
      >
        <img className="brand-logo" src="/icon.ico" alt="FluxTerm" />
        <span className="brand-name">FluxTerm</span>
      </div>
      {showMenus && (
        <Menus
          layoutCollapsed={layoutCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          onOpenAbout={onOpenAbout}
          layoutDisabled={layoutDisabled}
          locale={locale}
          themeId={themeId}
          shellId={shellId}
          availableShells={availableShells}
          themes={themes}
          onLocaleChange={onLocaleChange}
          onShellChange={onShellChange}
          onThemeChange={onThemeChange}
          t={t}
        />
      )}
      <WindowControls disabled={!hasTauriRuntime} />
    </header>
  );
}
