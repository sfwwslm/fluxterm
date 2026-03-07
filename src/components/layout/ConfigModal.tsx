import { useEffect, useState, type CSSProperties } from "react";
import { error as logError } from "@tauri-apps/plugin-log";
import { open as openDialogFile } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir, readFile } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Locale, Translate } from "@/i18n";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import { useNotices } from "@/hooks/useNotices";
import {
  getAppConfigDir,
  getAppDataDir,
  getBackgroundImageAssetPath,
  getBackgroundImagesDir,
  toBackgroundImageAsset,
} from "@/shared/config/paths";
import type { OpenAiConfigView } from "@/features/ai/types";
import {
  DEFAULT_RESOURCE_MONITOR_INTERVAL_SEC,
  type HostKeyPolicy,
  MAX_SCROLLBACK,
  MIN_RESOURCE_MONITOR_INTERVAL_SEC,
  MIN_SCROLLBACK,
} from "@/hooks/useSessionSettings";
import {
  MAX_BACKGROUND_IMAGE_SURFACE_ALPHA,
  MIN_BACKGROUND_IMAGE_SURFACE_ALPHA,
} from "@/hooks/useAppSettings";
import type { ThemeId } from "@/types";
import "@/components/layout/ConfigModal.css";
import { extractErrorMessage } from "@/shared/errors/appError";

export type ConfigSectionKey =
  | "app-settings"
  | "app-appearance"
  | "ai-settings"
  | "openai-manage"
  | "openai-settings"
  | "session-settings"
  | "session-shell"
  | "config-directory";

