import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";

/** 更新检查结果。 */
export type UpdateCheckResult = {
  available: boolean;
  update: Update | null;
  version: string | null;
};

/** 检查是否存在可用更新。 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const update = await check();
  if (!update) {
    return {
      available: false,
      update: null,
      version: null,
    };
  }
  return {
    available: true,
    update,
    version: update.version,
  };
}

/** 下载并安装更新。 */
export async function downloadAndInstallUpdate(
  update: Update,
  onEvent?: (event: DownloadEvent) => void,
) {
  await update.downloadAndInstall(onEvent);
}
