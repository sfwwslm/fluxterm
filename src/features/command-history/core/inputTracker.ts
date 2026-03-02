/**
 * 输入缓冲辅助工具。
 * 职责：
 * 1. 维护联想面板使用的“本地输入缓冲”。
 * 2. 提供历史命令项 id 与列表裁剪等通用工具。
 */
import type { CommandHistoryItem, CommandHistorySource } from "@/types";

export type TrackedCommandCommit = {
  command: string;
  source: CommandHistorySource;
};

type InputBufferUpdateResult = {
  buffer: string;
  commits: TrackedCommandCommit[];
};

/** 创建稳定命令 id，便于 React 列表和持久化复用。 */
export function createCommandHistoryItemId(command: string, timestamp: number) {
  return `${timestamp}-${command}`;
}

/**
 * 根据键盘输入流更新当前输入缓冲。
 * 该缓冲只用于联想输入跟踪，不代表 shell 最终执行的真实命令。
 */
export function updateCommandInputBuffer(buffer: string, data: string) {
  const cleaned = data.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  let nextBuffer = buffer;
  const commits: TrackedCommandCommit[] = [];

  for (const char of cleaned) {
    if (char === "\r" || char === "\n") {
      const command = nextBuffer.trim();
      if (command) {
        commits.push({ command, source: "typed" });
      }
      nextBuffer = "";
      continue;
    }
    if (char === "\u007f" || char === "\b") {
      nextBuffer = nextBuffer.slice(0, -1);
      continue;
    }
    if (char >= " ") {
      nextBuffer += char;
    }
  }

  return {
    buffer: nextBuffer,
    commits,
  } satisfies InputBufferUpdateResult;
}

/** 按最近使用时间裁剪命令历史，避免单个作用域无限增长。 */
export function trimHistoryItems(
  items: CommandHistoryItem[],
  limit: number,
): CommandHistoryItem[] {
  return [...items]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, Math.max(limit, 1));
}
