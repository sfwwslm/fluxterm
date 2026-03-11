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

  // 终端聚焦时由 xterm 宿主层统一处理快捷键路由，这里不再重复抢键。
  if (terminalFocused) {
    return false;
  }

  if (key === "f3" || key === "f7" || key === "f1") return true;

  if (key === "f5") return true;

  if (key === "f12") return true;

  if (ctrlOrMeta) {
    if (
      key === "r" ||
      key === "f" ||
      key === "u" ||
      key === "l" ||
      key === "g" ||
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
