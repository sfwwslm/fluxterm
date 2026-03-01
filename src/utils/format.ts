import type { Locale } from "@/i18n";

function resolveLocale(locale: Locale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

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

/** 将秒级时间戳格式化为本地日期时间字符串。 */
export function formatTime(epoch: number, locale: Locale) {
  return new Date(epoch * 1000).toLocaleString(resolveLocale(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** 将毫秒级时间戳格式化为本地日期时间字符串。 */
export function formatDateTimeMs(timestamp: number, locale: Locale) {
  return new Date(timestamp).toLocaleString(resolveLocale(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** 将 Date 对象格式化为本地日期时间字符串。 */
export function formatDateTime(value: Date, locale: Locale) {
  return value.toLocaleString(resolveLocale(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
