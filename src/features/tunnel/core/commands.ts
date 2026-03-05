import type { SshTunnelRuntime, SshTunnelSpec } from "@/types";
import { callTauri } from "@/shared/tauri/commands";

/** 创建 SSH 隧道。 */
export function openSshTunnel(sessionId: string, spec: SshTunnelSpec) {
  return callTauri<SshTunnelRuntime>("ssh_tunnel_open", { sessionId, spec });
}

/** 关闭 SSH 隧道。 */
export function closeSshTunnel(sessionId: string, tunnelId: string) {
  return callTauri("ssh_tunnel_close", { sessionId, tunnelId });
}

/** 列出会话下 SSH 隧道。 */
export function listSshTunnels(sessionId: string) {
  return callTauri<SshTunnelRuntime[]>("ssh_tunnel_list", { sessionId });
}

/** 关闭会话下全部 SSH 隧道。 */
export function closeAllSshTunnels(sessionId: string) {
  return callTauri("ssh_tunnel_close_all", { sessionId });
}
