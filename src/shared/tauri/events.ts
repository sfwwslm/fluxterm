/**
 * Tauri 事件订阅基础设施。
 * 职责：统一封装 listen 订阅入口。
 */
import {
  listen,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event";

/** 统一的 Tauri 事件订阅入口。 */
export async function subscribeTauri<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}
