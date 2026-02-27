/**
 * Tauri 命令调用基础设施。
 * 职责：统一封装 invoke 调用入口。
 */
import { invoke } from "@tauri-apps/api/core";

/** 统一的 Tauri 命令调用入口。 */
export async function callTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
) {
  return invoke<T>(command, payload ?? {});
}
