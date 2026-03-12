/**
 * 会话重连策略模块。
 * 职责：按断线原因提供固定退避时间表，避免 reboot / poweroff 场景过早重试。
 */
import type { DisconnectReason } from "@/types";

const reconnectDelayTableMs: Record<DisconnectReason, number[]> = {
  exit: [],
  poweroff: [20_000, 30_000, 45_000, 60_000, 90_000],
  reboot: [10_000, 20_000, 30_000, 45_000, 60_000],
  network: [2_000, 4_000, 8_000],
  unknown: [],
};

/** 返回指定断线原因的重连延迟时间表。 */
export function getReconnectDelayPlanMs(reason: DisconnectReason) {
  return reconnectDelayTableMs[reason] ?? [];
}

/** 返回指定断线原因允许的最大自动重连次数。 */
export function getMaxReconnectAttempts(reason: DisconnectReason) {
  return getReconnectDelayPlanMs(reason).length;
}

/** 根据断线原因和重连次数返回延迟。 */
export function computeReconnectDelayMs(
  reason: DisconnectReason,
  attempt: number,
) {
  const plan = getReconnectDelayPlanMs(reason);
  if (!plan.length || attempt <= 0) return null;
  return plan[Math.min(attempt - 1, plan.length - 1)] ?? null;
}
