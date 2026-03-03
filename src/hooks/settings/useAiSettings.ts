/**
 * 终端 AI 配置持久化模块。
 * 职责：读写 ai/ai.json，并管理终端 AI 助手与多个 OpenAI 标准接入配置。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { info, warn } from "@tauri-apps/plugin-log";
import {
  aiOpenAiTest,
  aiSettingsGet,
  aiSettingsSave,
} from "@/features/ai/core/commands";
import type {
  AiSettingsSaveInput,
  AiSettingsView,
  OpenAiConfigInput,
  OpenAiConfigView,
  SecretFieldUpdate,
} from "@/features/ai/types";

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
  updateActiveOpenaiConfigName: (value: string) => void;
  updateActiveOpenaiConfigBaseUrl: (value: string) => void;
  updateActiveOpenaiConfigModel: (value: string) => void;
  addOpenaiConfig: () => void;
  removeActiveOpenaiConfig: () => void;
  testOpenAiConnection: () => Promise<void>;
  replaceOpenaiApiKey: (value: string) => Promise<void>;
  clearOpenaiApiKey: () => Promise<void>;
};

const MIN_AI_TEXT_LIMIT = 100;
const MAX_AI_TEXT_LIMIT = 20_000;
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

function normalizeTextLimit(value: number) {
  return Math.max(
    MIN_AI_TEXT_LIMIT,
    Math.min(MAX_AI_TEXT_LIMIT, Math.round(value)),
  );
}

function computeAiAvailability(config: OpenAiConfigView | null) {
  if (!config?.baseUrl.trim() || !config.model.trim()) {
    return {
      aiAvailable: false,
      aiUnavailableReason: "openai_incomplete",
    };
  }
  return { aiAvailable: true, aiUnavailableReason: null };
}

function createOpenAiConfigName(configs: OpenAiConfigView[]) {
  return `OpenAI ${configs.length + 1}`;
}

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

/** 终端域 AI 配置持久化：统一读写 ai.json 并向设置页暴露可调整能力。 */
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
  const loadedRef = useRef(false);
  const savingSecretRef = useRef(false);
  const latestSaveRequestIdRef = useRef(0);
  const lastLoadedRef = useRef<AiSettingsView>(DEFAULT_AI_SETTINGS);
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

  useEffect(() => {
    let active = true;
    aiSettingsGet()
      .then((settings) => {
        if (!active) return;
        lastLoadedRef.current = settings;
        setSelectionMaxChars(settings.selectionMaxChars);
        setSessionRecentOutputMaxChars(settings.sessionRecentOutputMaxChars);
        setDebugLoggingEnabled(settings.debugLoggingEnabled);
        setActiveOpenaiConfigId(settings.activeOpenaiConfigId);
        setOpenaiConfigs(settings.openaiConfigs);
      })
      .catch((error) => {
        if (!active) return;
        warn(
          JSON.stringify({
            event: "ai-settings:load-failed",
            error: error instanceof Error ? error.message : String(error),
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

  useEffect(() => {
    if (!loadedRef.current || savingSecretRef.current) return;
    // 设置页字段采用自动保存，旧请求返回时不应覆盖用户刚刚编辑的新状态。
    const requestId = latestSaveRequestIdRef.current + 1;
    latestSaveRequestIdRef.current = requestId;
    aiSettingsSave(
      buildSaveInput(
        {
          selectionMaxChars,
          sessionRecentOutputMaxChars,
          debugLoggingEnabled,
          activeOpenaiConfigId,
          openaiConfigs,
        },
        lastLoadedRef.current,
      ),
    )
      .then((saved) => {
        if (requestId !== latestSaveRequestIdRef.current) return;
        lastLoadedRef.current = saved;
        setOpenaiConfigs(saved.openaiConfigs);
        setActiveOpenaiConfigId(saved.activeOpenaiConfigId);
      })
      .catch((error) => {
        warn(
          JSON.stringify({
            event: "ai-settings:save-failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        ).catch(() => {});
      });
  }, [
    selectionMaxChars,
    sessionRecentOutputMaxChars,
    debugLoggingEnabled,
    activeOpenaiConfigId,
    openaiConfigs,
  ]);

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

  function updateActiveOpenaiConfig(
    updater: (config: OpenAiConfigView) => OpenAiConfigView,
  ) {
    setOpenaiConfigs((current) =>
      current.map((config) =>
        config.id === activeOpenaiConfigId ? updater(config) : config,
      ),
    );
  }

  async function saveWithSecretUpdate(
    overrides: Record<string, SecretFieldUpdate>,
  ) {
    // API Key 保存走独立命令链路，避免自动保存把 keep/replace/clear 意图混在一起。
    savingSecretRef.current = true;
    try {
      const requestId = latestSaveRequestIdRef.current + 1;
      latestSaveRequestIdRef.current = requestId;
      const saved = await aiSettingsSave(
        buildSaveInput(
          {
            selectionMaxChars,
            sessionRecentOutputMaxChars,
            debugLoggingEnabled,
            activeOpenaiConfigId,
            openaiConfigs,
          },
          lastLoadedRef.current,
          overrides,
        ),
      );
      if (requestId !== latestSaveRequestIdRef.current) return;
      lastLoadedRef.current = saved;
      setOpenaiConfigs(saved.openaiConfigs);
      setActiveOpenaiConfigId(saved.activeOpenaiConfigId);
    } finally {
      savingSecretRef.current = false;
    }
  }

  function addOpenaiConfig() {
    const nextConfig: OpenAiConfigView = {
      id: crypto.randomUUID(),
      name: createOpenAiConfigName(openaiConfigs),
      baseUrl: "",
      model: "",
      apiKeyConfigured: false,
    };
    setOpenaiConfigs((current) => [...current, nextConfig]);
    setActiveOpenaiConfigId(nextConfig.id);
    info(
      JSON.stringify({
        event: "ai-settings:openai-config-added",
        id: nextConfig.id,
      }),
    ).catch(() => {});
  }

  function removeActiveOpenaiConfig() {
    if (!activeOpenaiConfigId) return;
    setOpenaiConfigs((current) => {
      const nextConfigs = current.filter(
        (config) => config.id !== activeOpenaiConfigId,
      );
      setActiveOpenaiConfigId(nextConfigs[0]?.id ?? "");
      return nextConfigs;
    });
    info(
      JSON.stringify({
        event: "ai-settings:openai-config-removed",
        id: activeOpenaiConfigId,
      }),
    ).catch(() => {});
  }

  async function replaceOpenaiApiKey(value: string) {
    const trimmed = value.trim();
    if (!trimmed || !activeOpenaiConfigId) return;
    await saveWithSecretUpdate({
      [activeOpenaiConfigId]: { mode: "replace", value: trimmed },
    });
    info(
      JSON.stringify({
        event: "ai-settings:openai-api-key-replaced",
        id: activeOpenaiConfigId,
      }),
    ).catch(() => {});
  }

  async function clearOpenaiApiKey() {
    if (!activeOpenaiConfigId) return;
    await saveWithSecretUpdate({
      [activeOpenaiConfigId]: { mode: "clear" },
    });
    info(
      JSON.stringify({
        event: "ai-settings:openai-api-key-cleared",
        id: activeOpenaiConfigId,
      }),
    ).catch(() => {});
  }

  async function testOpenAiConnection() {
    await aiOpenAiTest();
    info(
      JSON.stringify({
        event: "ai-settings:openai-connection-tested",
        id: activeOpenaiConfigId,
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
    updateActiveOpenaiConfigName: (value) => {
      updateActiveOpenaiConfig((config) => ({ ...config, name: value }));
    },
    updateActiveOpenaiConfigBaseUrl: (value) => {
      updateActiveOpenaiConfig((config) => ({ ...config, baseUrl: value }));
    },
    updateActiveOpenaiConfigModel: (value) => {
      updateActiveOpenaiConfig((config) => ({ ...config, model: value }));
    },
    addOpenaiConfig,
    removeActiveOpenaiConfig,
    testOpenAiConnection,
    replaceOpenaiApiKey,
    clearOpenaiApiKey,
  };
}
