/**
 * 终端词边界分隔符预设。
 * 职责：
 * 1. 提供 xterm `wordSeparator` 的默认值。
 * 2. 提供 Profile Window 子菜单可选的 A/B 预设。
 */
export const TERMINAL_WORD_SEPARATORS_PRESET_A =
  "./\\()\"'-:,.;<>~!@#$%^&*|+=[]{}`~ ?";

export const TERMINAL_WORD_SEPARATORS_PRESET_B = "`!@#$^*()=[{]}|;:'\" ,<>?";

export const DEFAULT_TERMINAL_WORD_SEPARATORS =
  TERMINAL_WORD_SEPARATORS_PRESET_A;

/** 统一规范化分词器输入：空值返回 null，非空值去除首尾空白。 */
export function normalizeTerminalWordSeparators(
  value: string | null | undefined,
) {
  const raw = value ?? "";
  // 仅在“全空白”时回退为空；否则保留原样，避免把有效的空格分隔符 trim 掉。
  return raw.trim() ? raw : null;
}
