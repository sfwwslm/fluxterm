/** 规范化本地文件浏览路径。 */
export function normalizeLocalPath(path: string) {
  if (!path) return path;
  if (path === "drives://") return path;
  if (/^[A-Za-z]:$/.test(path)) {
    return `${path}\\`;
  }
  return path;
}
