/**
 * 会话重连策略模块。
 * 职责：提供重连次数与指数退避延迟计算规则。
 */
export const maxReconnectAttempts = 6;
export const baseReconnectDelayMs = 2000;
export const maxReconnectDelayMs = 30000;

/** 根据重连次数计算指数退避延迟。 */
export function computeReconnectDelayMs(attempt: number) {
  return Math.min(
    maxReconnectDelayMs,
    baseReconnectDelayMs * 2 ** (attempt - 1),
  );
}
