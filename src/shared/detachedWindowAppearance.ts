import type {
  BackgroundMediaType,
  BackgroundRenderMode,
} from "@/constants/backgroundMedia";

/**
 * 解析子应用与悬浮窗口背景媒体的铺放方式。
 * 这些窗口会在首屏准备阶段先隐藏，待背景媒体首帧可用后再显示。
 */
export function resolveDetachedBackgroundImageStyle(
  mode: BackgroundRenderMode,
) {
  if (mode === "contain") {
    return {
      size: "contain",
      repeat: "no-repeat",
      position: "center center",
    };
  }
  if (mode === "tile") {
    return {
      size: "auto",
      repeat: "repeat",
      position: "left top",
    };
  }
  return {
    size: "cover",
    repeat: "no-repeat",
    position: "center center",
  };
}

/**
 * 等待浏览器至少完成若干帧绘制。
 * 用于减少子应用与悬浮窗口启动时的白框、纯色占位和内容闪烁。
 */
export async function waitForNextPaint(frameCount = 1) {
  for (let index = 0; index < frameCount; index += 1) {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
}

async function waitForImageReady(url: string) {
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Failed to decode detached window background image."));
    };
    image.src = url;
    if (typeof image.decode === "function") {
      image
        .decode()
        .then(() => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        })
        .catch(() => {});
    }
  });
}

async function waitForVideoReady(url: string) {
  await new Promise<void>((resolve, reject) => {
    const video = document.createElement("video");
    let settled = false;
    const cleanup = () => {
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    video.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Failed to decode detached window background video."));
    };
    video.src = url;
    video.load();
  });
}

/**
 * 子应用与悬浮窗口启用背景媒体时，先等待媒体首帧可用，再解除窗口隐藏。
 */
export function waitForDetachedBackgroundMediaReady(
  url: string,
  mediaType: BackgroundMediaType,
) {
  if (mediaType === "video") {
    return waitForVideoReady(url);
  }
  return waitForImageReady(url);
}
