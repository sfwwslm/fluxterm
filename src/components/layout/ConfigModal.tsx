import { useEffect, useState } from "react";
import { error as logError } from "@tauri-apps/plugin-log";
import { open as openDialogFile } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Translate } from "@/i18n";
import Modal from "@/components/terminal/modals/Modal";
import Button from "@/components/ui/button";
import { useNotices } from "@/hooks/useNotices";
import { getAppConfigDir, getAppDataDir } from "@/shared/config/paths";
import type { OpenAiConfigView } from "@/features/ai/types";
import {
  DEFAULT_RESOURCE_MONITOR_INTERVAL_SEC,
  type HostKeyPolicy,
  MAX_SCROLLBACK,
  MIN_RESOURCE_MONITOR_INTERVAL_SEC,
  MIN_SCROLLBACK,
} from "@/hooks/settings/useSessionSettings";
import "@/components/layout/ConfigModal.css";

export type ConfigSectionKey =
  | "app-settings"
  | "ai-settings"
  | "openai-settings"
  | "session-settings"
  | "config-directory";

export type ConfigSectionItem = {
  key: ConfigSectionKey;
  label: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

type ConfigModalProps = {
  open: boolean;
  activeSection: ConfigSectionKey;
  sections: ConfigSectionItem[];
  sftpEnabled?: boolean;
  fileDefaultEditorPath?: string;
  aiSelectionMaxChars?: number;
  aiSessionRecentOutputMaxChars?: number;
  aiDebugLoggingEnabled?: boolean;
  aiActiveOpenaiConfigId?: string;
  aiOpenaiConfigs?: OpenAiConfigView[];
  webLinksEnabled?: boolean;
  commandAutocompleteEnabled?: boolean;
  selectionAutoCopyEnabled?: boolean;
  scrollback?: number;
  terminalPathSyncEnabled?: boolean;
  resourceMonitorEnabled?: boolean;
  resourceMonitorIntervalSec?: number;
  hostKeyPolicy?: HostKeyPolicy;
  onSftpEnabledChange?: (enabled: boolean) => void;
  onFileDefaultEditorPathChange?: (value: string) => void;
  onAiSelectionMaxCharsChange?: (value: number) => void;
  onAiSessionRecentOutputMaxCharsChange?: (value: number) => void;
  onAiDebugLoggingEnabledChange?: (enabled: boolean) => void;
  onAiActiveOpenaiConfigIdChange?: (value: string) => void;
  onAiOpenaiConfigAdd?: () => void;
  onAiOpenaiConfigRemove?: () => void;
  onAiOpenaiConfigNameChange?: (value: string) => void;
  onAiOpenaiBaseUrlChange?: (value: string) => void;
  onAiOpenaiModelChange?: (value: string) => void;
  onAiOpenAiTest?: () => Promise<void> | void;
  onAiOpenaiApiKeyReplace?: (value: string) => Promise<void> | void;
  onAiOpenaiApiKeyClear?: () => Promise<void> | void;
  onWebLinksEnabledChange?: (enabled: boolean) => void;
  onCommandAutocompleteEnabledChange?: (enabled: boolean) => void;
  onSelectionAutoCopyEnabledChange?: (enabled: boolean) => void;
  onScrollbackChange?: (value: number) => void;
  onTerminalPathSyncEnabledChange?: (enabled: boolean) => void;
  onResourceMonitorEnabledChange?: (enabled: boolean) => void;
  onResourceMonitorIntervalSecChange?: (value: number) => void;
  onHostKeyPolicyChange?: (value: HostKeyPolicy) => void;
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
  sftpEnabled = true,
  fileDefaultEditorPath = "",
  aiSelectionMaxChars = 1500,
  aiSessionRecentOutputMaxChars = 1200,
  aiDebugLoggingEnabled = true,
  aiActiveOpenaiConfigId = "",
  aiOpenaiConfigs = [],
  webLinksEnabled = true,
  commandAutocompleteEnabled = true,
  selectionAutoCopyEnabled = false,
  scrollback = 3000,
  terminalPathSyncEnabled = true,
  resourceMonitorEnabled = false,
  resourceMonitorIntervalSec = DEFAULT_RESOURCE_MONITOR_INTERVAL_SEC,
  hostKeyPolicy = "ask",
  onSftpEnabledChange,
  onFileDefaultEditorPathChange,
  onAiSelectionMaxCharsChange,
  onAiSessionRecentOutputMaxCharsChange,
  onAiDebugLoggingEnabledChange,
  onAiActiveOpenaiConfigIdChange,
  onAiOpenaiConfigAdd,
  onAiOpenaiConfigRemove,
  onAiOpenaiConfigNameChange,
  onAiOpenaiBaseUrlChange,
  onAiOpenaiModelChange,
  onAiOpenAiTest,
  onAiOpenaiApiKeyReplace,
  onAiOpenaiApiKeyClear,
  onWebLinksEnabledChange,
  onCommandAutocompleteEnabledChange,
  onSelectionAutoCopyEnabledChange,
  onScrollbackChange,
  onTerminalPathSyncEnabledChange,
  onResourceMonitorEnabledChange,
  onResourceMonitorIntervalSecChange,
  onHostKeyPolicyChange,
  onClose,
  onSectionChange,
  t,
}: ConfigModalProps) {
  const { pushToast } = useNotices();
  const [configDir, setConfigDir] = useState("");
  const [dataDir, setDataDir] = useState("");
  const [defaultEditorPathDraft, setDefaultEditorPathDraft] = useState(
    fileDefaultEditorPath,
  );
  const [aiSelectionMaxCharsDraft, setAiSelectionMaxCharsDraft] = useState(() =>
    String(aiSelectionMaxChars),
  );
  const [
    aiSessionRecentOutputMaxCharsDraft,
    setAiSessionRecentOutputMaxCharsDraft,
  ] = useState(() => String(aiSessionRecentOutputMaxChars));
  // 数字输入使用本地草稿字符串，允许用户先清空再继续输入。
  const [scrollbackDraft, setScrollbackDraft] = useState(() =>
    String(scrollback),
  );
  const [resourceMonitorIntervalDraft, setResourceMonitorIntervalDraft] =
    useState(() => String(resourceMonitorIntervalSec));
  const activeOpenAiConfig =
    aiOpenaiConfigs.find((config) => config.id === aiActiveOpenaiConfigId) ??
    null;
  const [aiOpenAiNameDraft, setAiOpenAiNameDraft] = useState(
    activeOpenAiConfig?.name ?? "",
  );
  const [aiOpenAiBaseUrlDraft, setAiOpenAiBaseUrlDraft] = useState(
    activeOpenAiConfig?.baseUrl ?? "",
  );
  const [aiOpenAiModelDraft, setAiOpenAiModelDraft] = useState(
    activeOpenAiConfig?.model ?? "",
  );
  const [aiOpenAiApiKeyDraft, setAiOpenAiApiKeyDraft] = useState("");

  useEffect(() => {
    if (!open || activeSection !== "config-directory") return;
    getAppConfigDir()
      .then((path) => {
        setConfigDir(normalizeConfigDirectoryPath(path));
      })
      .catch(() => {
        setConfigDir("");
      });
    getAppDataDir()
      .then((path) => {
        setDataDir(normalizeConfigDirectoryPath(path));
      })
      .catch(() => {
        setDataDir("");
      });
  }, [activeSection, open]);

  useEffect(() => {
    setDefaultEditorPathDraft(fileDefaultEditorPath);
  }, [fileDefaultEditorPath]);

  useEffect(() => {
    setAiSelectionMaxCharsDraft(String(aiSelectionMaxChars));
  }, [aiSelectionMaxChars]);

  useEffect(() => {
    setAiSessionRecentOutputMaxCharsDraft(
      String(aiSessionRecentOutputMaxChars),
    );
  }, [aiSessionRecentOutputMaxChars]);

  useEffect(() => {
    setScrollbackDraft(String(scrollback));
  }, [scrollback]);

  useEffect(() => {
    setResourceMonitorIntervalDraft(String(resourceMonitorIntervalSec));
  }, [resourceMonitorIntervalSec]);

  useEffect(() => {
    // OpenAI 接入字段在当前分区内允许连续编辑，不应被自动保存后的同 id 回写覆盖。
    // 这里只在真正切换当前接入 id 时重置草稿，避免 baseUrl/model 输入过程中被打断。
    setAiOpenAiNameDraft(activeOpenAiConfig?.name ?? "");
    setAiOpenAiBaseUrlDraft(activeOpenAiConfig?.baseUrl ?? "");
    setAiOpenAiModelDraft(activeOpenAiConfig?.model ?? "");
  }, [aiActiveOpenaiConfigId]);

  // 数值草稿在失焦、回车或关闭模态框时统一提交；非法输入回退到当前生效值。
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

  function commitResourceMonitorIntervalDraft() {
    const value = resourceMonitorIntervalDraft.trim();
    if (!value) {
      setResourceMonitorIntervalDraft(String(resourceMonitorIntervalSec));
      return;
    }
    const next = Number(value);
    if (!Number.isFinite(next)) {
      setResourceMonitorIntervalDraft(String(resourceMonitorIntervalSec));
      return;
    }
    onResourceMonitorIntervalSecChange?.(next);
  }

  function commitDefaultEditorPathDraft() {
    onFileDefaultEditorPathChange?.(defaultEditorPathDraft.trim());
  }

  function commitAiSelectionMaxCharsDraft() {
    const value = aiSelectionMaxCharsDraft.trim();
    if (!value) {
      setAiSelectionMaxCharsDraft(String(aiSelectionMaxChars));
      return;
    }
    const next = Number(value);
    if (!Number.isFinite(next)) {
      setAiSelectionMaxCharsDraft(String(aiSelectionMaxChars));
      return;
    }
    onAiSelectionMaxCharsChange?.(next);
  }

  function commitAiSessionRecentOutputMaxCharsDraft() {
    const value = aiSessionRecentOutputMaxCharsDraft.trim();
    if (!value) {
      setAiSessionRecentOutputMaxCharsDraft(
        String(aiSessionRecentOutputMaxChars),
      );
      return;
    }
    const next = Number(value);
    if (!Number.isFinite(next)) {
      setAiSessionRecentOutputMaxCharsDraft(
        String(aiSessionRecentOutputMaxChars),
      );
      return;
    }
    onAiSessionRecentOutputMaxCharsChange?.(next);
  }

  function commitAiOpenAiNameDraft() {
    onAiOpenaiConfigNameChange?.(aiOpenAiNameDraft.trim());
  }

  function commitAiOpenAiBaseUrlDraft() {
    onAiOpenaiBaseUrlChange?.(aiOpenAiBaseUrlDraft.trim());
  }

  function commitAiOpenAiModelDraft() {
    onAiOpenaiModelChange?.(aiOpenAiModelDraft.trim());
  }

  async function commitAiOpenAiApiKeyDraft() {
    const value = aiOpenAiApiKeyDraft.trim();
    if (!value) return;
    await onAiOpenaiApiKeyReplace?.(value);
    setAiOpenAiApiKeyDraft("");
  }

  function handleClose() {
    // 关闭模态框前统一提交当前草稿，保证当前分区的修改能进入设置状态。
    commitDefaultEditorPathDraft();
    commitAiSelectionMaxCharsDraft();
    commitAiSessionRecentOutputMaxCharsDraft();
    commitAiOpenAiNameDraft();
    commitAiOpenAiBaseUrlDraft();
    commitAiOpenAiModelDraft();
    commitScrollbackDraft();
    commitResourceMonitorIntervalDraft();
    onClose();
  }

  // 当前入口只渲染所属配置分组，保证同一模态框内的导航与当前菜单语义一致。
  function renderSectionContent() {
    if (activeSection === "app-settings") {
      return (
        <div className="config-modal-panel config-modal-panel-scrollable">
          <h3>{t("config.section.appSettings")}</h3>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.app.sftpEnabled")}
              </span>
              <span className="config-toggle-desc">
                {t("config.app.sftpEnabledHint")}
              </span>
            </div>
            <input
              type="checkbox"
              checked={sftpEnabled}
              onChange={(event) => onSftpEnabledChange?.(event.target.checked)}
            />
          </label>
          <div className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.app.fileDefaultEditorPath")}
              </span>
              <span className="config-toggle-desc">
                {t("config.app.fileDefaultEditorPathHint")}
              </span>
            </div>
            <div className="config-file-picker">
              <div
                className={`config-file-picker-path ${
                  defaultEditorPathDraft ? "" : "empty"
                }`.trim()}
                title={
                  defaultEditorPathDraft ||
                  t("config.app.fileDefaultEditorPathPlaceholder")
                }
              >
                {defaultEditorPathDraft ||
                  t("config.app.fileDefaultEditorPathPlaceholder")}
              </div>
              <div className="config-file-picker-actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                    const selected = await openDialogFile({
                      multiple: false,
                      directory: false,
                    });
                    if (!selected || Array.isArray(selected)) return;
                    setDefaultEditorPathDraft(selected);
                    onFileDefaultEditorPathChange?.(selected);
                  }}
                >
                  {t("config.app.pickEditor")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!defaultEditorPathDraft}
                  onClick={() => {
                    setDefaultEditorPathDraft("");
                    onFileDefaultEditorPathChange?.("");
                  }}
                >
                  {t("actions.clear")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (activeSection === "ai-settings") {
      return (
        <div className="config-modal-panel config-modal-panel-scrollable">
          <h3>{t("config.section.aiSettings")}</h3>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.selectionMaxChars")}
              </span>
              <span className="config-toggle-desc">
                {t("config.ai.selectionMaxCharsHint")}
              </span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              className="config-number-input"
              value={aiSelectionMaxCharsDraft}
              onChange={(event) =>
                setAiSelectionMaxCharsDraft(event.target.value)
              }
              onBlur={commitAiSelectionMaxCharsDraft}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitAiSelectionMaxCharsDraft();
              }}
            />
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.sessionRecentOutputMaxChars")}
              </span>
              <span className="config-toggle-desc">
                {t("config.ai.sessionRecentOutputMaxCharsHint")}
              </span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              className="config-number-input"
              value={aiSessionRecentOutputMaxCharsDraft}
              onChange={(event) =>
                setAiSessionRecentOutputMaxCharsDraft(event.target.value)
              }
              onBlur={commitAiSessionRecentOutputMaxCharsDraft}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitAiSessionRecentOutputMaxCharsDraft();
              }}
            />
          </div>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.activeOpenAiConfig")}
              </span>
              <span className="config-toggle-desc">
                {t("config.ai.activeOpenAiConfigHint")}
              </span>
            </div>
            <select
              className="config-number-input"
              value={aiActiveOpenaiConfigId}
              onChange={(event) =>
                onAiActiveOpenaiConfigIdChange?.(event.target.value)
              }
            >
              <option value="">{t("config.ai.openaiConfigEmpty")}</option>
              {aiOpenaiConfigs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.name || t("config.openai.unnamed")}
                </option>
              ))}
            </select>
          </label>
          <div className="config-file-picker-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={!activeOpenAiConfig}
              onClick={() => onAiOpenaiConfigRemove?.()}
            >
              {t("config.ai.removeActiveOpenAiConfig")}
            </Button>
          </div>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.debugLoggingEnabled")}
              </span>
              <span className="config-toggle-desc">
                {t("config.ai.debugLoggingEnabledHint")}
              </span>
            </div>
            <input
              type="checkbox"
              checked={aiDebugLoggingEnabled}
              onChange={(event) =>
                onAiDebugLoggingEnabledChange?.(event.target.checked)
              }
            />
          </label>
        </div>
      );
    }
    if (activeSection === "openai-settings") {
      return (
        <div className="config-modal-panel config-modal-panel-scrollable">
          <h3>{t("config.section.openaiSettings")}</h3>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.openai.name")}
              </span>
              <span className="config-toggle-desc">
                {t("config.openai.nameHint")}
              </span>
            </div>
            <input
              type="text"
              className="config-text-input"
              value={aiOpenAiNameDraft}
              onChange={(event) => setAiOpenAiNameDraft(event.target.value)}
              onBlur={commitAiOpenAiNameDraft}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitAiOpenAiNameDraft();
              }}
              disabled={!activeOpenAiConfig}
            />
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.openai.baseUrl")}
              </span>
              <span className="config-toggle-desc">
                {t("config.openai.baseUrlHint")}
              </span>
            </div>
            <input
              type="text"
              className="config-text-input"
              value={aiOpenAiBaseUrlDraft}
              onChange={(event) => setAiOpenAiBaseUrlDraft(event.target.value)}
              onBlur={commitAiOpenAiBaseUrlDraft}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitAiOpenAiBaseUrlDraft();
              }}
              disabled={!activeOpenAiConfig}
            />
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.openai.model")}
              </span>
              <span className="config-toggle-desc">
                {t("config.openai.modelHint")}
              </span>
            </div>
            <input
              type="text"
              className="config-text-input"
              value={aiOpenAiModelDraft}
              placeholder={t("config.openai.modelPlaceholder")}
              onChange={(event) => setAiOpenAiModelDraft(event.target.value)}
              onBlur={commitAiOpenAiModelDraft}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitAiOpenAiModelDraft();
              }}
              disabled={!activeOpenAiConfig}
            />
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.openai.apiKey")}
              </span>
              <span className="config-toggle-desc">
                {activeOpenAiConfig?.apiKeyConfigured
                  ? t("config.openai.apiKeyConfigured")
                  : t("config.openai.apiKeyEmpty")}
              </span>
            </div>
            <div className="config-file-picker-actions">
              <input
                type="password"
                className="config-text-input"
                value={aiOpenAiApiKeyDraft}
                placeholder={t("config.openai.apiKeyPlaceholder")}
                onChange={(event) => setAiOpenAiApiKeyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  commitAiOpenAiApiKeyDraft()
                    .then(() => {
                      pushToast({
                        level: "success",
                        message: t("config.openai.apiKeySaved"),
                      });
                    })
                    .catch((error) => {
                      pushToast({
                        level: "error",
                        message: getErrorMessage(error),
                      });
                    });
                }}
                disabled={!activeOpenAiConfig}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!activeOpenAiConfig || !aiOpenAiApiKeyDraft.trim()}
                onClick={() => {
                  commitAiOpenAiApiKeyDraft()
                    .then(() => {
                      pushToast({
                        level: "success",
                        message: t("config.openai.apiKeySaved"),
                      });
                    })
                    .catch((error) => {
                      pushToast({
                        level: "error",
                        message: getErrorMessage(error),
                      });
                    });
                }}
              >
                {t("actions.save")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!activeOpenAiConfig?.apiKeyConfigured}
                onClick={() => {
                  setAiOpenAiApiKeyDraft("");
                  Promise.resolve(onAiOpenaiApiKeyClear?.())
                    .then(() => {
                      pushToast({
                        level: "success",
                        message: t("config.openai.apiKeyCleared"),
                      });
                    })
                    .catch((error) => {
                      pushToast({
                        level: "error",
                        message: getErrorMessage(error),
                      });
                    });
                }}
              >
                {t("config.openai.clearApiKey")}
              </Button>
            </div>
          </div>
          <div className="config-file-picker-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAiOpenaiConfigAdd?.()}
            >
              {t("config.openai.addConfig")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!activeOpenAiConfig}
              onClick={async () => {
                try {
                  await onAiOpenAiTest?.();
                  pushToast({
                    level: "success",
                    message: t("config.openai.testSuccess"),
                  });
                } catch (error) {
                  pushToast({
                    level: "error",
                    message: getErrorMessage(error),
                  });
                }
              }}
            >
              {t("config.openai.test")}
            </Button>
          </div>
        </div>
      );
    }
    if (activeSection === "session-settings") {
      return (
        <div className="config-modal-panel config-modal-panel-scrollable">
          <h3>{t("config.section.sessionSettings")}</h3>
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
                {t("config.session.commandAutocompleteEnabled")}
              </span>
              <span className="config-toggle-desc">
                {t("config.session.commandAutocompleteEnabledHint")}
              </span>
            </div>
            <input
              type="checkbox"
              checked={commandAutocompleteEnabled}
              onChange={(event) =>
                onCommandAutocompleteEnabledChange?.(event.target.checked)
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
          <div className="config-toggle-card config-feature-group">
            <label className="config-toggle-head">
              <div className="config-toggle-copy">
                <span className="config-toggle-title">
                  {t("config.session.resourceMonitorEnabled")}
                </span>
                <span className="config-toggle-desc">
                  {t("config.session.resourceMonitorEnabledHint")}
                </span>
              </div>
              <input
                type="checkbox"
                checked={resourceMonitorEnabled}
                onChange={(event) =>
                  onResourceMonitorEnabledChange?.(event.target.checked)
                }
              />
            </label>
            <div className="config-subsetting">
              <div className="config-toggle-copy">
                <span className="config-toggle-title">
                  {t("config.session.resourceMonitorIntervalSec")}
                </span>
                <span className="config-toggle-desc">
                  {t("config.session.resourceMonitorIntervalSecHint", {
                    min: MIN_RESOURCE_MONITOR_INTERVAL_SEC,
                  })}
                </span>
              </div>
              <input
                type="text"
                inputMode="numeric"
                className="config-number-input"
                value={resourceMonitorIntervalDraft}
                onChange={(event) => {
                  setResourceMonitorIntervalDraft(event.target.value);
                }}
                onBlur={commitResourceMonitorIntervalDraft}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  commitResourceMonitorIntervalDraft();
                }}
              />
            </div>
          </div>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.session.hostKeyPolicy")}
              </span>
              <span className="config-toggle-desc">
                {t("config.session.hostKeyPolicyHint")}
              </span>
            </div>
            <select
              className="config-number-input"
              value={hostKeyPolicy}
              onChange={(event) =>
                onHostKeyPolicyChange?.(event.target.value as HostKeyPolicy)
              }
            >
              <option value="ask">
                {t("config.session.hostKeyPolicy.ask")}
              </option>
              <option value="strict">
                {t("config.session.hostKeyPolicy.strict")}
              </option>
              <option value="off">
                {t("config.session.hostKeyPolicy.off")}
              </option>
            </select>
          </label>
        </div>
      );
    }
    return (
      // 右侧配置区统一使用固定高度 + 内部滚动，避免不同分区在内容增长后把模态框继续撑高。
      <div className="config-modal-panel config-modal-panel-scrollable">
        <h3>{t("config.section.configDirectory")}</h3>
        <div className="config-dir-card">
          <div className="config-toggle-copy">
            <span className="config-toggle-title">
              {t("config.directory.configTitle")}
            </span>
          </div>
          <div className="config-dir-path">
            {configDir || t("config.directory.configUnavailable")}
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
                  message: t("config.directory.configOpenFailed"),
                });
                void logError(
                  JSON.stringify({
                    event: "config-directory:open-failed",
                    path: configDir,
                    message:
                      error instanceof Error ? error.message : String(error),
                  }),
                );
              }
            }}
          >
            {t("config.directory.openConfig")}
          </Button>
        </div>
        <div className="config-dir-card">
          <div className="config-toggle-copy">
            <span className="config-toggle-title">
              {t("config.directory.dataTitle")}
            </span>
          </div>
          <div className="config-dir-path">
            {dataDir || t("config.directory.dataUnavailable")}
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={!dataDir}
            onClick={async () => {
              if (!dataDir) return;
              try {
                await openPath(dataDir);
              } catch (error) {
                pushToast({
                  level: "error",
                  message: t("config.directory.dataOpenFailed"),
                });
                void logError(
                  JSON.stringify({
                    event: "data-directory:open-failed",
                    path: dataDir,
                    message:
                      error instanceof Error ? error.message : String(error),
                  }),
                );
              }
            }}
          >
            {t("config.directory.openData")}
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
