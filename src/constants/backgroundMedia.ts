import { getBuiltinWallpaperByAsset } from "@/constants/builtinWallpapers";

/** 背景媒体类型。 */
export type BackgroundMediaType = "image" | "video";

/** 背景渲染模式。 */
export type BackgroundRenderMode = "cover" | "contain" | "tile";

/** 视频重播策略。 */
export type BackgroundVideoReplayMode = "loop" | "single" | "interval";

export const DEFAULT_BACKGROUND_MEDIA_TYPE: BackgroundMediaType = "image";
export const DEFAULT_BACKGROUND_RENDER_MODE: BackgroundRenderMode = "cover";
export const DEFAULT_BACKGROUND_VIDEO_REPLAY_MODE: BackgroundVideoReplayMode =
  "loop";
export const DEFAULT_BACKGROUND_VIDEO_REPLAY_INTERVAL_SEC = 8;

export const MIN_BACKGROUND_VIDEO_REPLAY_INTERVAL_SEC = 1;
export const MAX_BACKGROUND_VIDEO_REPLAY_INTERVAL_SEC = 600;

export const BACKGROUND_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
export const BACKGROUND_VIDEO_EXTENSIONS = ["mp4", "webm", "ogv", "mov", "m4v"];
export const BACKGROUND_MEDIA_EXTENSIONS = [
  ...BACKGROUND_IMAGE_EXTENSIONS,
  ...BACKGROUND_VIDEO_EXTENSIONS,
];

/** 规范化背景媒体类型，非法值回退到图片。 */
export function normalizeBackgroundMediaType(
  value: unknown,
): BackgroundMediaType {
  return value === "video" ? "video" : "image";
}

/** 规范化背景渲染模式，非法值回退 cover。 */
export function normalizeBackgroundRenderMode(
  value: unknown,
): BackgroundRenderMode {
  if (value === "contain" || value === "tile") return value;
  return "cover";
}

/** 规范化视频重播模式，非法值回退 loop。 */
export function normalizeBackgroundVideoReplayMode(
  value: unknown,
): BackgroundVideoReplayMode {
  if (value === "single" || value === "interval") return value;
  return "loop";
}

/** 规范化视频重播间隔。 */
export function clampBackgroundVideoReplayIntervalSec(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num))
    return DEFAULT_BACKGROUND_VIDEO_REPLAY_INTERVAL_SEC;
  return Math.min(
    MAX_BACKGROUND_VIDEO_REPLAY_INTERVAL_SEC,
    Math.max(MIN_BACKGROUND_VIDEO_REPLAY_INTERVAL_SEC, Math.round(num)),
  );
}

/** 根据扩展名判断背景媒体类型，无法识别时默认图片。 */
export function inferBackgroundMediaTypeFromAsset(asset: string) {
  if (getBuiltinWallpaperByAsset(asset)) {
    return "image" satisfies BackgroundMediaType;
  }
  const match = asset.match(/\.([A-Za-z0-9]+)$/);
  const ext = match?.[1]?.toLowerCase();
  if (ext && BACKGROUND_VIDEO_EXTENSIONS.includes(ext)) {
    return "video" satisfies BackgroundMediaType;
  }
  return "image" satisfies BackgroundMediaType;
}
