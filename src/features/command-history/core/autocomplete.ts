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
import {
  AUTOCOMPLETE_FREQUENCY_WEIGHT,
  AUTOCOMPLETE_LENGTH_PENALTY_PER_CHAR,
  AUTOCOMPLETE_MATCH_SCORE_ARGS_PREFIX,
  AUTOCOMPLETE_MATCH_SCORE_COMMAND_EXACT,
  AUTOCOMPLETE_MATCH_SCORE_COMMAND_PREFIX,
  AUTOCOMPLETE_MAX_CANDIDATES,
  AUTOCOMPLETE_MIN_USE_COUNT,
  AUTOCOMPLETE_RECENCY_DECAY_WINDOW_DAYS,
  AUTOCOMPLETE_RECENCY_MAX_SCORE,
} from "@/features/terminal/core/constants";

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
  const command = item.command.trim().toLocaleLowerCase();
  if (!query) return null;
  if (item.useCount < AUTOCOMPLETE_MIN_USE_COUNT) return null;
  const hasArgsQuery = /\s/.test(query);
  const commandName = command.split(/\s+/, 1)[0] ?? "";
  const matched = hasArgsQuery
    ? command.startsWith(query)
    : commandName.startsWith(query);
  if (!matched) return null;

  const now = Date.now();
  const ageMs = Math.max(0, now - item.lastUsedAt);
  const decayWindowMs =
    AUTOCOMPLETE_RECENCY_DECAY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // 近期性使用线性衰减，分值范围稳定在 0~AUTOCOMPLETE_RECENCY_MAX_SCORE。
  const recencyScore =
    (Math.max(0, decayWindowMs - ageMs) / decayWindowMs) *
    AUTOCOMPLETE_RECENCY_MAX_SCORE;
  // 使用频次使用对数，避免高频命令把排序完全碾压。
  const frequencyScore =
    Math.log2(item.useCount + 1) * AUTOCOMPLETE_FREQUENCY_WEIGHT;
  const exactCommandName = !hasArgsQuery && commandName === query;
  const matchQualityScore = hasArgsQuery
    ? AUTOCOMPLETE_MATCH_SCORE_ARGS_PREFIX
    : exactCommandName
      ? AUTOCOMPLETE_MATCH_SCORE_COMMAND_EXACT
      : AUTOCOMPLETE_MATCH_SCORE_COMMAND_PREFIX;
  // 对比输入越“冗长”的候选，分值越低，优先展示更短更常见的命令形态。
  const lengthPenalty =
    Math.max(0, command.length - query.length) *
    AUTOCOMPLETE_LENGTH_PENALTY_PER_CHAR;
  return matchQualityScore + frequencyScore + recencyScore - lengthPenalty;
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
