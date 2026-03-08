import { useEffect, useState, type CSSProperties } from "react";
import { error as logError } from "@/shared/logging/telemetry";
import { open as openDialogFile } from "@tauri-apps/plugin-dialog";
import {
  copyFile,
  exists,
  mkdir,
  readFile,
  remove,
} from "@tauri-apps/plugin-fs";
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
import type { AiProviderVendor, AiProviderView } from "@/features/ai/types";
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
import {
  BACKGROUND_IMAGE_EXTENSIONS,
  BACKGROUND_MEDIA_EXTENSIONS,
  BACKGROUND_VIDEO_EXTENSIONS,
  clampBackgroundVideoReplayIntervalSec,
  normalizeBackgroundMediaType,
  normalizeBackgroundRenderMode,
  normalizeBackgroundVideoReplayMode,
  type BackgroundMediaType,
  type BackgroundRenderMode,
  type BackgroundVideoReplayMode,
} from "@/constants/backgroundMedia";
import "@/components/layout/ConfigModal.css";
import { extractErrorMessage } from "@/shared/errors/appError";
import {
  AI_PROVIDER_PRESETS,
  getAiProviderPreset,
} from "@/constants/aiProviders";

export type ConfigSectionKey =
  | "app-settings"
  | "app-appearance"
  | "ai-settings"
  | "ai-provider-manage"
  | "ai-provider-quick"
  | "ai-provider-compat"
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

