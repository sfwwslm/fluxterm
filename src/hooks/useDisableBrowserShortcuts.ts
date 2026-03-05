import { useEffect } from "react";

/**
 * 浏览器快捷键禁用 Hook。
 * 职责：拦截并禁用浏览器常用的原生快捷键（如 F5 刷新、F12 开发者工具、Ctrl+W 关闭窗口等），
 * 确保应用作为桌面终端的交互完整性，防止用户误触导致会话中断。
 */
type Options = {
  enabled?: boolean;
};

function isTerminalFocused(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(".terminal-container, .terminal-xterm-host, .xterm"),
  );
}

const isBlockedShortcut = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase();
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  const terminalFocused = isTerminalFocused(event.target);

  if (key === "f3" || key === "f7" || key === "f1") return true;

  if (key === "f5") return true;

  if (key === "f12") return true;

  if (ctrlOrMeta) {
    // 终端获得焦点时，应优先把大部分 Ctrl/Cmd 组合键交给 shell；
    // 这里只保留真正会影响应用窗口或浏览器行为的快捷键拦截。
    if (terminalFocused) {
      if (
        key === "w" ||
        key === "n" ||
        key === "t" ||
        key === "p" ||
        key === "tab" ||
        key === "pageup" ||
        key === "pagedown"
      ) {
        return true;
      }
      if (event.shiftKey && ["r", "i", "j", "c", "k"].includes(key)) {
        return true;
      }
      if (event.shiftKey && key === "delete") return true;
      return false;
    }
    if (
      key === "r" ||
      key === "f" ||
      key === "u" ||
      key === "l" ||
      key === "w" ||
      key === "n" ||
      key === "t" ||
      key === "p" ||
      key === "s" ||
      key === "o" ||
      key === "0" ||
      key === "=" ||
      key === "+" ||
      key === "-" ||
      key === "tab" ||
      key === "pageup" ||
      key === "pagedown"
    ) {
      return true;
    }
    if (event.shiftKey && ["r", "i", "j", "c", "k"].includes(key)) return true;
    if (event.shiftKey && key === "delete") return true;
  }

  if (event.altKey && (key === "arrowleft" || key === "arrowright")) {
    return true;
  }

  return false;
};

export const useDisableBrowserShortcuts = ({
  enabled = true,
}: Options = {}) => {
  useEffect(() => {
    if (!enabled) return;

    /** 拦截键盘按下事件。 */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isBlockedShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [enabled]);
};
