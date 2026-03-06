import {
  debug as logDebug,
  error as logError,
  info as logInfo,
  warn as logWarn,
} from "@tauri-apps/plugin-log";

export type TelemetryLevel = "debug" | "info" | "warn" | "error";

type TelemetryPayload = {
  event: string;
  level: TelemetryLevel;
  traceId: string | null;
} & Record<string, unknown>;

/** 生成 traceId。 */
export function createTraceId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 输出统一结构化埋点。 */
export async function logTelemetry(
  level: TelemetryLevel,
  event: string,
  fields?: Record<string, unknown>,
) {
  const payload: TelemetryPayload = {
    event,
    ts: Date.now(),
    source: "frontend",
    level,
    traceId:
      typeof fields?.traceId === "string" ? (fields.traceId as string) : null,
    ...(fields ?? {}),
  };
  const line = JSON.stringify(payload);
  if (level === "debug") return logDebug(line);
  if (level === "warn") return logWarn(line);
  if (level === "error") return logError(line);
  return logInfo(line);
}
