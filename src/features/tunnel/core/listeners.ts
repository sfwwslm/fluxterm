import type { SshTunnelRuntime } from "@/types";
import { subscribeTauri } from "@/shared/tauri/events";

/** 注册 SSH 隧道事件监听。 */
export async function registerTunnelListeners(
  onTunnelUpdate: (payload: SshTunnelRuntime) => void,
) {
  const unlisten = await subscribeTauri<SshTunnelRuntime>(
    "ssh:tunnel:update",
    (event) => onTunnelUpdate(event.payload),
  );
  return () => {
    unlisten();
  };
}
