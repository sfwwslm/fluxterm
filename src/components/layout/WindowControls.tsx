/** 自定义窗口控制按钮组，适配 Tauri 桌面窗口的最小化/最大化/关闭。 */
import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
} from "react-icons/vsc";
import Button from "@/components/ui/button";

type WindowControlsProps = {
  disabled?: boolean;
};

export default function WindowControls({ disabled }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const hasTauriRuntime =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const isDisabled = disabled || !hasTauriRuntime;

  const refreshMaximized = useCallback(async () => {
    if (!hasTauriRuntime) return;
    const currentWindow = getCurrentWindow();
    const maximized = await currentWindow.isMaximized();
    setIsMaximized(maximized);
  }, [hasTauriRuntime]);

  const handleMinimize = useCallback(() => {
    if (isDisabled) return;
    void getCurrentWindow().minimize();
  }, [isDisabled]);

  const handleToggleMaximize = useCallback(async () => {
    if (isDisabled) return;
    const currentWindow = getCurrentWindow();
    await currentWindow.toggleMaximize();
    await refreshMaximized();
  }, [isDisabled, refreshMaximized]);

  const handleClose = useCallback(() => {
    if (isDisabled) return;
    void getCurrentWindow().close();
  }, [isDisabled]);

  useEffect(() => {
    if (!hasTauriRuntime) return;
    queueMicrotask(() => {
      void refreshMaximized().catch(() => {});
    });
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onResized(() => {
        queueMicrotask(() => {
          void refreshMaximized().catch(() => {});
        });
      })
      .then((stop) => {
        unlisten = stop;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [hasTauriRuntime, refreshMaximized]);

  return (
    <div className="window-controls">
      <Button
        className="window-control"
        variant="ghost"
        size="icon"
        data-tauri-drag-region="false"
        onClick={handleMinimize}
        disabled={isDisabled}
        aria-label="Minimize window"
      >
        <VscChromeMinimize />
      </Button>
      <Button
        className="window-control"
        variant="ghost"
        size="icon"
        data-tauri-drag-region="false"
        onClick={() => {
          void handleToggleMaximize();
        }}
        disabled={isDisabled}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
      >
        {isMaximized ? <VscChromeRestore /> : <VscChromeMaximize />}
      </Button>
      <Button
        className="window-control danger"
        variant="danger"
        size="icon"
        data-tauri-drag-region="false"
        onClick={handleClose}
        disabled={isDisabled}
        aria-label="Close window"
      >
        <VscChromeClose />
      </Button>
    </div>
  );
}
