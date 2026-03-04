/**
 * 应用统一错误模型。
 * 职责：将未知异常归一化为可读、可记录、可扩展的标准错误结构。
 */

/** 应用错误来源。 */
export type AppErrorSource = "tauri" | "frontend";

/** 应用标准错误结构。 */
export class AppError extends Error {
  code: string;
  details?: unknown;
  source: AppErrorSource;

  constructor(input: {
    code: string;
    message: string;
    details?: unknown;
    source?: AppErrorSource;
  }) {
    super(input.message);
    this.name = "AppError";
    this.code = input.code;
    this.details = input.details;
    this.source = input.source ?? "frontend";
  }
}

/** 从未知异常中提取可读文本，避免出现 `[object Object]`。 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") {
    const parsedMessage = parseJsonStringMessage(error);
    return parsedMessage ?? error;
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  if (isRecord(error)) {
    const messageCandidate = pickString(
      error.message,
      error.error,
      error.reason,
      error.kind,
      error.type,
      error.detail,
      error.details,
    );
    if (messageCandidate) return messageCandidate;
    const nestedMessage = pickNestedMessage(error.error);
    if (nestedMessage) return nestedMessage;
    const serialized = safeJsonStringify(error);
    if (serialized) return serialized;
  }
  return String(error);
}

/** 将未知异常归一化为应用标准错误结构。 */
export function normalizeToAppError(
  error: unknown,
  defaults: {
    code: string;
    source: AppErrorSource;
    details?: unknown;
  },
): AppError {
  if (error instanceof AppError) return error;
  const message = extractErrorMessage(error);
  if (error instanceof Error) {
    return new AppError({
      code: defaults.code,
      message,
      source: defaults.source,
      details: mergeDetails(defaults.details, {
        name: error.name,
        stack: error.stack,
      }),
    });
  }
  if (isRecord(error)) {
    const code =
      pickString(error.code, error.kind, error.type) ?? defaults.code;
    return new AppError({
      code,
      message,
      source: defaults.source,
      details: mergeDetails(defaults.details, error),
    });
  }
  return new AppError({
    code: defaults.code,
    message,
    source: defaults.source,
    details: defaults.details,
  });
}

function pickNestedMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return pickString(value.message, value.error, value.reason);
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonStringMessage(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!isRecord(parsed)) return null;
    return pickString(
      parsed.message,
      parsed.error,
      parsed.reason,
      parsed.detail,
      parsed.details,
    );
  } catch {
    return null;
  }
}

function mergeDetails(base: unknown, extra: unknown): unknown {
  if (base === undefined) return extra;
  if (isRecord(base) && isRecord(extra)) {
    return {
      ...base,
      raw: extra,
    };
  }
  return {
    context: base,
    raw: extra,
  };
}
