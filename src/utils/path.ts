/** 获取父级路径。 */
export function parentPath(path: string) {
  if (!path) return path;
  if (path === "drives://") return path;
  const separator = path.includes("\\") ? "\\" : "/";
  const trimmed = path.endsWith(separator) ? path.slice(0, -1) : path;
  if (separator === "\\" && /^[A-Za-z]:$/.test(trimmed)) {
    return "drives://";
  }
  const index = trimmed.lastIndexOf(separator);
  if (index <= 0) {
    return separator === "\\" ? trimmed : "/";
  }
  const parent = trimmed.slice(0, index);
  if (separator === "\\" && /^[A-Za-z]:$/.test(parent)) {
    return `${parent}\\`;
  }
  return parent;
}

/** 判断路径是否为根路径。 */
export function isRootPath(path: string) {
  if (!path) return true;
  if (path === "drives://") return true;
  if (path === "/") return true;
  return false;
}
