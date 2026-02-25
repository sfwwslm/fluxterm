import type { Locale } from "@/i18n";

/** 将字节数格式化为可读字符串。 */
export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** 将秒级时间戳格式化为本地时间字符串。 */
export function formatTime(epoch: number, locale: Locale) {
  const date = new Date(epoch * 1000);
  const resolved = locale === "zh" ? "zh-CN" : "en-US";
  return date.toLocaleString(resolved);
}
