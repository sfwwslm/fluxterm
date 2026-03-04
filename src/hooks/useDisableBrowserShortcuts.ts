import { useEffect } from "react";

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

/** 禁用浏览器级快捷键，避免刷新/关闭/开发者工具等打断应用。 */
export const useDisableBrowserShortcuts = ({
  enabled = true,
}: Options = {}) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isBlockedShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
    };
  }, [enabled]);
};