export type ConfigSectionItem = {
  key: ConfigSectionKey;
  label: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function getErrorMessage(error: unknown) {
  return extractErrorMessage(error);
}

type ConfigModalProps = {
  open: boolean;
  activeSection: ConfigSectionKey;
  sections: ConfigSectionItem[];
  locale: Locale;
  themeId: ThemeId;
  shellId: string | null;
  availableShells: Array<{ id: string; label: string }>;
  themes: Record<ThemeId, { label: Record<Locale, string> }>;
  sftpEnabled?: boolean;
  fileDefaultEditorPath?: string;
  backgroundImageEnabled?: boolean;
  backgroundImageAsset?: string;
  backgroundImageSurfaceAlpha?: number;
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
  onLocaleChange?: (locale: Locale) => void;
  onThemeChange?: (themeId: ThemeId) => void;
  onShellChange?: (shellId: string | null) => void;
  onFileDefaultEditorPathChange?: (value: string) => void;
  onBackgroundImageEnabledChange?: (enabled: boolean) => void;
  onBackgroundImageAssetChange?: (value: string) => void;
  onBackgroundImageSurfaceAlphaChange?: (value: number) => void;
  onAiSelectionMaxCharsChange?: (value: number) => void;
  onAiSessionRecentOutputMaxCharsChange?: (value: number) => void;
  onAiDebugLoggingEnabledChange?: (enabled: boolean) => void;
  onAiActiveOpenaiConfigIdChange?: (value: string) => void;
  onAiOpenaiConfigAdd?: () => string | void;
  onAiOpenaiConfigRemove?: (configId: string) => void;
  onAiOpenaiConfigNameChange?: (configId: string, value: string) => void;
  onAiOpenaiBaseUrlChange?: (configId: string, value: string) => void;
  onAiOpenaiModelChange?: (configId: string, value: string) => void;
  onAiOpenAiTest?: (configId: string) => Promise<void> | void;
  onAiOpenaiApiKeyReplace?: (
    configId: string,
    value: string,
  ) => Promise<void> | void;
  onAiOpenaiApiKeyClear?: (configId: string) => Promise<void> | void;
  onWebLinksEnabledChange?: (enabled: boolean) => void;
  onCommandAutocompleteEnabledChange?: (enabled: boolean) => void;
  onSelectionAutoCopyEnabledChange?: (enabled: boolean) => void;
  onScrollbackChange?: (value: number) => void;
  onTerminalPathSyncEnabledChange?: (enabled: boolean) => void;
  onResourceMonitorEnabledChange?: (enabled: boolean) => void;
  onResourceMonitorIntervalSecChange?: (value: number) => void;
  onHostKeyPolicyChange?: (value: HostKeyPolicy) => void;
  appSaveState?: SaveState;
  appSaveError?: string | null;
  onAppSaveRetry?: () => void;
  aiSaveState?: SaveState;
  aiSaveError?: string | null;
  onAiSaveRetry?: () => void;
  sessionSaveState?: SaveState;
  sessionSaveError?: string | null;
  onSessionSaveRetry?: () => void;
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

function clampBackgroundImageSurfaceAlpha(value: number) {
  if (!Number.isFinite(value)) return MIN_BACKGROUND_IMAGE_SURFACE_ALPHA;
  return Math.min(
    MAX_BACKGROUND_IMAGE_SURFACE_ALPHA,
    Math.max(MIN_BACKGROUND_IMAGE_SURFACE_ALPHA, value),
  );
}

async function sha256Hex(bytes: Uint8Array) {
  const normalized = new Uint8Array(bytes.byteLength);
  normalized.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", normalized);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/** 配置模态框：承载顶部“配置”菜单的统一内容容器。 */
export default function ConfigModal({
  open,
  activeSection,
  sections,
  locale,
  themeId,
  shellId,
  availableShells,
  themes,
  sftpEnabled = true,
  fileDefaultEditorPath = "",
  backgroundImageEnabled = false,
  backgroundImageAsset = "",
  backgroundImageSurfaceAlpha = 0.52,
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
  onLocaleChange,
  onThemeChange,
  onShellChange,
  onFileDefaultEditorPathChange,
  onBackgroundImageEnabledChange,
  onBackgroundImageAssetChange,
  onBackgroundImageSurfaceAlphaChange,
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
  appSaveState = "idle",
  appSaveError = null,
  onAppSaveRetry,
  aiSaveState = "idle",
  aiSaveError = null,
  onAiSaveRetry,
  sessionSaveState = "idle",
  sessionSaveError = null,
  onSessionSaveRetry,
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
  const [selectedOpenAiConfigId, setSelectedOpenAiConfigId] = useState(
    aiActiveOpenaiConfigId || aiOpenaiConfigs[0]?.id || "",
  );
  const selectedOpenAiConfig =
    aiOpenaiConfigs.find((config) => config.id === selectedOpenAiConfigId) ??
    null;
  const [aiOpenAiNameDraft, setAiOpenAiNameDraft] = useState(
    selectedOpenAiConfig?.name ?? "",
  );
  const [aiOpenAiBaseUrlDraft, setAiOpenAiBaseUrlDraft] = useState(
    selectedOpenAiConfig?.baseUrl ?? "",
  );
  const [aiOpenAiModelDraft, setAiOpenAiModelDraft] = useState(
    selectedOpenAiConfig?.model ?? "",
  );
  const [aiOpenAiApiKeyDraft, setAiOpenAiApiKeyDraft] = useState("");
  const [testingOpenAiConfigId, setTestingOpenAiConfigId] = useState("");
  const isBackgroundImageModeActive =
    backgroundImageEnabled && !!backgroundImageAsset;
  const effectiveModalSurfaceAlpha = isBackgroundImageModeActive
    ? backgroundImageSurfaceAlpha
    : 0.76;
  const isDefaultEditorPathDirty =
    defaultEditorPathDraft.trim() !== fileDefaultEditorPath.trim();
  const isOpenAiNameDirty =
    !!selectedOpenAiConfig &&
    aiOpenAiNameDraft.trim() !== (selectedOpenAiConfig.name ?? "").trim();
  const isOpenAiBaseUrlDirty =
    !!selectedOpenAiConfig &&
    aiOpenAiBaseUrlDraft.trim() !== (selectedOpenAiConfig.baseUrl ?? "").trim();
  const isOpenAiModelDirty =
    !!selectedOpenAiConfig &&
    aiOpenAiModelDraft.trim() !== (selectedOpenAiConfig.model ?? "").trim();
  const hasUnsavedHighRiskChanges =
    isDefaultEditorPathDirty ||
    isOpenAiNameDirty ||
    isOpenAiBaseUrlDirty ||
    isOpenAiModelDirty ||
    !!aiOpenAiApiKeyDraft.trim();

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
    if (
      selectedOpenAiConfigId &&
      aiOpenaiConfigs.some((config) => config.id === selectedOpenAiConfigId)
    ) {
      return;
    }
    setSelectedOpenAiConfigId(
      aiActiveOpenaiConfigId || aiOpenaiConfigs[0]?.id || "",
    );
  }, [aiActiveOpenaiConfigId, aiOpenaiConfigs, selectedOpenAiConfigId]);

  useEffect(() => {
    // OpenAI 接入字段在当前分区内允许连续编辑，不应被自动保存后的同 id 回写覆盖。
    // 这里只在真正切换管理中的接入 id 时重置草稿，避免 baseUrl/model 输入过程中被打断。
    setAiOpenAiNameDraft(selectedOpenAiConfig?.name ?? "");
    setAiOpenAiBaseUrlDraft(selectedOpenAiConfig?.baseUrl ?? "");
    setAiOpenAiModelDraft(selectedOpenAiConfig?.model ?? "");
  }, [selectedOpenAiConfigId]);

  async function pickBackgroundImage() {
    try {
      const selected = await openDialogFile({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      const extMatch = selected.match(/\.([A-Za-z0-9]+)$/);
      const ext = extMatch?.[1]?.toLowerCase();
      if (!ext || !["png", "jpg", "jpeg", "webp"].includes(ext)) {
        pushToast({
          level: "error",
          message: t("config.app.backgroundImageUnsupported"),
        });
        return;
      }

      const sourceBytes = await readFile(selected);
      const hash = await sha256Hex(sourceBytes);
      const backgroundsDir = await getBackgroundImagesDir();
      await mkdir(backgroundsDir, { recursive: true });
      const fileName = `bg-${hash}.${ext}`;
      const targetPath = await getBackgroundImageAssetPath(
        toBackgroundImageAsset(fileName),
      );
      if (!(await exists(targetPath))) {
        await copyFile(selected, targetPath);
      }

      onBackgroundImageAssetChange?.(toBackgroundImageAsset(fileName));
      onBackgroundImageEnabledChange?.(true);
    } catch (error) {
      const message = getErrorMessage(error);
      const normalized = message.toLowerCase();
      const likelyPermissionDenied =
        normalized.includes("forbidden") ||
        normalized.includes("denied") ||
        normalized.includes("not allowed") ||
        normalized.includes("scope");
      pushToast({
        level: "error",
        durationMs: 9000,
        message: likelyPermissionDenied
          ? `${t("config.app.backgroundImagePermissionDenied")}\n${message}`
          : message,
      });
    }
  }

  function handleBackgroundImageSurfaceAlphaInput(rawValue: string) {
    onBackgroundImageSurfaceAlphaChange?.(
      clampBackgroundImageSurfaceAlpha(Number(rawValue)),
    );
  }

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
    if (!selectedOpenAiConfigId) return;
    onAiOpenaiConfigNameChange?.(
      selectedOpenAiConfigId,
      aiOpenAiNameDraft.trim(),
    );
  }

  function commitAiOpenAiBaseUrlDraft() {
    if (!selectedOpenAiConfigId) return;
    onAiOpenaiBaseUrlChange?.(
      selectedOpenAiConfigId,
      aiOpenAiBaseUrlDraft.trim(),
    );
  }

  function commitAiOpenAiModelDraft() {
    if (!selectedOpenAiConfigId) return;
    onAiOpenaiModelChange?.(selectedOpenAiConfigId, aiOpenAiModelDraft.trim());
  }

  async function commitAiOpenAiApiKeyDraft() {
    const value = aiOpenAiApiKeyDraft.trim();
    if (!value || !selectedOpenAiConfigId) return;
    await onAiOpenaiApiKeyReplace?.(selectedOpenAiConfigId, value);
    setAiOpenAiApiKeyDraft("");
  }

  /** 渲染统一的配置持久化状态提示。 */
  function renderSaveStatus(
    state: SaveState,
    error: string | null,
    onRetry?: () => void,
  ) {
    if (state === "idle") return null;
    return (
      <div className={`config-save-status is-${state}`}>
        <span>
          {state === "saving" && t("config.saveState.saving")}
          {state === "saved" && t("config.saveState.saved")}
          {state === "error" && t("config.saveState.failed")}
        </span>
        {state === "error" ? (
          <div className="config-save-status-error">
            {error || t("config.saveState.failed")}
          </div>
        ) : null}
        {state === "error" && onRetry ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t("config.saveState.retry")}
          </Button>
        ) : null}
      </div>
    );
  }

  /** 按当前分区选择对应的状态源，保证不同设置域文案一致。 */
  function renderActiveSectionSaveStatus() {
    if (
      activeSection === "app-settings" ||
      activeSection === "app-appearance"
    ) {
      return renderSaveStatus(appSaveState, appSaveError, onAppSaveRetry);
    }
    if (
      activeSection === "session-settings" ||
      activeSection === "session-shell"
    ) {
      return renderSaveStatus(
        sessionSaveState,
        sessionSaveError,
        onSessionSaveRetry,
      );
    }
    if (
      activeSection === "ai-settings" ||
      activeSection === "openai-manage" ||
      activeSection === "openai-settings"
    ) {
      return renderSaveStatus(aiSaveState, aiSaveError, onAiSaveRetry);
    }
    return null;
  }

  function handleClose() {
    // 低风险数值项在关闭前提交，高风险字段改为显式保存并在离开时确认是否丢弃草稿。
    commitAiSelectionMaxCharsDraft();
    commitAiSessionRecentOutputMaxCharsDraft();
    commitScrollbackDraft();
    commitResourceMonitorIntervalDraft();
    if (
      hasUnsavedHighRiskChanges &&
      !window.confirm(t("config.unsavedChangesConfirm"))
    ) {
      return;
    }
    onClose();
  }

  // 当前入口只渲染所属配置分组，保证同一模态框内的导航与当前菜单语义一致。
  function renderSectionContent() {
    if (activeSection === "app-settings") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.appSettings")}</h3>
          {renderActiveSectionSaveStatus()}
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
                  }}
                >
                  {t("actions.clear")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!isDefaultEditorPathDirty}
                  onClick={commitDefaultEditorPathDraft}
                >
                  {t("actions.save")}
                </Button>
              </div>
            </div>
          </div>
          <div className="config-toggle-card config-feature-group">
            <label className="config-toggle-head">
              <div className="config-toggle-copy">
                <span className="config-toggle-title">
                  {t("config.app.backgroundImage")}
                </span>
                <span className="config-toggle-desc">
                  {t("config.app.backgroundImageHint")}
                </span>
              </div>
              <input
                type="checkbox"
                checked={backgroundImageEnabled}
                onChange={(event) =>
                  onBackgroundImageEnabledChange?.(event.target.checked)
                }
              />
            </label>
            <div className="config-file-picker">
              <div
                className={`config-file-picker-path ${
                  backgroundImageAsset ? "" : "empty"
                }`.trim()}
                title={
                  backgroundImageAsset ||
                  t("config.app.backgroundImagePlaceholder")
                }
              >
                {backgroundImageAsset ||
                  t("config.app.backgroundImagePlaceholder")}
              </div>
              <div className="config-file-picker-actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={pickBackgroundImage}
                >
                  {t("config.app.pickBackgroundImage")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!backgroundImageAsset}
                  onClick={() => {
                    // 清空仅解绑配置，不删除文件，避免误删被复用的去重资源。
                    onBackgroundImageAssetChange?.("");
                    onBackgroundImageEnabledChange?.(false);
                  }}
                >
                  {t("actions.clear")}
                </Button>
              </div>
            </div>
            <div className="config-subsetting config-range-setting">
              <div className="config-toggle-copy">
                <span className="config-toggle-title">
                  {t("config.app.backgroundImageSurfaceAlpha")}
                </span>
                <span className="config-toggle-desc">
                  {t("config.app.backgroundImageSurfaceAlphaHint")}
                </span>
              </div>
              <div className="config-range-control">
                <input
                  type="range"
                  min={MIN_BACKGROUND_IMAGE_SURFACE_ALPHA}
                  max={MAX_BACKGROUND_IMAGE_SURFACE_ALPHA}
                  step={0.01}
                  value={backgroundImageSurfaceAlpha}
                  onInput={(event) =>
                    handleBackgroundImageSurfaceAlphaInput(
                      event.currentTarget.value,
                    )
                  }
                  onChange={(event) =>
                    handleBackgroundImageSurfaceAlphaInput(
                      event.currentTarget.value,
                    )
                  }
                />
                <span className="config-range-value">
                  {Math.round(backgroundImageSurfaceAlpha * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (activeSection === "app-appearance") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.appAppearance")}</h3>
          {renderActiveSectionSaveStatus()}
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("settings.language")}
              </span>
            </div>
            <div className="config-select-control">
              <Select
                value={locale}
                options={[
                  { value: "zh-CN", label: t("language.zh-CN") },
                  { value: "en-US", label: t("language.en-US") },
                ]}
                onChange={(value) => onLocaleChange?.(value as Locale)}
                aria-label={t("settings.language")}
              />
            </div>
          </label>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">{t("settings.theme")}</span>
            </div>
            <div className="config-select-control">
              <Select
                value={themeId}
                options={Object.entries(themes).map(([key, theme]) => ({
                  value: key,
                  label: theme.label[locale],
                }))}
                onChange={(value) => onThemeChange?.(value as ThemeId)}
                aria-label={t("settings.theme")}
              />
            </div>
          </label>
        </div>
      );
    }
    if (activeSection === "ai-settings") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.aiSettings")}</h3>
          {renderActiveSectionSaveStatus()}
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
              className="config-select-input"
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
    if (activeSection === "openai-manage") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.openaiManage")}</h3>
          {renderActiveSectionSaveStatus()}
          <p>{t("config.openai.manageHint")}</p>
          <div className="config-file-picker-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const nextId = onAiOpenaiConfigAdd?.();
                if (nextId) {
                  setSelectedOpenAiConfigId(nextId);
                }
              }}
            >
              {t("config.openai.addConfig")}
            </Button>
          </div>
          {!aiOpenaiConfigs.length ? (
            <div className="config-empty-state">
              {t("config.openai.manageEmpty")}
            </div>
          ) : (
            <div className="config-openai-list">
              {aiOpenaiConfigs.map((config) => {
                const isSelected = config.id === selectedOpenAiConfigId;
                const isActive = config.id === aiActiveOpenaiConfigId;
                return (
                  <button
                    key={config.id}
                    type="button"
                    className={`config-openai-item ${isSelected ? "active" : ""}`.trim()}
                    onClick={() => setSelectedOpenAiConfigId(config.id)}
                  >
                    <span className="config-openai-item-main">
                      <span className="config-openai-item-title">
                        {config.name || t("config.openai.unnamed")}
                      </span>
                      <span className="config-openai-item-meta">
                        {config.baseUrl || t("config.openai.baseUrlEmpty")}
                      </span>
                    </span>
                    {isActive ? (
                      <span className="config-openai-badge">
                        {t("config.openai.currentBadge")}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
          <div className="config-file-picker-actions">
            <Button
              variant="danger"
              size="sm"
              disabled={!selectedOpenAiConfig}
              onClick={() => {
                if (!selectedOpenAiConfig) return;
                const currentIndex = aiOpenaiConfigs.findIndex(
                  (config) => config.id === selectedOpenAiConfig.id,
                );
                const fallbackId =
                  aiOpenaiConfigs[currentIndex + 1]?.id ??
                  aiOpenaiConfigs[currentIndex - 1]?.id ??
                  "";
                onAiOpenaiConfigRemove?.(selectedOpenAiConfig.id);
                setSelectedOpenAiConfigId(fallbackId);
              }}
            >
              {t("config.openai.removeConfig")}
            </Button>
          </div>
        </div>
      );
    }
    if (activeSection === "openai-settings") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.openaiSettings")}</h3>
          {renderActiveSectionSaveStatus()}
          {!selectedOpenAiConfig && (
            <div className="config-empty-state">
              {t("config.openai.manageEmpty")}
            </div>
          )}
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
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitAiOpenAiNameDraft();
              }}
              disabled={!selectedOpenAiConfig}
            />
            <div className="config-file-picker-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={!selectedOpenAiConfig || !isOpenAiNameDirty}
                onClick={commitAiOpenAiNameDraft}
              >
                {t("actions.save")}
              </Button>
            </div>
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
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitAiOpenAiBaseUrlDraft();
              }}
              disabled={!selectedOpenAiConfig}
            />
            <div className="config-file-picker-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={!selectedOpenAiConfig || !isOpenAiBaseUrlDirty}
                onClick={commitAiOpenAiBaseUrlDraft}
              >
                {t("actions.save")}
              </Button>
            </div>
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
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitAiOpenAiModelDraft();
              }}
              disabled={!selectedOpenAiConfig}
            />
            <div className="config-file-picker-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={!selectedOpenAiConfig || !isOpenAiModelDirty}
                onClick={commitAiOpenAiModelDraft}
              >
                {t("actions.save")}
              </Button>
            </div>
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.openai.apiKey")}
              </span>
              <span className="config-toggle-desc">
                {selectedOpenAiConfig?.apiKeyConfigured
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
                disabled={!selectedOpenAiConfig}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!selectedOpenAiConfig || !aiOpenAiApiKeyDraft.trim()}
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
                disabled={!selectedOpenAiConfig?.apiKeyConfigured}
                onClick={() => {
                  setAiOpenAiApiKeyDraft("");
                  Promise.resolve(
                    selectedOpenAiConfig
                      ? onAiOpenaiApiKeyClear?.(selectedOpenAiConfig.id)
                      : undefined,
                  )
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
              variant="primary"
              size="sm"
              disabled={
                !selectedOpenAiConfig ||
                testingOpenAiConfigId === selectedOpenAiConfig.id
              }
              onClick={async () => {
                try {
                  if (!selectedOpenAiConfig) return;
                  setTestingOpenAiConfigId(selectedOpenAiConfig.id);
                  await onAiOpenAiTest?.(selectedOpenAiConfig.id);
                  pushToast({
                    level: "success",
                    message: t("config.openai.testSuccess"),
                  });
                } catch (error) {
                  pushToast({
                    level: "error",
                    message: getErrorMessage(error),
                  });
                } finally {
                  setTestingOpenAiConfigId("");
                }
              }}
            >
              {selectedOpenAiConfig &&
              testingOpenAiConfigId === selectedOpenAiConfig.id
                ? t("config.openai.testing")
                : t("config.openai.test")}
            </Button>
          </div>
        </div>
      );
    }
    if (activeSection === "session-settings") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.sessionSettings")}</h3>
          {renderActiveSectionSaveStatus()}
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
              className="config-select-input"
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
    if (activeSection === "session-shell") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.sessionShell")}</h3>
          {renderActiveSectionSaveStatus()}
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">{t("settings.shell")}</span>
              {!availableShells.length ? (
                <span className="config-toggle-desc">
                  {t("menu.app.shellEmpty")}
                </span>
              ) : null}
            </div>
            <div className="config-select-control">
              <Select
                value={shellId ?? ""}
                disabled={!availableShells.length}
                options={availableShells.map((shell) => ({
                  value: shell.id,
                  label: shell.label,
                }))}
                placeholder={t("menu.app.shellEmpty")}
                onChange={(value) => onShellChange?.(value || null)}
                aria-label={t("settings.shell")}
              />
            </div>
          </label>
        </div>
      );
    }
    return (
      // 右侧配置区统一使用固定高度 + 内部滚动，避免不同分区在内容增长后把模态框继续撑高。
      <div className="config-modal-widget config-modal-widget-scrollable">
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
                    message: extractErrorMessage(error),
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
                    message: extractErrorMessage(error),
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
      <div
        className="config-modal-layout"
        style={
          {
            "--config-modal-surface-alpha": `${Math.round(
              clampBackgroundImageSurfaceAlpha(effectiveModalSurfaceAlpha) *
                100,
            )}%`,
          } as CSSProperties
        }
      >
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
