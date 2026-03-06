import type { ProxyRuntime, ProxySpec } from "@/types";
import { callTauri } from "@/shared/tauri/commands";

/** 创建全局代理实例。 */
export function openProxy(spec: ProxySpec, traceId?: string) {
  return callTauri<ProxyRuntime>("proxy_open", { spec, traceId });
}

/** 关闭指定代理实例。 */
export function closeProxy(proxyId: string, traceId?: string) {
  return callTauri("proxy_close", { proxyId, traceId });
}

/** 获取全部代理实例。 */
export function listProxies() {
  return callTauri<ProxyRuntime[]>("proxy_list");
}

/** 关闭全部代理实例。 */
export function closeAllProxies(traceId?: string) {
  return callTauri("proxy_close_all", { traceId });
}
