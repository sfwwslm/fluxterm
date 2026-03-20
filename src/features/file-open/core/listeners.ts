/**
 * 远端编辑事件监听模块。
 * 职责：统一注册并转发 remote-edit:update 事件。
 */
import type { RemoteEditSnapshot } from "@/types";
import { subscribeTauri } from "@/shared/tauri/events";

/** 注册远端编辑实例更新事件监听。 */
export async function registerRemoteEditListener(
  onUpdate: (payload: RemoteEditSnapshot) => void,
) {
  return subscribeTauri<RemoteEditSnapshot>("remote-edit:update", (event) => {
    onUpdate(event.payload);
  });
}
