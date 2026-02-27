/**
 * SFTP 事件监听模块。
 * 职责：统一注册并转发 sftp:progress 事件。
 */
import type { SftpProgress } from "@/types";
import { subscribeTauri } from "@/shared/tauri/events";

/**
 * 注册 SFTP 进度事件监听，并返回卸载函数。
 */
export async function registerSftpProgressListener(
  onProgress: (payload: SftpProgress) => void,
) {
  return subscribeTauri<SftpProgress>("sftp:progress", (event) => {
    onProgress(event.payload);
  });
}
