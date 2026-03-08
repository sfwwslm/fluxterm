/**
 * Tauri 命令调用基础设施。
 * 职责：统一封装 invoke 调用入口。
 */
import { invoke } from "@tauri-apps/api/core";
import { normalizeToAppError } from "@/shared/errors/appError";

/** 系统信息结构。 */
export type SystemInfo = {
  osName: string;
  osVersion: string;
  kernelVersion: string;
  arch: string;
};

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

/** 读取后端系统信息。 */
export function getSystemInfo() {
  return callTauri<SystemInfo>("get_system_info");
}
