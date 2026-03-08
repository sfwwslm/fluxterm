import pkg from "../package.json";

const deps =
  (pkg as { dependencies?: Record<string, string> }).dependencies ?? {};
const devDeps =
  (pkg as { devDependencies?: Record<string, string> }).devDependencies ?? {};

const getVersion = (source: Record<string, string>, name: string) =>
  source[name] ?? "unknown";

/** 提取 WebView 内核的主版本信息。 */
const detectWebViewVersion = () => {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const chrome = ua.match(/Chrome\/([0-9.]+)/i);
  if (chrome?.[1]) return `Chrome/${chrome[1]}`;
  const appleWebKit = ua.match(/AppleWebKit\/([0-9.]+)/i);
  if (appleWebKit?.[1]) return `AppleWebKit/${appleWebKit[1]}`;
  return "unknown";
};

export const APP_VERSION = pkg.version ?? "unknown";
export const COMMIT_HASH = import.meta.env.VITE_GIT_HASH ?? "unknown";
export const BUILD_TIME = import.meta.env.VITE_BUILD_TIME ?? "unknown";
export const PLATFORM_ARCH = "unknown";
export const RUNTIME_INFO = `WebView ${detectWebViewVersion()}`;
export const TECH_STACK_INFO = [
  `Tauri ${getVersion(deps, "@tauri-apps/api")}`,
  `Vite ${getVersion(devDeps, "vite")}`,
  `React ${getVersion(deps, "react")}`,
  `TypeScript ${getVersion(devDeps, "typescript")}`,
].join(" · ");
