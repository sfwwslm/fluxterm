import pkg from "../package.json";

const deps =
  (pkg as { dependencies?: Record<string, string> }).dependencies ?? {};
const devDeps =
  (pkg as { devDependencies?: Record<string, string> }).devDependencies ?? {};

const getVersion = (source: Record<string, string>, name: string) =>
  source[name] ?? "unknown";

export const APP_VERSION = pkg.version ?? "unknown";
export const COMMIT_HASH = import.meta.env.VITE_GIT_HASH ?? "unknown";
export const TOOLCHAIN_INFO = [
  `Tauri ${getVersion(deps, "@tauri-apps/api")}`,
  `Vite ${getVersion(devDeps, "vite")}`,
  `React ${getVersion(deps, "react")}`,
  `TypeScript ${getVersion(devDeps, "typescript")}`,
].join(" · ");