/** 从完整路径提取程序文件名，用于配置页简洁展示。 */
function getProgramNameFromPath(path: string) {
  if (!path) return "";
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
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
  backgroundMediaType?: BackgroundMediaType;
  backgroundRenderMode?: BackgroundRenderMode;
  backgroundVideoReplayMode?: BackgroundVideoReplayMode;
  backgroundVideoReplayIntervalSec?: number;
  aiSelectionMaxChars?: number;
  aiSessionRecentOutputMaxChars?: number;
  aiDebugLoggingEnabled?: boolean;
  aiActiveProviderId?: string;
  aiProviders?: AiProviderView[];
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
  onBackgroundMediaTypeChange?: (value: BackgroundMediaType) => void;
  onBackgroundRenderModeChange?: (value: BackgroundRenderMode) => void;
  onBackgroundVideoReplayModeChange?: (
    value: BackgroundVideoReplayMode,
  ) => void;
  onBackgroundVideoReplayIntervalSecChange?: (value: number) => void;
  onAiSelectionMaxCharsChange?: (value: number) => void;
  onAiSessionRecentOutputMaxCharsChange?: (value: number) => void;
  onAiDebugLoggingEnabledChange?: (enabled: boolean) => void;
  onAiActiveProviderIdChange?: (value: string) => void;
  onAiPresetProviderCreate?: (input: {
    vendor?: AiProviderVendor;
    name: string;
    model: string;
    apiKey: string;
  }) => Promise<string | void> | string | void;
  onAiCompatibleProviderCreate?: (input: {
    name: string;
    baseUrl: string;
    model: string;
    apiKey: string;
  }) => Promise<string | void> | string | void;
  onAiProviderRemove?: (providerId: string) => void;
  onAiProviderTest?: (providerId: string) => Promise<void> | void;
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
  backgroundMediaType = "image",
  backgroundRenderMode = "cover",
  backgroundVideoReplayMode = "loop",
  backgroundVideoReplayIntervalSec = 8,
  aiSelectionMaxChars = 1500,
  aiSessionRecentOutputMaxChars = 1200,
  aiDebugLoggingEnabled = true,
  aiActiveProviderId = "",
  aiProviders = [],
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
  onBackgroundMediaTypeChange,
  onBackgroundRenderModeChange,
  onBackgroundVideoReplayModeChange,
  onBackgroundVideoReplayIntervalSecChange,
  onAiSelectionMaxCharsChange,
  onAiSessionRecentOutputMaxCharsChange,
  onAiDebugLoggingEnabledChange,
  onAiActiveProviderIdChange,
  onAiPresetProviderCreate,
  onAiCompatibleProviderCreate,
  onAiProviderRemove,
  onAiProviderTest,
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
  const [
    backgroundVideoReplayIntervalDraft,
    setBackgroundVideoReplayIntervalDraft,
  ] = useState(() =>
    String(
      clampBackgroundVideoReplayIntervalSec(backgroundVideoReplayIntervalSec),
    ),
  );
  const [selectedProviderId, setSelectedProviderId] = useState(
    aiActiveProviderId || aiProviders[0]?.id || "",
  );
  const [quickPresetVendorDraft, setQuickPresetVendorDraft] =
    useState<AiProviderVendor>("deepseek");
  const [quickPresetNameDraft, setQuickPresetNameDraft] = useState("");
  const [quickPresetModelDraft, setQuickPresetModelDraft] = useState(
    getAiProviderPreset("deepseek")?.models[0] ?? "",
  );
  const [quickPresetApiKeyDraft, setQuickPresetApiKeyDraft] = useState("");
  const [quickPresetCreating, setQuickPresetCreating] = useState(false);
  const [compatibleNameDraft, setCompatibleNameDraft] = useState("");
  const [compatibleBaseUrlDraft, setCompatibleBaseUrlDraft] = useState("");
  const [compatibleModelDraft, setCompatibleModelDraft] = useState("");
  const [compatibleApiKeyDraft, setCompatibleApiKeyDraft] = useState("");
  const [compatibleCreating, setCompatibleCreating] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState("");
  const isDeveloperMode = import.meta.env.DEV;
  const normalizedBackgroundMediaType =
    normalizeBackgroundMediaType(backgroundMediaType);
  const normalizedBackgroundRenderMode =
    normalizeBackgroundRenderMode(backgroundRenderMode);
  const normalizedBackgroundVideoReplayMode =
    normalizeBackgroundVideoReplayMode(backgroundVideoReplayMode);
  const normalizedBackgroundVideoReplayIntervalSec =
    clampBackgroundVideoReplayIntervalSec(backgroundVideoReplayIntervalSec);
  const isBackgroundVideoMode = normalizedBackgroundMediaType === "video";
  const isBackgroundImageModeActive =
    backgroundImageEnabled && !!backgroundImageAsset;
  const effectiveModalSurfaceAlpha = isBackgroundImageModeActive
    ? backgroundImageSurfaceAlpha
    : 0.76;
  const isDefaultEditorPathDirty =
    defaultEditorPathDraft.trim() !== fileDefaultEditorPath.trim();
  const hasUnsavedHighRiskChanges = isDefaultEditorPathDirty;

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
    setBackgroundVideoReplayIntervalDraft(
      String(normalizedBackgroundVideoReplayIntervalSec),
    );
  }, [normalizedBackgroundVideoReplayIntervalSec]);

  useEffect(() => {
    setResourceMonitorIntervalDraft(String(resourceMonitorIntervalSec));
  }, [resourceMonitorIntervalSec]);

  useEffect(() => {
    if (
      selectedProviderId &&
      aiProviders.some((provider) => provider.id === selectedProviderId)
    ) {
      return;
    }
    setSelectedProviderId(aiActiveProviderId || aiProviders[0]?.id || "");
  }, [aiActiveProviderId, aiProviders, selectedProviderId]);

  useEffect(() => {
    const preset = getAiProviderPreset(quickPresetVendorDraft);
    setQuickPresetModelDraft(preset?.models[0] ?? "");
  }, [quickPresetVendorDraft]);

  async function pickBackgroundMedia() {
    try {
      const selected = await openDialogFile({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Media",
            extensions: BACKGROUND_MEDIA_EXTENSIONS,
          },
          {
            name: "Images",
            extensions: BACKGROUND_IMAGE_EXTENSIONS,
          },
          {
            name: "Videos",
            extensions: BACKGROUND_VIDEO_EXTENSIONS,
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      const extMatch = selected.match(/\.([A-Za-z0-9]+)$/);
      const ext = extMatch?.[1]?.toLowerCase();
      if (!ext || !BACKGROUND_MEDIA_EXTENSIONS.includes(ext)) {
        pushToast({
          level: "error",
          message: t("config.app.backgroundMediaUnsupported"),
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
      onBackgroundMediaTypeChange?.(
        BACKGROUND_VIDEO_EXTENSIONS.includes(ext) ? "video" : "image",
      );
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
          ? `${t("config.app.backgroundMediaPermissionDenied")}\n${message}`
          : message,
      });
    }
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

  function commitBackgroundVideoReplayIntervalDraft() {
    const value = backgroundVideoReplayIntervalDraft.trim();
    if (!value) {
      setBackgroundVideoReplayIntervalDraft(
        String(normalizedBackgroundVideoReplayIntervalSec),
      );
      return;
    }
    const next = clampBackgroundVideoReplayIntervalSec(Number(value));
    setBackgroundVideoReplayIntervalDraft(String(next));
    onBackgroundVideoReplayIntervalSecChange?.(next);
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

  function isProviderNameDuplicate(name: string, excludeId?: string) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return false;
    return aiProviders.some(
      (provider) =>
        provider.id !== excludeId &&
        provider.name.trim().toLowerCase() === normalized,
    );
  }

  function renderProviderList(
    list: AiProviderView[],
    options?: { removable?: boolean },
  ) {
    if (!list.length) return null;
    return (
      <div className="config-openai-list">
        {list.map((provider) => {
          const isSelected = provider.id === selectedProviderId;
          const isActive = provider.id === aiActiveProviderId;
          return (
            <button
              key={provider.id}
              type="button"
              className={`config-openai-item ${isSelected ? "active" : ""}`.trim()}
              onClick={() => setSelectedProviderId(provider.id)}
            >
              <span className="config-openai-item-main">
                <span className="config-openai-item-title">
                  {provider.name || t("config.ai.providerUnnamed")}
                </span>
                <span className="config-openai-item-meta">
                  {provider.baseUrl || t("config.ai.providerBaseUrlEmpty")}
                </span>
              </span>
              {isActive ? (
                <span className="config-openai-badge">
                  {t("config.ai.providerCurrentBadge")}
                </span>
              ) : null}
              {options?.removable ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="config-openai-badge"
                  onClick={(event) => {
                    event.stopPropagation();
                    const isRemovingActive = provider.id === aiActiveProviderId;
                    onAiProviderRemove?.(provider.id);
                    if (selectedProviderId === provider.id) {
                      setSelectedProviderId("");
                    }
                    if (isRemovingActive) {
                      onAiActiveProviderIdChange?.("");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    const isRemovingActive = provider.id === aiActiveProviderId;
                    onAiProviderRemove?.(provider.id);
                    if (selectedProviderId === provider.id) {
                      setSelectedProviderId("");
                    }
                    if (isRemovingActive) {
                      onAiActiveProviderIdChange?.("");
                    }
                  }}
                >
                  {t("config.ai.providerRemove")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
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
      activeSection === "ai-provider-manage" ||
      activeSection === "ai-provider-quick" ||
      activeSection === "ai-provider-compat"
    ) {
      if (!aiActiveProviderId && aiSaveState === "error") {
        return null;
      }
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
    commitBackgroundVideoReplayIntervalDraft();
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
      const defaultEditorProgramName = getProgramNameFromPath(
        defaultEditorPathDraft,
      );
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
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-head">
              <div className="config-toggle-copy">
                <span className="config-toggle-title">
                  {t("config.app.fileDefaultEditorPath")}
                </span>
              </div>
            </div>
            <div className="config-file-picker config-file-picker-align-end">
              <div
                className={`config-file-picker-path config-file-picker-path-single-line ${
                  defaultEditorProgramName ? "" : "empty"
                }`.trim()}
                title={
                  defaultEditorPathDraft ||
                  t("config.app.fileDefaultEditorUnset")
                }
              >
                {defaultEditorProgramName ||
                  t("config.app.fileDefaultEditorUnset")}
              </div>
              <div className="config-file-picker-actions config-file-picker-actions-nowrap">
                <Button
                  variant="primary"
                  size="sm"
                  className="config-bg-image-action-button"
                  onClick={() => {
                    void (async () => {
                      const selected = await openDialogFile({
                        multiple: false,
                        directory: false,
                      });
                      if (!selected || Array.isArray(selected)) return;
                      setDefaultEditorPathDraft(selected);
                    })();
                  }}
                >
                  {t("config.app.pickEditor")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="config-bg-image-action-button"
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
                  className="config-bg-image-action-button"
                  disabled={!isDefaultEditorPathDirty}
                  onClick={commitDefaultEditorPathDraft}
                >
                  {t("actions.save")}
                </Button>
              </div>
            </div>
          </div>
          <div className="config-toggle-card config-feature-group">
            {/** 未选择图片时禁用开关，避免“开启但无背景图”的无效状态。 */}
            <label className="config-toggle-head">
              <div className="config-toggle-copy">
                <span className="config-toggle-title">
                  {t("config.app.backgroundMedia")}
                </span>
                <span className="config-toggle-desc">
                  {t("config.app.backgroundMediaHint")}
                </span>
              </div>
              <input
                type="checkbox"
                checked={backgroundImageEnabled && !!backgroundImageAsset}
                disabled={!backgroundImageAsset}
                onChange={(event) =>
                  onBackgroundImageEnabledChange?.(event.target.checked)
                }
              />
            </label>
            <div
              className={`config-file-picker-path config-file-picker-path-single-line ${
                backgroundImageAsset ? "" : "empty"
              }`.trim()}
              title={
                backgroundImageAsset ||
                t("config.app.backgroundMediaPlaceholder")
              }
            >
              {backgroundImageAsset ||
                t("config.app.backgroundMediaPlaceholder")}
            </div>
            <label className="config-subsetting">
              <div className="config-toggle-copy">
                <span className="config-toggle-title">
                  {t("config.app.backgroundRenderMode")}
                </span>
              </div>
              <div className="config-select-control">
                <Select
                  value={normalizedBackgroundRenderMode}
                  options={[
                    {
                      value: "cover",
                      label: t("config.app.backgroundRenderMode.cover"),
                    },
                    {
                      value: "contain",
                      label: t("config.app.backgroundRenderMode.contain"),
                    },
                    {
                      value: "tile",
                      label: t("config.app.backgroundRenderMode.tile"),
                    },
                  ]}
                  onChange={(value) =>
                    onBackgroundRenderModeChange?.(
                      value as BackgroundRenderMode,
                    )
                  }
                  aria-label={t("config.app.backgroundRenderMode")}
                />
              </div>
            </label>
            {isBackgroundVideoMode ? (
              <>
                <label className="config-subsetting">
                  <div className="config-toggle-copy">
                    <span className="config-toggle-title">
                      {t("config.app.backgroundVideoReplayMode")}
                    </span>
                  </div>
                  <div className="config-select-control">
                    <Select
                      value={normalizedBackgroundVideoReplayMode}
                      options={[
                        {
                          value: "loop",
                          label: t("config.app.backgroundVideoReplayMode.loop"),
                        },
                        {
                          value: "single",
                          label: t(
                            "config.app.backgroundVideoReplayMode.single",
                          ),
                        },
                        {
                          value: "interval",
                          label: t(
                            "config.app.backgroundVideoReplayMode.interval",
                          ),
                        },
                      ]}
                      onChange={(value) =>
                        onBackgroundVideoReplayModeChange?.(
                          value as BackgroundVideoReplayMode,
                        )
                      }
                      aria-label={t("config.app.backgroundVideoReplayMode")}
                    />
                  </div>
                </label>
                {normalizedBackgroundVideoReplayMode === "interval" ? (
                  <label className="config-subsetting">
                    <div className="config-toggle-copy">
                      <span className="config-toggle-title">
                        {t("config.app.backgroundVideoReplayIntervalSec")}
                      </span>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="config-number-input"
                      value={backgroundVideoReplayIntervalDraft}
                      onChange={(event) =>
                        setBackgroundVideoReplayIntervalDraft(
                          event.target.value,
                        )
                      }
                      onBlur={commitBackgroundVideoReplayIntervalDraft}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        commitBackgroundVideoReplayIntervalDraft();
                      }}
                    />
                  </label>
                ) : null}
              </>
            ) : null}
            <div className="config-file-picker-actions">
              <Button
                variant="primary"
                size="sm"
                className="config-bg-image-action-button"
                onClick={() => {
                  void pickBackgroundMedia();
                }}
              >
                {t("config.app.pickBackgroundMedia")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="config-bg-image-action-button"
                disabled={!backgroundImageAsset}
                onClick={() => {
                  void (async () => {
                    try {
                      const assetToDelete = backgroundImageAsset;
                      if (assetToDelete) {
                        const targetPath =
                          await getBackgroundImageAssetPath(assetToDelete);
                        if (await exists(targetPath)) {
                          await remove(targetPath);
                        }
                      }
                      onBackgroundImageAssetChange?.("");
                      onBackgroundImageEnabledChange?.(false);
                    } catch (error) {
                      pushToast({
                        level: "error",
                        message: getErrorMessage(error),
                      });
                    }
                  })();
                }}
              >
                {t("config.app.deleteBackgroundMedia")}
              </Button>
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
          <label className="config-toggle-card config-range-setting">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.app.backgroundImageSurfaceAlpha")}
              </span>
              <span className="config-toggle-desc">
                {t("config.app.backgroundImageSurfaceAlphaHint")}
              </span>
            </div>
            <span className="config-range-control">
              <input
                type="range"
                min={MIN_BACKGROUND_IMAGE_SURFACE_ALPHA}
                max={MAX_BACKGROUND_IMAGE_SURFACE_ALPHA}
                step={0.01}
                value={clampBackgroundImageSurfaceAlpha(
                  backgroundImageSurfaceAlpha,
                )}
                onChange={(event) =>
                  onBackgroundImageSurfaceAlphaChange?.(
                    clampBackgroundImageSurfaceAlpha(
                      Number(event.currentTarget.value),
                    ),
                  )
                }
                aria-label={t("config.app.backgroundImageSurfaceAlpha")}
              />
              <span className="config-range-value">
                {Math.round(
                  clampBackgroundImageSurfaceAlpha(
                    backgroundImageSurfaceAlpha,
                  ) * 100,
                )}
                %
              </span>
            </span>
          </label>
        </div>
      );
    }
    if (activeSection === "ai-settings") {
      const activeProvider =
        aiProviders.find((provider) => provider.id === aiActiveProviderId) ??
        null;
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.aiSettings")}</h3>
          {renderActiveSectionSaveStatus()}
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.activeProvider")}
              </span>
            </div>
            <div className="config-ai-provider-inline">
              <div className="config-select-control">
                <Select
                  value={aiActiveProviderId}
                  options={[
                    { value: "", label: t("config.ai.providerEmpty") },
                    ...aiProviders.map((provider) => ({
                      value: provider.id,
                      label: provider.name || t("config.ai.providerUnnamed"),
                    })),
                  ]}
                  onChange={(value) => onAiActiveProviderIdChange?.(value)}
                  aria-label={t("config.ai.activeProvider")}
                />
              </div>
              <div className="config-file-picker-actions">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    !activeProvider || testingProviderId === activeProvider.id
                  }
                  onClick={() => {
                    void (async () => {
                      try {
                        if (!activeProvider) return;
                        setTestingProviderId(activeProvider.id);
                        await onAiProviderTest?.(activeProvider.id);
                        pushToast({
                          level: "success",
                          message: t("config.ai.providerTestSuccess"),
                        });
                      } catch (error) {
                        pushToast({
                          level: "error",
                          message: getErrorMessage(error),
                        });
                      } finally {
                        setTestingProviderId("");
                      }
                    })();
                  }}
                >
                  {activeProvider && testingProviderId === activeProvider.id
                    ? t("config.ai.providerTesting")
                    : t("config.ai.providerTest")}
                </Button>
              </div>
            </div>
          </div>
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
          {isDeveloperMode ? (
            <label className="config-toggle-card">
              <div className="config-toggle-copy">
                <span className="config-toggle-title">
                  {t("config.ai.debugLoggingEnabled")}
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
          ) : null}
        </div>
      );
    }
    if (activeSection === "ai-provider-manage") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.aiProviderManage")}</h3>
          {renderActiveSectionSaveStatus()}
          {!aiProviders.length ? (
            <div className="config-empty-state">
              {t("config.ai.manageEmpty")}
            </div>
          ) : (
            renderProviderList(aiProviders, { removable: true })
          )}
        </div>
      );
    }
    if (activeSection === "ai-provider-quick") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.aiProviderQuick")}</h3>
          {renderActiveSectionSaveStatus()}
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.providerName")}
              </span>
            </div>
            <input
              type="text"
              className="config-text-input"
              value={quickPresetNameDraft}
              placeholder={t("config.ai.providerNamePlaceholder")}
              onChange={(event) => setQuickPresetNameDraft(event.target.value)}
            />
          </div>
          <label className="config-toggle-card">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.providerVendor")}
              </span>
            </div>
            <div className="config-select-control">
              <Select
                value={quickPresetVendorDraft}
                options={AI_PROVIDER_PRESETS.map((preset) => ({
                  value: preset.vendor,
                  label: preset.label,
                }))}
                onChange={(value) =>
                  setQuickPresetVendorDraft(value as AiProviderVendor)
                }
                aria-label={t("config.ai.providerVendor")}
              />
            </div>
          </label>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.providerModel")}
              </span>
            </div>
            <input
              type="text"
              className="config-text-input"
              value={quickPresetModelDraft}
              placeholder={t("config.ai.providerModelPlaceholder")}
              onChange={(event) => setQuickPresetModelDraft(event.target.value)}
            />
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.providerApiKey")}
              </span>
            </div>
            <input
              type="password"
              className="config-text-input"
              value={quickPresetApiKeyDraft}
              placeholder={t("config.ai.providerApiKeyPlaceholder")}
              onChange={(event) =>
                setQuickPresetApiKeyDraft(event.target.value)
              }
            />
          </div>
          <div className="config-file-picker-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={quickPresetCreating}
              onClick={() => {
                const nextName = quickPresetNameDraft.trim();
                if (!nextName) {
                  pushToast({
                    level: "error",
                    message: t("config.ai.providerNameRequired"),
                  });
                  return;
                }
                if (isProviderNameDuplicate(nextName)) {
                  pushToast({
                    level: "error",
                    message: t("config.ai.providerNameDuplicate"),
                  });
                  return;
                }
                const nextModel = quickPresetModelDraft.trim();
                if (!nextModel) {
                  pushToast({
                    level: "error",
                    message: t("config.ai.providerModelRequired"),
                  });
                  return;
                }
                setQuickPresetCreating(true);
                Promise.resolve(
                  onAiPresetProviderCreate?.({
                    vendor: quickPresetVendorDraft,
                    name: nextName,
                    model: nextModel,
                    apiKey: quickPresetApiKeyDraft.trim(),
                  }),
                )
                  .then(() => {
                    setQuickPresetNameDraft("");
                    setQuickPresetApiKeyDraft("");
                    setQuickPresetModelDraft(
                      getAiProviderPreset(quickPresetVendorDraft)?.models[0] ??
                        "",
                    );
                  })
                  .catch((error) => {
                    pushToast({
                      level: "error",
                      message: getErrorMessage(error),
                    });
                  })
                  .finally(() => {
                    setQuickPresetCreating(false);
                  });
              }}
            >
              {t("config.ai.confirmAdd")}
            </Button>
          </div>
        </div>
      );
    }
    if (activeSection === "ai-provider-compat") {
      return (
        <div className="config-modal-widget config-modal-widget-scrollable">
          <h3>{t("config.section.aiProviderCompat")}</h3>
          {renderActiveSectionSaveStatus()}
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.providerName")}
              </span>
            </div>
            <input
              type="text"
              className="config-text-input"
              value={compatibleNameDraft}
              placeholder={t("config.openai.namePlaceholder")}
              onChange={(event) => setCompatibleNameDraft(event.target.value)}
            />
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.providerBaseUrl")}
              </span>
            </div>
            <input
              type="text"
              className="config-text-input"
              value={compatibleBaseUrlDraft}
              placeholder={t("config.openai.baseUrlPlaceholder")}
              onChange={(event) =>
                setCompatibleBaseUrlDraft(event.target.value)
              }
            />
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.providerModel")}
              </span>
            </div>
            <input
              type="text"
              className="config-text-input"
              value={compatibleModelDraft}
              placeholder={t("config.openai.modelPlaceholder")}
              onChange={(event) => setCompatibleModelDraft(event.target.value)}
            />
          </div>
          <div className="config-toggle-card config-feature-group">
            <div className="config-toggle-copy">
              <span className="config-toggle-title">
                {t("config.ai.providerApiKey")}
              </span>
            </div>
            <input
              type="password"
              className="config-text-input"
              value={compatibleApiKeyDraft}
              placeholder={t("config.openai.apiKeyPlaceholder")}
              onChange={(event) => setCompatibleApiKeyDraft(event.target.value)}
            />
          </div>
          <div className="config-file-picker-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={compatibleCreating}
              onClick={() => {
                const nextName = compatibleNameDraft.trim();
                if (!nextName) {
                  pushToast({
                    level: "error",
                    message: t("config.ai.providerNameRequired"),
                  });
                  return;
                }
                if (isProviderNameDuplicate(nextName)) {
                  pushToast({
                    level: "error",
                    message: t("config.ai.providerNameDuplicate"),
                  });
                  return;
                }
                const nextBaseUrl = compatibleBaseUrlDraft.trim();
                if (!nextBaseUrl) {
                  pushToast({
                    level: "error",
                    message: t("config.ai.providerBaseUrlRequired"),
                  });
                  return;
                }
                const nextModel = compatibleModelDraft.trim();
                if (!nextModel) {
                  pushToast({
                    level: "error",
                    message: t("config.ai.providerModelRequired"),
                  });
                  return;
                }
                setCompatibleCreating(true);
                Promise.resolve(
                  onAiCompatibleProviderCreate?.({
                    name: nextName,
                    baseUrl: nextBaseUrl,
                    model: nextModel,
                    apiKey: compatibleApiKeyDraft.trim(),
                  }),
                )
                  .then(() => {
                    setCompatibleNameDraft("");
                    setCompatibleBaseUrlDraft("");
                    setCompatibleModelDraft("");
                    setCompatibleApiKeyDraft("");
                  })
                  .catch((error) => {
                    pushToast({
                      level: "error",
                      message: getErrorMessage(error),
                    });
                  })
                  .finally(() => {
                    setCompatibleCreating(false);
                  });
              }}
            >
              {t("config.ai.confirmAdd")}
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
            onClick={() => {
              void (async () => {
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
              })();
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
            onClick={() => {
              void (async () => {
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
              })();
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
