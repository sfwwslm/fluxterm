/**
 * 历史命令联想 provider。
 * 职责：
 * 1. 基于全局历史命令输出候选列表。
 * 2. 对候选做频率、位置和近期性排序。
 *
 * 当前实现是本地规则 provider，后续可替换为 AI / 远端 provider，
 * 终端层仍只依赖统一的 `CommandAutocompleteProvider` 接口。
 */
import type { CommandHistoryItem } from "@/types";
import { AUTOCOMPLETE_MAX_CANDIDATES } from "@/features/terminal/core/constants";

const MIN_AUTOCOMPLETE_USE_COUNT = 5;

export type CommandAutocompleteCandidate = {
  command: string;
  useCount: number;
  lastUsedAt: number;
  score: number;
};

export type CommandAutocompleteProvider = {
  getSuggestions: (input: string) => CommandAutocompleteCandidate[];
};

/** 计算历史命令候选分值。返回 null 表示该命令不参与联想。 */
function scoreHistoryCandidate(item: CommandHistoryItem, input: string) {
  const query = input.trim().toLocaleLowerCase();
  const command = item.command.toLocaleLowerCase();
  if (!query) return null;
  if (item.useCount < MIN_AUTOCOMPLETE_USE_COUNT) return null;
  if (!command.includes(query)) return null;

  const startsWith = command.startsWith(query);
  const index = command.indexOf(query);
  const recencyScore = item.lastUsedAt / 1_000_000_000_000;
  return (
    (startsWith ? 1000 : 0) +
    Math.max(0, 200 - index * 10) +
    item.useCount * 5 +
    recencyScore
  );
}

/** 基于历史命令构建联想提供器，后续可无缝替换为 AI 或远端 provider。 */
export function createHistoryAutocompleteProvider(
  items: CommandHistoryItem[],
  limit = AUTOCOMPLETE_MAX_CANDIDATES,
): CommandAutocompleteProvider {
  return {
    getSuggestions(input: string) {
      const query = input.trim();
      if (!query) return [];
      return items
        .map((item) => {
          const score = scoreHistoryCandidate(item, query);
          if (score === null) return null;
          return {
            command: item.command,
            useCount: item.useCount,
            lastUsedAt: item.lastUsedAt,
            score,
          } satisfies CommandAutocompleteCandidate;
        })
        .filter((item): item is CommandAutocompleteCandidate => item !== null)
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          if (a.lastUsedAt !== b.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
          if (a.useCount !== b.useCount) return b.useCount - a.useCount;
          return a.command.localeCompare(b.command);
        })
        .slice(0, limit);
    },
  };
}
