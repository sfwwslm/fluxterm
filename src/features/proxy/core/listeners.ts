import type { ProxyRuntime } from "@/types";
import { subscribeTauri } from "@/shared/tauri/events";

/** 注册代理运行时事件监听。 */
export async function registerProxyListeners(
  onUpdate: (payload: ProxyRuntime) => void,
) {
  const unlisten = await subscribeTauri<ProxyRuntime>("proxy:update", (event) =>
    onUpdate(event.payload),
  );
  return () => {
    unlisten();
  };
}
