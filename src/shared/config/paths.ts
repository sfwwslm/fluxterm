/**
 * 配置路径统一管理模块。
 * 职责：通过 tauri 命令获取唯一配置目录，并提供常用配置文件路径。
 */
import { join } from "@tauri-apps/api/path";
import { callTauri } from "@/shared/tauri/commands";

let configDirPromise: Promise<string> | null = null;

/** 获取应用配置目录。 */
export async function getFluxTermConfigDir() {
  if (!configDirPromise) {
    configDirPromise = callTauri<string>("app_config_dir");
  }
  return configDirPromise;
}

/** 获取配置文件完整路径。 */
export async function getConfigFilePath(fileName: string) {
  const dir = await getFluxTermConfigDir();
  return join(dir, fileName);
}

/** 获取 settings.json 路径。 */
export async function getSettingsPath() {
  return getConfigFilePath("settings.json");
}

/** 获取 layout.json 路径。 */
export async function getLayoutPath() {
  return getConfigFilePath("layout.json");
}
