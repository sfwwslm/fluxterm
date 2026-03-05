/**
 * 配置路径统一管理模块。
 * 职责：集中管理配置目录与数据目录，避免业务层分散拼接路径。
 */
import { join } from "@tauri-apps/api/path";
import { callTauri } from "@/shared/tauri/commands";

let appConfigDirPromise: Promise<string> | null = null;
let appDataDirPromise: Promise<string> | null = null;

/** 获取应用配置目录。 */
export async function getAppConfigDir() {
  if (!appConfigDirPromise) {
    appConfigDirPromise = callTauri<string>("app_config_dir");
  }
  return appConfigDirPromise;
}

/** 获取应用数据目录。 */
export async function getAppDataDir() {
  if (!appDataDirPromise) {
    appDataDirPromise = callTauri<string>("app_data_dir");
  }
  return appDataDirPromise;
}

/** 获取应用级配置目录。 */
export async function getGlobalConfigDir() {
  const dir = await getAppConfigDir();
  return join(dir, "global");
}

/** 获取终端域配置目录。 */
export async function getTerminalConfigDir() {
  const dir = await getAppConfigDir();
  return join(dir, "terminal");
}

/** 获取 settings.json 路径。 */
export async function getSettingsPath() {
  const dir = await getGlobalConfigDir();
  return join(dir, "settings.json");
}

/** 获取 layout.json 路径。 */
export async function getLayoutPath() {
  const dir = await getGlobalConfigDir();
  return join(dir, "layout.json");
}

/** 获取 quickbar.json 路径。 */
export async function getQuickbarPath() {
  const dir = await getGlobalConfigDir();
  return join(dir, "quickbar.json");
}

/** 获取背景图资源目录。 */
export async function getBackgroundImagesDir() {
  const dir = await getGlobalConfigDir();
  return join(dir, "backgrounds");
}

/** 构建背景图资源相对路径（写入 settings）。 */
export function toBackgroundImageAsset(fileName: string) {
  return `backgrounds/${fileName}`;
}

/** 获取背景图资源绝对路径（读取文件）。 */
export async function getBackgroundImageAssetPath(asset: string) {
  const dir = await getGlobalConfigDir();
  const normalizedAsset = asset.replace(/\\/g, "/").replace(/^\/+/, "");
  return join(dir, normalizedAsset);
}

/** 获取 session.json 路径。 */
export async function getSessionSettingsPath() {
  const dir = await getTerminalConfigDir();
  return join(dir, "session.json");
}

/** 获取历史命令配置路径。 */
export async function getCommandHistoryPath() {
  const dir = await getTerminalConfigDir();
  return join(dir, "command-history.json");
}

/** 获取远端文件缓存根目录。 */
export async function getRemoteFilesCacheRootDir() {
  const dir = await getAppDataDir();
  return join(dir, "cache", "remote-files");
}

/** 获取指定会话的远端文件缓存目录。 */
export async function getRemoteFileCacheDir(sessionId: string) {
  const dir = await getRemoteFilesCacheRootDir();
  return join(dir, sessionId);
}
