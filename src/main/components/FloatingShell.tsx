import type React from "react";
import type { Translate } from "@/i18n";
import type { ConfigSectionKey } from "@/components/layout/ConfigModal";
import type { WidgetKey } from "@/types";
import type { WidgetSide } from "@/layout/types";
import TitleBar from "@/components/layout/TitleBar";
import WidgetTitleBar from "@/components/layout/WidgetTitleBar";
import { isMacOS } from "@/utils/platform";

type FloatingShellProps = {
  floatingWidgetKey: WidgetKey;
  widgetLabels: Record<WidgetKey, string>;
  widgetBody: React.ReactNode;
  layoutCollapsed: Record<WidgetSide | "bottom", boolean>;
  onToggleCollapsed: (side: WidgetSide | "bottom") => void;
  layoutMenuDisabled: boolean;
  onOpenConfigSection: (section: ConfigSectionKey) => void;
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
  onOpenConfigSection,
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
          onOpenAbout={() => {}}
          layoutDisabled={layoutMenuDisabled}
          showMenus={false}
          t={t}
        />
      )}
      <div className="floating-body">
        <section className="widget floating-widget">
          <WidgetTitleBar
            active={floatingWidgetKey}
            allWidgets={[floatingWidgetKey]}
            labels={widgetLabels}
            onReplace={() => {}}
            titleOnly
            t={t}
          />
          <div className="widget-body">{widgetBody}</div>
        </section>
      </div>
    </div>
  );
}
