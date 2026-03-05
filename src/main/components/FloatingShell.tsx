import type React from "react";
import type { Locale, Translate } from "@/i18n";
import type { ConfigSectionKey } from "@/components/layout/ConfigModal";
import type { WidgetKey, ThemeId } from "@/types";
import type { WidgetSide } from "@/layout/types";
import TitleBar from "@/components/layout/TitleBar";
import AboutModal from "@/main/components/modals/AboutModal";
import { isMacOS } from "@/utils/platform";

type FloatingShellProps = {
  floatingWidgetKey: WidgetKey;
  widgetLabels: Record<WidgetKey, string>;
  widgetBody: React.ReactNode;
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  onToggleCollapsed: (side: WidgetSide | "bottom") => void;
  layoutMenuDisabled: boolean;
  aboutOpen: boolean;
  onOpenAbout: () => void;
  onCloseAbout: () => void;
  onOpenDevtools: () => void;
  onOpenConfigSection: (section: ConfigSectionKey) => void;
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
  floatingWidgetKey,
  widgetLabels,
  widgetBody,
  layoutCollapsed,
  onToggleCollapsed,
  layoutMenuDisabled,
  aboutOpen,
  onOpenAbout,
  onCloseAbout,
  onOpenDevtools,
  onOpenConfigSection,
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
          onOpenConfigSection={onOpenConfigSection}
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
        <section className="widget floating-widget">
          <div className="widget-header floating-header">
            <span>{widgetLabels[floatingWidgetKey]}</span>
          </div>
          <div className="widget-body">{widgetBody}</div>
        </section>
      </div>
      <AboutModal
        open={aboutOpen}
        onClose={onCloseAbout}
        onOpenDevtools={onOpenDevtools}
        t={t}
      />
    </div>
  );
}
