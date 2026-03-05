/**
 * 终端 AI 配置持久化模块。
 * 职责：
 * 1. 读写 ai/ai.json 配置文件。
 * 2. 管理终端 AI 助手偏好与多个 OpenAI 标准接入配置。
 * 3. 采用“内存态缓存 + 防抖异步落盘”模式，打破因后端返回新对象引用导致的死循环。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { debug, info, warn } from "@tauri-apps/plugin-log";
import {
  aiOpenAiTest,
  aiSettingsGet,
  aiSettingsSave,
} from "@/features/ai/core/commands";
import { extractErrorMessage } from "@/shared/errors/appError";
import type {
  AiSettingsSaveInput,
  AiSettingsView,
  OpenAiConfigInput,
  OpenAiConfigView,
  SecretFieldUpdate,
} from "@/features/ai/types";
import { PERSISTENCE_SAVE_DEBOUNCE_MS } from "@/constants/persistence";

/** useAiSettings 返回的操作接口。 */
type UseAiSettingsResult = {
  aiAvailable: boolean;
  aiUnavailableReason: string | null;
  selectionMaxChars: number;
  sessionRecentOutputMaxChars: number;
  debugLoggingEnabled: boolean;
  activeOpenaiConfigId: string;
  openaiConfigs: OpenAiConfigView[];
  activeOpenaiConfig: OpenAiConfigView | null;
  aiSettingsLoaded: boolean;
  setSelectionMaxChars: React.Dispatch<React.SetStateAction<number>>;
  setSessionRecentOutputMaxChars: React.Dispatch<React.SetStateAction<number>>;
  setDebugLoggingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveOpenaiConfigId: React.Dispatch<React.SetStateAction<string>>;
  updateOpenaiConfigName: (configId: string, value: string) => void;
  updateOpenaiConfigBaseUrl: (configId: string, value: string) => void;
  updateOpenaiConfigModel: (configId: string, value: string) => void;
  addOpenaiConfig: () => string;
  removeOpenaiConfig: (configId: string) => void;
  testOpenAiConnection: (configId?: string) => Promise<void>;
  replaceOpenaiApiKey: (configId: string, value: string) => Promise<void>;
  clearOpenaiApiKey: (configId: string) => Promise<void>;
};

/** AI 文本上下文阈值限制。 */
const MIN_AI_TEXT_LIMIT = 100;
const MAX_AI_TEXT_LIMIT = 20_000;

/** AI 设置默认值。 */
const DEFAULT_AI_SETTINGS: AiSettingsView = {
  version: 1,
  selectionMaxChars: 1500,
  sessionRecentOutputMaxChars: 1200,
  sessionRecentOutputMaxSnippets: 4,
  selectionRecentOutputMaxChars: 600,
  selectionRecentOutputMaxSnippets: 2,
  requestCacheTtlMs: 15000,
  debugLoggingEnabled: true,
  activeOpenaiConfigId: "",
  openaiConfigs: [],
};

/** 归一化 AI 上下文长度。 */
function normalizeTextLimit(value: number) {
  return Math.max(
    MIN_AI_TEXT_LIMIT,
    Math.min(MAX_AI_TEXT_LIMIT, Math.round(value)),
  );
}

/** 计算 AI 功能是否就绪。 */
function computeAiAvailability(config: OpenAiConfigView | null) {
  if (!config?.baseUrl.trim() || !config.model.trim()) {
    return {
      aiAvailable: false,
      aiUnavailableReason: "openai_incomplete",
    };
  }
  return { aiAvailable: true, aiUnavailableReason: null };
}

/** 生成新的 OpenAI 配置名称。 */
function createOpenAiConfigName(configs: OpenAiConfigView[]) {
  return `OpenAI ${configs.length + 1}`;
}

