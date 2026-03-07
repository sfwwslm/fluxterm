/** 自定义标题栏组件，包含品牌区、菜单栏与窗口控制，并支持双击切换最大化。 */
import { useCallback } from "react";
import type React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Translate } from "@/i18n";
import type { WidgetSide } from "@/layout/types";
import type { SubAppId, SubAppRuntimeStatus } from "@/subapps/types";
import type { ConfigSectionKey } from "@/components/layout/ConfigModal";
import Menus from "./Menus";
import WindowControls from "./WindowControls";

type TitleBarProps = {
  onOpenConfigSection: (section: ConfigSectionKey) => void;
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  onToggleCollapsed: (side: WidgetSide | "bottom") => void;
  onOpenAbout: () => void;
  footerVisibility?: { quickbar: boolean; statusbar: boolean };
  onToggleFooterPart?: (part: "quickbar" | "statusbar") => void;
  layoutDisabled?: boolean;
  onBrandContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  showMenus?: boolean;
  subApps?: Array<{
    id: SubAppId;
    label: string;
    status: SubAppRuntimeStatus;
  }>;
  onLaunchSubApp?: (id: SubAppId) => void;
  onFocusSubApp?: (id: SubAppId) => void;
  onCloseSubApp?: (id: SubAppId) => void;
  t: Translate;
};

export default function TitleBar({
  onOpenConfigSection,
  layoutCollapsed,
  onToggleCollapsed,
  onOpenAbout,
  footerVisibility = { quickbar: true, statusbar: true },
  onToggleFooterPart,
  layoutDisabled,
  onBrandContextMenu,
  showMenus = true,
  subApps = [],
  onLaunchSubApp,
  onFocusSubApp,
  onCloseSubApp,
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
          onOpenConfigSection={onOpenConfigSection}
          layoutCollapsed={layoutCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          onOpenAbout={onOpenAbout}
          footerVisibility={footerVisibility}
          onToggleFooterPart={onToggleFooterPart}
          layoutDisabled={layoutDisabled}
          subApps={subApps}
          onLaunchSubApp={onLaunchSubApp}
          onFocusSubApp={onFocusSubApp}
          onCloseSubApp={onCloseSubApp}
          t={t}
        />
      )}
      <WindowControls disabled={!hasTauriRuntime} />
    </header>
  );
}
