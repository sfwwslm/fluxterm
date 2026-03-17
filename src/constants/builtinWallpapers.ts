import glassAuroraUrl from "@/assets/wallpapers/glass-aurora.svg?url";
import glassCometUrl from "@/assets/wallpapers/glass-comet.svg?url";
import glassOrbitUrl from "@/assets/wallpapers/glass-orbit.svg?url";
import nebulaGridUrl from "@/assets/wallpapers/nebula-grid.svg?url";
import paperDuneUrl from "@/assets/wallpapers/paper-dune.svg?url";
import startrailBasinUrl from "@/assets/wallpapers/startrail-basin.svg?url";
import startrailMeridianUrl from "@/assets/wallpapers/startrail-meridian.svg?url";
import startrailVaultUrl from "@/assets/wallpapers/startrail-vault.svg?url";
import tealHorizonUrl from "@/assets/wallpapers/teal-horizon.svg?url";

/** 内置壁纸 ID。 */
export type BuiltinWallpaperId =
  | "nebula-grid"
  | "teal-horizon"
  | "paper-dune"
  | "glass-orbit"
  | "glass-aurora"
  | "glass-comet"
  | "startrail-meridian"
  | "startrail-basin"
  | "startrail-vault";

/** 内置壁纸主题适配。 */
export type BuiltinWallpaperTone = "dark" | "light" | "all";

/** 内置壁纸元数据。 */
export type BuiltinWallpaper = {
  id: BuiltinWallpaperId;
  asset: string;
  url: string;
  tone: BuiltinWallpaperTone;
  label: string;
};

export const BUILTIN_WALLPAPER_ASSET_PREFIX = "builtin:";

/** 将内置壁纸 ID 转换为 settings 中持久化的资产标识。 */
export function toBuiltinWallpaperAsset(id: BuiltinWallpaperId) {
  return `${BUILTIN_WALLPAPER_ASSET_PREFIX}${id}`;
}

/** 判断当前资产是否为内置壁纸。 */
export function isBuiltinWallpaperAsset(asset: string) {
  return asset.startsWith(BUILTIN_WALLPAPER_ASSET_PREFIX);
}

export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  {
    id: "nebula-grid",
    asset: toBuiltinWallpaperAsset("nebula-grid"),
    url: nebulaGridUrl,
    tone: "dark",
    label: "Nebula Grid",
  },
  {
    id: "teal-horizon",
    asset: toBuiltinWallpaperAsset("teal-horizon"),
    url: tealHorizonUrl,
    tone: "all",
    label: "Teal Horizon",
  },
  {
    id: "paper-dune",
    asset: toBuiltinWallpaperAsset("paper-dune"),
    url: paperDuneUrl,
    tone: "light",
    label: "Paper Dune",
  },
  {
    id: "glass-orbit",
    asset: toBuiltinWallpaperAsset("glass-orbit"),
    url: glassOrbitUrl,
    tone: "dark",
    label: "Glass Orbit",
  },
  {
    id: "glass-aurora",
    asset: toBuiltinWallpaperAsset("glass-aurora"),
    url: glassAuroraUrl,
    tone: "all",
    label: "Glass Aurora",
  },
  {
    id: "glass-comet",
    asset: toBuiltinWallpaperAsset("glass-comet"),
    url: glassCometUrl,
    tone: "dark",
    label: "Glass Comet",
  },
  {
    id: "startrail-meridian",
    asset: toBuiltinWallpaperAsset("startrail-meridian"),
    url: startrailMeridianUrl,
    tone: "dark",
    label: "Startrail Meridian",
  },
  {
    id: "startrail-basin",
    asset: toBuiltinWallpaperAsset("startrail-basin"),
    url: startrailBasinUrl,
    tone: "dark",
    label: "Startrail Basin",
  },
  {
    id: "startrail-vault",
    asset: toBuiltinWallpaperAsset("startrail-vault"),
    url: startrailVaultUrl,
    tone: "dark",
    label: "Startrail Vault",
  },
];

/** 根据持久化资产标识获取内置壁纸。 */
export function getBuiltinWallpaperByAsset(asset: string) {
  return BUILTIN_WALLPAPERS.find((wallpaper) => wallpaper.asset === asset);
}
