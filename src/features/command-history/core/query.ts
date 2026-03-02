/**
 * 历史命令查询辅助。
 * 职责：
 * 1. 提供统一排序规则。
 * 2. 提供当前会话历史面板使用的关键词过滤。
 */
import type { CommandHistoryItem } from "@/types";

function compareHistoryItems(a: CommandHistoryItem, b: CommandHistoryItem) {
  if (a.lastUsedAt !== b.lastUsedAt) {
    return b.lastUsedAt - a.lastUsedAt;
  }
  if (a.useCount !== b.useCount) {
    return b.useCount - a.useCount;
  }
  return a.command.localeCompare(b.command);
}

/** 按默认规则排序历史命令。 */
export function sortHistoryItems(items: CommandHistoryItem[]) {
  return [...items].sort(compareHistoryItems);
}

/** 按关键词过滤历史命令，默认使用大小写不敏感的包含匹配。 */
export function filterHistoryItems(
  items: CommandHistoryItem[],
  keyword: string,
) {
  const query = keyword.trim().toLocaleLowerCase();
  if (!query) return sortHistoryItems(items);
  return sortHistoryItems(
    items.filter((item) => item.command.toLocaleLowerCase().includes(query)),
  );
}
