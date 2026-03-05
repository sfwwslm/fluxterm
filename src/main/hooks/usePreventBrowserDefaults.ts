import { useEffect } from "react";

/**
 * 浏览器默认行为拦截 Hook。
 * 职责：全局禁用右键菜单、拖拽文件进入窗口等浏览器原生交互行为，
 * 避免这些行为与应用自身的 UI 逻辑（如自定义右键菜单、SFTP 拖拽上传）产生冲突。
 */
export function usePreventBrowserDefaults() {
  useEffect(() => {
    /** 阻止原生右键菜单。 */
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    /** 阻止浏览器默认的拖拽进入反馈（如显示复制图标）。 */
    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
    };

    /** 阻止浏览器默认的拖放反馈（如直接在窗口打开文件）。 */
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("dragover", handleDragOver, true);
    window.addEventListener("drop", handleDrop, true);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("dragover", handleDragOver, true);
      window.removeEventListener("drop", handleDrop, true);
    };
  }, []);
}