/** 构建向后端提交的保存负载。 */
function buildSaveInput(
  source: {
    selectionMaxChars: number;
    sessionRecentOutputMaxChars: number;
    debugLoggingEnabled: boolean;
    activeOpenaiConfigId: string;
    openaiConfigs: OpenAiConfigView[];
  },
  lastLoaded: AiSettingsView,
  overrides: Record<string, SecretFieldUpdate> = {},
): AiSettingsSaveInput {
  return {
    selectionMaxChars: normalizeTextLimit(source.selectionMaxChars),
    sessionRecentOutputMaxChars: normalizeTextLimit(
      source.sessionRecentOutputMaxChars,
    ),
    sessionRecentOutputMaxSnippets: lastLoaded.sessionRecentOutputMaxSnippets,
    selectionRecentOutputMaxChars: lastLoaded.selectionRecentOutputMaxChars,
    selectionRecentOutputMaxSnippets:
      lastLoaded.selectionRecentOutputMaxSnippets,
    requestCacheTtlMs: lastLoaded.requestCacheTtlMs,
    debugLoggingEnabled: source.debugLoggingEnabled,
    activeOpenaiConfigId: source.activeOpenaiConfigId,
    openaiConfigs: source.openaiConfigs.map<OpenAiConfigInput>((config) => ({
      id: config.id,
      name: config.name.trim(),
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      apiKey: overrides[config.id] ?? { mode: "keep" },
    })),
  };
}

/**
 * 终端 AI 配置持久化 Hook。
 */
