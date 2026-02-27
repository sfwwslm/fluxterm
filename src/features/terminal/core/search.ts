/**
 * 终端搜索工具模块。
 * 职责：在 xterm buffer 中执行前后向文本查找。
 */
import type { Terminal } from "@xterm/xterm";

type SearchDirection = "next" | "prev";

/** 在 xterm buffer 中按方向查找关键字。 */
export function findInTerminal(
  terminal: Terminal,
  keyword: string,
  direction: SearchDirection,
  startRow: number,
  startCol: number,
) {
  const buffer = terminal.buffer.active;
  const total = buffer.length;
  const needle = keyword.toLowerCase();

  if (direction === "next") {
    for (let row = startRow; row < total; row += 1) {
      const line = buffer.getLine(row)?.translateToString(true) ?? "";
      const fromCol = row === startRow ? Math.max(0, startCol) : 0;
      const index = line.toLowerCase().indexOf(needle, fromCol);
      if (index >= 0) return { row, col: index, length: keyword.length };
    }
    return null;
  }

  for (let row = startRow; row >= 0; row -= 1) {
    const line = buffer.getLine(row)?.translateToString(true) ?? "";
    const endCol =
      row === startRow ? Math.min(startCol, line.length - 1) : line.length - 1;
    if (endCol < 0) continue;
    const index = line.toLowerCase().lastIndexOf(needle, endCol);
    if (index >= 0) return { row, col: index, length: keyword.length };
  }
  return null;
}
