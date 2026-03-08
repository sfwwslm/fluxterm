/**
 * SFTP 拖拽上传 Hook。
 * 职责：监听窗口级文件拖拽事件，并在命中当前文件面板时触发上传。
 */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RefObject } from "react";

export type SftpDropState = "idle" | "accept" | "reject";

type UseSftpDropUploadProps = {
  enabled: boolean;
  widgetRef: RefObject<HTMLElement | null>;
  onDropPaths: (paths: string[]) => Promise<void>;
};

/** 监听文件面板拖拽投递状态。 */
export default function useSftpDropUpload({
  enabled,
  widgetRef,
  onDropPaths,
}: UseSftpDropUploadProps) {
  const [dropState, setDropState] = useState<SftpDropState>("idle");

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const register = async () => {
      unlisten = await getCurrentWindow().onDragDropEvent((event) => {
        void (async () => {
          if (cancelled) return;
          if (!enabled) {
            setDropState("idle");
            return;
          }
          const widget = widgetRef.current;
          if (!widget) {
            setDropState("idle");
            return;
          }
          if (event.payload.type === "leave") {
            setDropState("idle");
            return;
          }
          const scale = window.devicePixelRatio || 1;
          const x = event.payload.position.x / scale;
          const y = event.payload.position.y / scale;
          const rect = widget.getBoundingClientRect();
          const inside =
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom;
          if (event.payload.type === "over") {
            setDropState(inside ? "accept" : "idle");
            return;
          }
          if (event.payload.type === "enter") {
            setDropState(inside ? "accept" : "idle");
            return;
          }
          if (event.payload.type === "drop") {
            setDropState("idle");
            if (!inside || !event.payload.paths.length) return;
            await onDropPaths(event.payload.paths);
          }
        })();
      });
    };

    register().catch(() => {});
    return () => {
      cancelled = true;
      setDropState("idle");
      unlisten?.();
    };
  }, [enabled, onDropPaths, widgetRef]);

  return dropState;
}
