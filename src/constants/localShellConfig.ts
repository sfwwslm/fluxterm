import type { LocalShellConfig } from "@/types";
import {
  DEFAULT_TERMINAL_BELL_COOLDOWN_MS,
  DEFAULT_TERMINAL_BELL_MODE,
  normalizeTerminalBellCooldownMs,
  normalizeTerminalBellMode,
} from "@/constants/terminalBell";
import {
  DEFAULT_TERMINAL_WORD_SEPARATORS,
  normalizeTerminalWordSeparators,
} from "@/constants/terminalWordSeparators";

/** 已补齐默认值的本地 Shell 配置。 */
export type ResolvedLocalShellConfig = Required<LocalShellConfig>;

/** 本地 Shell 终端配置默认值。 */
export const DEFAULT_LOCAL_SHELL_CONFIG: ResolvedLocalShellConfig = {
  bellMode: DEFAULT_TERMINAL_BELL_MODE,
  bellCooldownMs: DEFAULT_TERMINAL_BELL_COOLDOWN_MS,
  terminalType: "xterm-256color",
  charset: "utf-8",
  wordSeparators: DEFAULT_TERMINAL_WORD_SEPARATORS,
};

/** 归一化本地 Shell 配置，非法值回退到默认值。 */
export function normalizeLocalShellConfig(
  value: Partial<LocalShellConfig> | null | undefined,
): ResolvedLocalShellConfig {
  const terminalType =
    value?.terminalType === "xterm-256color" ||
    value?.terminalType === "xterm" ||
    value?.terminalType === "screen-256color" ||
    value?.terminalType === "tmux-256color" ||
    value?.terminalType === "vt100"
      ? value.terminalType
      : DEFAULT_LOCAL_SHELL_CONFIG.terminalType;
  const charset =
    value?.charset === "utf-8" ||
    value?.charset === "gbk" ||
    value?.charset === "gb18030"
      ? value.charset
      : DEFAULT_LOCAL_SHELL_CONFIG.charset;
  return {
    terminalType,
    charset,
    wordSeparators:
      normalizeTerminalWordSeparators(value?.wordSeparators) ??
      DEFAULT_LOCAL_SHELL_CONFIG.wordSeparators,
    bellMode:
      normalizeTerminalBellMode(value?.bellMode) ??
      DEFAULT_LOCAL_SHELL_CONFIG.bellMode,
    bellCooldownMs:
      normalizeTerminalBellCooldownMs(value?.bellCooldownMs) ??
      DEFAULT_LOCAL_SHELL_CONFIG.bellCooldownMs,
  };
}
