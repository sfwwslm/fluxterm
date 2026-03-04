/**
 * Tauri 命令调用基础设施。
 * 职责：统一封装 invoke 调用入口。
 */
import { invoke } from "@tauri-apps/api/core";
import { normalizeToAppError } from "@/shared/errors/appError";

/** 统一的 Tauri 命令调用入口。 */
export async function callTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
) {
  try {
    return await invoke<T>(command, payload ?? {});
  } catch (error) {
    throw normalizeToAppError(error, {
      code: "TAURI_INVOKE_ERROR",
      source: "tauri",
      details: {
        command,
        payloadKeys: Object.keys(payload ?? {}),
      },
    });
  }
}