export default function useAiSettings(): UseAiSettingsResult {
  const [selectionMaxChars, setSelectionMaxChars] = useState(
    DEFAULT_AI_SETTINGS.selectionMaxChars,
  );
  const [sessionRecentOutputMaxChars, setSessionRecentOutputMaxChars] =
    useState(DEFAULT_AI_SETTINGS.sessionRecentOutputMaxChars);
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(
    DEFAULT_AI_SETTINGS.debugLoggingEnabled,
  );
  const [activeOpenaiConfigId, setActiveOpenaiConfigId] = useState(
    DEFAULT_AI_SETTINGS.activeOpenaiConfigId,
  );
  const [openaiConfigs, setOpenaiConfigs] = useState<OpenAiConfigView[]>(
    DEFAULT_AI_SETTINGS.openaiConfigs,
  );
  const [aiSettingsLoaded, setAiSettingsLoaded] = useState(false);

  // 持久化与状态追踪。
  const loadedRef = useRef(false);
  const savingSecretRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedConfigRef = useRef<string>("");
  const lastLoadedViewRef = useRef<AiSettingsView>(DEFAULT_AI_SETTINGS);
  const lastLoggedActiveConfigIdRef = useRef("");

  const activeOpenaiConfig = useMemo(
    () =>
      openaiConfigs.find((config) => config.id === activeOpenaiConfigId) ??
      null,
    [activeOpenaiConfigId, openaiConfigs],
  );
  const availability = useMemo(
    () => computeAiAvailability(activeOpenaiConfig),
    [activeOpenaiConfig],
  );

  // 初始化加载。
  useEffect(() => {
    let active = true;
    aiSettingsGet()
      .then((settings) => {
        if (!active) return;
        lastLoadedViewRef.current = settings;
        setSelectionMaxChars(settings.selectionMaxChars);
        setSessionRecentOutputMaxChars(settings.sessionRecentOutputMaxChars);
        setDebugLoggingEnabled(settings.debugLoggingEnabled);
        setActiveOpenaiConfigId(settings.activeOpenaiConfigId);
        setOpenaiConfigs(settings.openaiConfigs);
        lastSavedConfigRef.current = JSON.stringify(
          buildSaveInput(
            {
              selectionMaxChars: settings.selectionMaxChars,
              sessionRecentOutputMaxChars: settings.sessionRecentOutputMaxChars,
              debugLoggingEnabled: settings.debugLoggingEnabled,
              activeOpenaiConfigId: settings.activeOpenaiConfigId,
              openaiConfigs: settings.openaiConfigs,
            },
            settings,
          ),
        );
        debug(
          JSON.stringify({ event: "ai-settings:loaded", payload: settings }),
        );
      })
      .catch((error) => {
        if (!active) return;
        warn(
          JSON.stringify({
            event: "ai-settings:load-failed",
            error: extractErrorMessage(error),
          }),
        ).catch(() => {});
      })
      .finally(() => {
        if (!active) return;
        loadedRef.current = true;
        setAiSettingsLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // 防抖异步保存逻辑。
  useEffect(() => {
    if (!loadedRef.current || savingSecretRef.current) return;

    const nextSaveInput = buildSaveInput(
      {
        selectionMaxChars,
        sessionRecentOutputMaxChars,
        debugLoggingEnabled,
        activeOpenaiConfigId,
        openaiConfigs,
      },
      lastLoadedViewRef.current,
    );

    const configStr = JSON.stringify(nextSaveInput);
    // 深度对比打破保存循环。
    if (configStr === lastSavedConfigRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    debug(
      JSON.stringify({
        event: "ai-settings:save-scheduled",
        debounce: PERSISTENCE_SAVE_DEBOUNCE_MS,
      }),
    );

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const saved = await aiSettingsSave(nextSaveInput);
        lastLoadedViewRef.current = saved;
        lastSavedConfigRef.current = configStr;
        debug(JSON.stringify({ event: "ai-settings:persisted" }));
      } catch (error) {
        warn(
          JSON.stringify({
            event: "ai-settings:save-failed",
            error: extractErrorMessage(error),
          }),
        ).catch(() => {});
      }
    }, PERSISTENCE_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [
    selectionMaxChars,
    sessionRecentOutputMaxChars,
    debugLoggingEnabled,
    activeOpenaiConfigId,
    openaiConfigs,
  ]);

  // 日志记录。
  useEffect(() => {
    if (!loadedRef.current) return;
    info(
      JSON.stringify({
        event: "ai-settings:selection-max-chars-changed",
        value: normalizeTextLimit(selectionMaxChars),
      }),
    ).catch(() => {});
  }, [selectionMaxChars]);

  useEffect(() => {
    if (!loadedRef.current) return;
    info(
      JSON.stringify({
        event: "ai-settings:session-context-max-chars-changed",
        value: normalizeTextLimit(sessionRecentOutputMaxChars),
      }),
    ).catch(() => {});
  }, [sessionRecentOutputMaxChars]);

  useEffect(() => {
    if (!loadedRef.current) return;
    info(
      JSON.stringify({
        event: "ai-settings:debug-logging-changed",
        enabled: debugLoggingEnabled,
      }),
    ).catch(() => {});
  }, [debugLoggingEnabled]);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (lastLoggedActiveConfigIdRef.current === activeOpenaiConfigId) return;
    lastLoggedActiveConfigIdRef.current = activeOpenaiConfigId;
    info(
      JSON.stringify({
        event: "ai-settings:active-openai-config-changed",
        id: activeOpenaiConfigId,
      }),
    ).catch(() => {});
  }, [activeOpenaiConfigId]);

  /** 更新指定 OpenAI 配置项。 */
  function updateOpenaiConfig(
    configId: string,
    updater: (config: OpenAiConfigView) => OpenAiConfigView,
  ) {
    setOpenaiConfigs((current) =>
      current.map((config) =>
        config.id === configId ? updater(config) : config,
      ),
    );
  }

  /** 手动触发一次包含密钥更新的强制保存。 */
  async function saveWithSecretUpdate(
    overrides: Record<string, SecretFieldUpdate>,
  ) {
    savingSecretRef.current = true;
    try {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);

      const nextSaveInput = buildSaveInput(
        {
          selectionMaxChars,
          sessionRecentOutputMaxChars,
          debugLoggingEnabled,
          activeOpenaiConfigId,
          openaiConfigs,
        },
        lastLoadedViewRef.current,
        overrides,
      );

      debug(
        JSON.stringify({
          event: "ai-settings:forced-save-start",
          overrides: Object.keys(overrides),
        }),
      );
      const saved = await aiSettingsSave(nextSaveInput);
      lastLoadedViewRef.current = saved;
      lastSavedConfigRef.current = JSON.stringify(nextSaveInput);
      setOpenaiConfigs(saved.openaiConfigs);
      setActiveOpenaiConfigId(saved.activeOpenaiConfigId);
      debug(JSON.stringify({ event: "ai-settings:forced-save-ok" }));
    } finally {
      savingSecretRef.current = false;
    }
  }

  /** 新增 OpenAI 配置。 */
  function addOpenaiConfig() {
    const nextConfig: OpenAiConfigView = {
      id: crypto.randomUUID(),
      name: createOpenAiConfigName(openaiConfigs),
      baseUrl: "",
      model: "",
      apiKeyConfigured: false,
    };
    setOpenaiConfigs((current) => [...current, nextConfig]);
    setActiveOpenaiConfigId((current) => current || nextConfig.id);
    info(
      JSON.stringify({
        event: "ai-settings:openai-config-added",
        id: nextConfig.id,
      }),
    ).catch(() => {});
    return nextConfig.id;
  }

  /** 删除 OpenAI 配置。 */
  function removeOpenaiConfig(configId: string) {
    const targetId = configId.trim();
    if (!targetId) return;
    setOpenaiConfigs((current) => {
      const nextConfigs = current.filter((config) => config.id !== targetId);
      setActiveOpenaiConfigId((currentActiveId) =>
        currentActiveId === targetId
          ? (nextConfigs[0]?.id ?? "")
          : currentActiveId,
      );
      return nextConfigs;
    });
    info(
      JSON.stringify({
        event: "ai-settings:openai-config-removed",
        id: targetId,
      }),
    ).catch(() => {});
  }

  /** 替换 API Key。 */
  async function replaceOpenaiApiKey(configId: string, value: string) {
    const trimmed = value.trim();
    const targetId = configId.trim();
    if (!trimmed || !targetId) return;
    await saveWithSecretUpdate({
      [targetId]: { mode: "replace", value: trimmed },
    });
    info(
      JSON.stringify({
        event: "ai-settings:openai-api-key-replaced",
        id: targetId,
      }),
    ).catch(() => {});
  }

  /** 清空 API Key。 */
  async function clearOpenaiApiKey(configId: string) {
    const targetId = configId.trim();
    if (!targetId) return;
    await saveWithSecretUpdate({ [targetId]: { mode: "clear" } });
    info(
      JSON.stringify({
        event: "ai-settings:openai-api-key-cleared",
        id: targetId,
      }),
    ).catch(() => {});
  }

  /** 测试连接。 */
  async function testOpenAiConnection(configId?: string) {
    const targetId = configId?.trim();
    await aiOpenAiTest(targetId || undefined);
    info(
      JSON.stringify({
        event: "ai-settings:openai-connection-tested",
        id: targetId ?? activeOpenaiConfigId,
      }),
    ).catch(() => {});
  }

  return {
    aiAvailable: availability.aiAvailable,
    aiUnavailableReason: availability.aiUnavailableReason,
    selectionMaxChars: normalizeTextLimit(selectionMaxChars),
    sessionRecentOutputMaxChars: normalizeTextLimit(
      sessionRecentOutputMaxChars,
    ),
    debugLoggingEnabled,
    activeOpenaiConfigId,
    openaiConfigs,
    activeOpenaiConfig,
    aiSettingsLoaded,
    setSelectionMaxChars,
    setSessionRecentOutputMaxChars,
    setDebugLoggingEnabled,
    setActiveOpenaiConfigId,
    updateOpenaiConfigName: (configId, value) => {
      updateOpenaiConfig(configId, (config) => ({ ...config, name: value }));
    },
    updateOpenaiConfigBaseUrl: (configId, value) => {
      updateOpenaiConfig(configId, (config) => ({ ...config, baseUrl: value }));
    },
    updateOpenaiConfigModel: (configId, value) => {
      updateOpenaiConfig(configId, (config) => ({ ...config, model: value }));
    },
    addOpenaiConfig,
    removeOpenaiConfig,
    testOpenAiConnection,
    replaceOpenaiApiKey,
    clearOpenaiApiKey,
  };
}
