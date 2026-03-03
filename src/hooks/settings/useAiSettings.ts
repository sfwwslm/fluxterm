/**
 * 终端 AI 配置持久化模块。
 * 职责：读写 terminal/ai.json，并管理终端 AI 助手对用户开放的可调参数。
 */
import { useEffect, useRef, useState } from "react";
import { info, warn } from "@tauri-apps/plugin-log";
import { aiSettingsGet, aiSettingsSave } from "@/features/ai/core/commands";
import type { AiSettings } from "@/features/ai/types";

type UseAiSettingsResult = {
  selectionMaxChars: number;
  sessionRecentOutputMaxChars: number;
  debugLoggingEnabled: boolean;
  defaultModel: string;
  aiSettingsLoaded: boolean;
  setSelectionMaxChars: React.Dispatch<React.SetStateAction<number>>;
  setSessionRecentOutputMaxChars: React.Dispatch<React.SetStateAction<number>>;
  setDebugLoggingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setDefaultModel: React.Dispatch<React.SetStateAction<string>>;
};

const MIN_AI_TEXT_LIMIT = 100;
const MAX_AI_TEXT_LIMIT = 20_000;
const DEFAULT_AI_SETTINGS: AiSettings = {
  version: 1,
  selectionMaxChars: 1500,
  sessionRecentOutputMaxChars: 1200,
  sessionRecentOutputMaxSnippets: 4,
  selectionRecentOutputMaxChars: 600,
  selectionRecentOutputMaxSnippets: 2,
  requestCacheTtlMs: 15000,
  debugLoggingEnabled: true,
  defaultModel: "gpt-4.1-mini",
};

function normalizeTextLimit(value: number) {
  return Math.max(
    MIN_AI_TEXT_LIMIT,
    Math.min(MAX_AI_TEXT_LIMIT, Math.round(value)),
  );
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
  const [defaultModel, setDefaultModel] = useState(
    DEFAULT_AI_SETTINGS.defaultModel,
  );
  const [aiSettingsLoaded, setAiSettingsLoaded] = useState(false);
  const loadedRef = useRef(false);
  const loggedStateRef = useRef({
    selectionMaxChars: DEFAULT_AI_SETTINGS.selectionMaxChars,
    sessionRecentOutputMaxChars:
      DEFAULT_AI_SETTINGS.sessionRecentOutputMaxChars,
    debugLoggingEnabled: DEFAULT_AI_SETTINGS.debugLoggingEnabled,
    defaultModel: DEFAULT_AI_SETTINGS.defaultModel,
  });
  const preservedSettingsRef = useRef<AiSettings>(DEFAULT_AI_SETTINGS);

  useEffect(() => {
    let active = true;
    aiSettingsGet()
      .then((settings) => {
        if (!active) return;
        preservedSettingsRef.current = settings;
        setSelectionMaxChars(settings.selectionMaxChars);
        setSessionRecentOutputMaxChars(settings.sessionRecentOutputMaxChars);
        setDebugLoggingEnabled(settings.debugLoggingEnabled);
        setDefaultModel(settings.defaultModel);
        loggedStateRef.current = {
          selectionMaxChars: settings.selectionMaxChars,
          sessionRecentOutputMaxChars: settings.sessionRecentOutputMaxChars,
          debugLoggingEnabled: settings.debugLoggingEnabled,
          defaultModel: settings.defaultModel,
        };
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
    if (!loadedRef.current) return;
    const base = preservedSettingsRef.current;
    const nextSettings: AiSettings = {
      ...base,
      version: 1,
      selectionMaxChars: normalizeTextLimit(selectionMaxChars),
      sessionRecentOutputMaxChars: normalizeTextLimit(
        sessionRecentOutputMaxChars,
      ),
      debugLoggingEnabled,
      defaultModel: defaultModel.trim() || DEFAULT_AI_SETTINGS.defaultModel,
    };
    aiSettingsSave(nextSettings)
      .then((saved) => {
        preservedSettingsRef.current = saved;
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
    defaultModel,
  ]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const normalized = normalizeTextLimit(selectionMaxChars);
    if (loggedStateRef.current.selectionMaxChars === normalized) return;
    info(
      JSON.stringify({
        event: "ai-settings:selection-max-chars-changed",
        value: normalized,
      }),
    ).catch(() => {});
    loggedStateRef.current.selectionMaxChars = normalized;
  }, [selectionMaxChars]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const normalized = normalizeTextLimit(sessionRecentOutputMaxChars);
    if (loggedStateRef.current.sessionRecentOutputMaxChars === normalized)
      return;
    info(
      JSON.stringify({
        event: "ai-settings:session-context-max-chars-changed",
        value: normalized,
      }),
    ).catch(() => {});
    loggedStateRef.current.sessionRecentOutputMaxChars = normalized;
  }, [sessionRecentOutputMaxChars]);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (loggedStateRef.current.debugLoggingEnabled === debugLoggingEnabled)
      return;
    info(
      JSON.stringify({
        event: "ai-settings:debug-logging-changed",
        enabled: debugLoggingEnabled,
      }),
    ).catch(() => {});
    loggedStateRef.current.debugLoggingEnabled = debugLoggingEnabled;
  }, [debugLoggingEnabled]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const normalized = defaultModel.trim() || DEFAULT_AI_SETTINGS.defaultModel;
    if (loggedStateRef.current.defaultModel === normalized) return;
    info(
      JSON.stringify({
        event: "ai-settings:default-model-changed",
        model: normalized,
      }),
    ).catch(() => {});
    loggedStateRef.current.defaultModel = normalized;
  }, [defaultModel]);

  return {
    selectionMaxChars: normalizeTextLimit(selectionMaxChars),
    sessionRecentOutputMaxChars: normalizeTextLimit(
      sessionRecentOutputMaxChars,
    ),
    debugLoggingEnabled,
    defaultModel,
    aiSettingsLoaded,
    setSelectionMaxChars,
    setSessionRecentOutputMaxChars,
    setDebugLoggingEnabled,
    setDefaultModel,
  };
}
