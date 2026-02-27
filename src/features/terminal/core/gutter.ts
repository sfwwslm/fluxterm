/**
 * 终端 gutter 工具模块。
 * 职责：提供时间格式化、清屏判定与行高计算等 gutter 基础能力。
 */
import type { Terminal } from "@xterm/xterm";

/** 将时间格式化为 gutter 显示格式。 */
export function formatGutterTime(timestamp: number) {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}

/** 判断输出是否触发清屏并需要重置行号。 */
export function shouldResetLineNumbering(data: string) {
  const clearScreenSequence = /\u001b\[[0-9;?]*(?:2J|3J)/.test(data);
  const cursorHomeSequence = /\u001b\[[0-9;?]*[Hf]/.test(data);
  const hardResetSequence = /\u001bc/.test(data);
  return hardResetSequence || (clearScreenSequence && cursorHomeSequence);
}

/** 从 xterm 内部渲染服务读取真实单元格高度。 */
export function resolveCellHeight(terminal: Terminal) {
  const maybeHeight = (
    terminal as unknown as {
      _core?: {
        _renderService?: {
          dimensions?: { css?: { cell?: { height?: number } } };
        };
      };
    }
  )._core?._renderService?.dimensions?.css?.cell?.height;
  if (
    typeof maybeHeight === "number" &&
    Number.isFinite(maybeHeight) &&
    maybeHeight > 0
  ) {
    return maybeHeight;
  }
  return 0;
}
