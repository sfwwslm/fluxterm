import type { TerminalBellMode } from "@/types";

/** Bell 模式默认值。 */
export const DEFAULT_TERMINAL_BELL_MODE: TerminalBellMode = "silent";

/** Bell 重复抑制默认值。 */
export const DEFAULT_TERMINAL_BELL_COOLDOWN_MS = 3000;

/** Bell 重复抑制候选。 */
export const TERMINAL_BELL_COOLDOWN_OPTIONS = [0, 1000, 3000, 5000] as const;

/** 归一化 Bell 模式。 */
export function normalizeTerminalBellMode(
  value: string | null | undefined,
): TerminalBellMode | null {
  return value === "silent" || value === "sound" ? value : null;
}

/** 归一化 Bell 重复抑制时间。 */
export function normalizeTerminalBellCooldownMs(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return TERMINAL_BELL_COOLDOWN_OPTIONS.includes(
    value as (typeof TERMINAL_BELL_COOLDOWN_OPTIONS)[number],
  )
    ? value
    : null;
}
