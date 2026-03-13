/**
 * 终端宿主快捷键动作。
 * 仅用于 xterm 已聚焦的场景，决定哪些组合键应由宿主层接管，
 * 哪些应继续透传给 shell / TUI 程序。
 */
export type TerminalHostKeyAction =
  | "copy-selection"
  | "prevent-browser-shortcut"
  | "passthrough";

/**
 * 解析终端宿主层需要接管的快捷键。
 * 职责边界：
 * 1. 这里只处理 xterm 已聚焦时的少量宿主增强行为。
 * 2. shell 常用编辑键（如 Ctrl+R、Ctrl+W）必须透传，避免破坏 SSH/readline/zsh 体验。
 * 3. 全局浏览器快捷键屏蔽由 useDisableBrowserShortcuts 负责，二者需保持分层一致。
 */
export function resolveTerminalHostKeyAction(
  event: KeyboardEvent,
  hasSelection: boolean,
): TerminalHostKeyAction {
  const key = event.key.toLowerCase();
  const ctrlOrMeta = event.ctrlKey || event.metaKey;

  if (ctrlOrMeta && event.shiftKey && key === "c" && hasSelection) {
    return "copy-selection";
  }

  if (key === "f5") {
    return "prevent-browser-shortcut";
  }

  return "passthrough";
}
