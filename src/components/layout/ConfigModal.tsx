import { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Translate } from "@/i18n";
import Modal from "@/components/terminal/modals/Modal";
import Button from "@/components/ui/button";
import { useNotices } from "@/hooks/useNotices";
import { getFluxTermConfigDir } from "@/shared/config/paths";
import {
  MAX_SCROLLBACK,
  MIN_SCROLLBACK,
} from "@/hooks/settings/useSessionSettings";
import "@/components/layout/ConfigModal.css";

export type ConfigSectionKey =
  | "app-settings"
  | "session-settings"
  | "config-directory";

export type ConfigSectionItem = {
  key: ConfigSectionKey;
  label: string;
};

type ConfigModalProps = {
  open: boolean;
  activeSection: ConfigSectionKey;
  sections: ConfigSectionItem[];
  webLinksEnabled?: boolean;
  selectionAutoCopyEnabled?: boolean;
  scrollback?: number;
  terminalPathSyncEnabled?: boolean;
  onWebLinksEnabledChange?: (enabled: boolean) => void;
  onSelectionAutoCopyEnabledChange?: (enabled: boolean) => void;
  onScrollbackChange?: (value: number) => void;
  onTerminalPathSyncEnabledChange?: (enabled: boolean) => void;
  onClose: () => void;
  onSectionChange: (section: ConfigSectionKey) => void;
  t: Translate;
};

function normalizeConfigDirectoryPath(path: string) {
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

/** 配置模态框：承载顶部“配置”菜单的统一内容容器。 */
export default function ConfigModal({
  open,
  activeSection,
  sections,
  webLinksEnabled = true,
  selectionAutoCopyEnabled = false,
  scrollback = 3000,
  terminalPathSyncEnabled = true,
  onWebLinksEnabledChange,
  onSelectionAutoCopyEnabledChange,
  onScrollbackChange,
  onTerminalPathSyncEnabledChange,
  onClose,
  onSectionChange,
  t,
}: ConfigModalProps) {
  const { pushToast } = useNotices();
  const [configDir, setConfigDir] = useState("");
  // 数字输入使用本地草稿字符串，避免受控 number 输入在清空/连续编辑时不断打断用户。
  const [scrollbackDraft, setScrollbackDraft] = useState(() =>
    String(scrollback),
  );

  useEffect(() => {
    if (!open || activeSection !== "config-directory") return;
    getFluxTermConfigDir()
      .then((path) => {
        setConfigDir(normalizeConfigDirectoryPath(path));
      })
      .catch(() => {
        setConfigDir("");
      });
  }, [activeSection, open]);

  useEffect(() => {
    setScrollbackDraft(String(scrollback));
  }, [scrollback]);

  // 仅在失焦、回车或模态框关闭时提交草稿；非法输入则回退到当前生效值。
  function commitScrollbackDraft() {
    const value = scrollbackDraft.trim();
    if (!value) {
      setScrollbackDraft(String(scrollback));
      return;
    }
    const next = Number(value);
    if (!Number.isFinite(next)) {
      setScrollbackDraft(String(scrollback));
      return;
    }
    onScrollbackChange?.(next);
  }

  function handleClose() {
    // 遮罩关闭发生在 input blur 之前，这里先提交草稿，避免用户点到模态框外部时丢失修改。
    commitScrollbackDraft();
    onClose();
  }

  // 左侧导航只渲染当前入口所属的配置分组，避免“设置 / 会话设置 / 配置文件目录”共享同一总导航。
  function renderSectionContent() {
    if (activeSection === "app-settings") {
      return (
        <div className="config-modal-panel">
          <h3>{t("config.section.appSettings")}</h3>
          <p>{t("config.placeholder.appSettings")}</p>
        </div>
      );
    }
    if (activeSection === "session-settings") {
      return (
        <div className="config-modal-panel">
          <h3>{t("config.section.sessionSettings")}</h3>
          <p>{t("config.session.description")}</p>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.session.webLinksEnabled")}
              </span>
              <span className="config-toggle-desc">
                {t("config.session.webLinksEnabledHint")}
              </span>
            </div>
            <input
              type="checkbox"
              checked={webLinksEnabled}
              onChange={(event) =>
                onWebLinksEnabledChange?.(event.target.checked)
              }
            />
          </label>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.session.selectionAutoCopyEnabled")}
              </span>
              <span className="config-toggle-desc">
                {t("config.session.selectionAutoCopyEnabledHint")}
              </span>
            </div>
            <input
              type="checkbox"
              checked={selectionAutoCopyEnabled}
              onChange={(event) =>
                onSelectionAutoCopyEnabledChange?.(event.target.checked)
              }
            />
          </label>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.session.terminalPathSyncEnabled")}
              </span>
              <span className="config-toggle-desc">
                {t("config.session.terminalPathSyncEnabledHint")}
              </span>
            </div>
            <input
              type="checkbox"
              checked={terminalPathSyncEnabled}
              onChange={(event) =>
                onTerminalPathSyncEnabledChange?.(event.target.checked)
              }
            />
          </label>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.session.scrollback")}
              </span>
              <span className="config-toggle-desc">
                {t("config.session.scrollbackHint", {
                  min: MIN_SCROLLBACK,
                  max: MAX_SCROLLBACK,
                })}
              </span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              className="config-number-input"
              value={scrollbackDraft}
              onChange={(event) => {
                setScrollbackDraft(event.target.value);
              }}
              onBlur={commitScrollbackDraft}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitScrollbackDraft();
              }}
            />
          </label>
        </div>
      );
    }
    return (
      <div className="config-modal-panel">
        <h3>{t("config.section.configDirectory")}</h3>
        <p>{t("config.directory.description")}</p>
        <div className="config-dir-card">
          <div className="config-dir-path">
            {configDir || t("config.directory.unavailable")}
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={!configDir}
            onClick={async () => {
              if (!configDir) return;
              try {
                await openPath(configDir);
              } catch (error) {
                pushToast({
                  level: "error",
                  message: t("config.directory.openFailed"),
                });
                console.error(
                  "Failed to open config directory",
                  error instanceof Error ? error.message : error,
                );
              }
            }}
          >
            {t("config.directory.open")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      title={t("menu.config")}
      closeLabel={t("actions.close")}
      onClose={handleClose}
      bodyClassName="config-modal-body"
    >
      <div className="config-modal-layout">
        <aside className="config-modal-nav" aria-label={t("menu.config")}>
          {sections.map((section) => (
            <button
              key={section.key}
              type="button"
              className={`config-modal-nav-item ${
                section.key === activeSection ? "active" : ""
              }`}
              onClick={() => onSectionChange(section.key)}
            >
              {section.label}
            </button>
          ))}
        </aside>
        <section className="config-modal-content">
          {renderSectionContent()}
        </section>
      </div>
    </Modal>
  );
}
