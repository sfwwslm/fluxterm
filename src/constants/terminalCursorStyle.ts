/**
 * 终端光标样式常量。
 * 职责：
 * 1. 提供 xterm `cursorStyle` 的受支持取值。
 * 2. 提供默认值与配置归一化函数。
 */

/** xterm 光标样式。 */
export type TerminalCursorStyle = "block" | "bar" | "underline";

/** 默认光标样式：竖线。 */
export const DEFAULT_TERMINAL_CURSOR_STYLE: TerminalCursorStyle = "bar";

/** 归一化光标样式配置。 */
export function normalizeTerminalCursorStyle(
  value: unknown,
): TerminalCursorStyle | null {
  if (value === "block" || value === "bar" || value === "underline") {
    return value;
  }
  return null;
}
