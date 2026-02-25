import type React from "react";
import type { Locale, Translate } from "@/i18n";
import type { PanelKey, ThemeId } from "@/types";
import type { WidgetSide } from "@/layout/types";
import TitleBar from "@/components/layout/TitleBar";
import AboutModal from "@/components/terminal/modals/AboutModal";
import { isMacOS } from "@/utils/platform";

type FloatingShellProps = {
  floatingPanelKey: PanelKey;
  panelLabels: Record<PanelKey, string>;
  panelBody: React.ReactNode;
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  onToggleCollapsed: (side: WidgetSide | "bottom") => void;
  layoutMenuDisabled: boolean;
  aboutOpen: boolean;
  onOpenAbout: () => void;
  onCloseAbout: () => void;
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

/** 悬浮窗口的整体容器。 */
export default function FloatingShell({
  floatingPanelKey,
  panelLabels,
  panelBody,
  layoutCollapsed,
  onToggleCollapsed,
  layoutMenuDisabled,
  aboutOpen,
  onOpenAbout,
  onCloseAbout,
  locale,
  themeId,
  shellId,
  availableShells,
  themes,
  onLocaleChange,
  onShellChange,
  onThemeChange,
  t,
}: FloatingShellProps) {
  const isMac = isMacOS();

  return (
    <div className="floating-shell">
      {!isMac && (
        <TitleBar
          layoutCollapsed={layoutCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          onOpenAbout={onOpenAbout}
          layoutDisabled={layoutMenuDisabled}
          showMenus={false}
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
      <div className="floating-body">
        <section className="panel floating-widget">
          <div className="panel-header floating-header">
            <span>{panelLabels[floatingPanelKey]}</span>
          </div>
          <div className="panel-body">{panelBody}</div>
        </section>
      </div>
      <AboutModal open={aboutOpen} onClose={onCloseAbout} t={t} />
    </div>
  );
}
