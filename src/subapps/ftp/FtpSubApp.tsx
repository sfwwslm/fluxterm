import { useCallback, useEffect, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Locale, Translate } from "@/i18n";
import {
  SUBAPP_LIFECYCLE_CHANNEL,
  createSubAppWindowLabel,
  type SubAppLifecycleMessage,
} from "@/subapps/core/lifecycle";
import type { SubAppId } from "@/subapps/types";
import SubAppTitleBar from "@/subapps/components/SubAppTitleBar";
import "./FtpSubApp.css";

type FtpSubAppProps = {
  id: SubAppId;
  locale: Locale;
  t: Translate;
};

/** FTP 子应用 demo 壳层。 */
export default function FtpSubApp({ id, locale, t }: FtpSubAppProps) {
  const windowLabel = useMemo(() => createSubAppWindowLabel(id), [id]);
  const closingRef = useRef(false);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SUBAPP_LIFECYCLE_CHANNEL);

    const postMessage = (message: SubAppLifecycleMessage) => {
      channel.postMessage(message);
    };

    const publishReady = () => {
      postMessage({
        type: "subapp:ready",
        id,
        label: windowLabel,
        source: "subapp",
      });
    };

    channel.onmessage = (event) => {
      const payload = event.data as SubAppLifecycleMessage | undefined;
      if (!payload) return;
      if (payload.type === "subapp:main-shutdown") {
        closingRef.current = true;
        getCurrentWindow()
          .close()
          .catch(() => {});
        return;
      }
      if (
        payload.type === "subapp:close-request" &&
        payload.id === id &&
        payload.label === windowLabel
      ) {
        closingRef.current = true;
        getCurrentWindow()
          .close()
          .catch(() => {});
      }
    };

    publishReady();

    const onUnload = () => {
      postMessage({
        type: "subapp:closed",
        id,
        label: windowLabel,
        source: "subapp",
      });
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      channel.close();
    };
  }, [id, windowLabel]);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(SUBAPP_LIFECYCLE_CHANNEL);
      channel.postMessage({
        type: "subapp:close-request",
        id,
        label: windowLabel,
        source: "subapp",
        reason: "window-close",
      } satisfies SubAppLifecycleMessage);
      channel.close();
    }
    getCurrentWindow()
      .close()
      .catch(() => {});
  }, [id, windowLabel]);

  const menus = useMemo(
    () => [
      {
        id: "app",
        labelKey: "subapp.menu.app" as const,
        actions: [
          {
            type: "section" as const,
            id: "app-section-window",
            labelKey: "subapp.menu.section.window" as const,
          },
          {
            id: "app-close-window",
            labelKey: "subapp.menu.closeWindow" as const,
            onClick: handleClose,
          },
          {
            type: "divider" as const,
            id: "app-divider-1",
          },
          {
            id: "app-menu-placeholder",
            labelKey: "subapp.menu.placeholder" as const,
            disabled: true,
            onClick: () => {},
          },
        ],
      },
    ],
    [handleClose],
  );

  return (
    <div className="subapp-demo-shell">
      <SubAppTitleBar
        title="FluxTerm"
        subtitle={`${t("subapp.ftp.title")} (${locale === "zh-CN" ? "演示版" : "Demo"})`}
        menus={menus}
        t={t}
      />
      <main className="subapp-demo-content">
        <article className="subapp-demo-card">
          <h2>{t("subapp.ftp.demoHeading")}</h2>
          <p>{t("subapp.ftp.demoBody")}</p>
        </article>
      </main>
    </div>
  );
}
