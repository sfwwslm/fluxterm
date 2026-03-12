/**
 * 会话断开原因推断模块。
 * 职责：基于最近命令和会话类型推断断开原因。
 */
import type { DisconnectReason } from "@/types";

function normalizeCommand(command: string) {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  if (tokens[0] === "sudo" && tokens.length > 1) {
    return tokens[1];
  }
  return tokens[0];
}

/** 基于最近命令推断会话断开原因。 */
export function inferDisconnectReason(
  lastCommand: string | undefined,
  localSession: boolean,
  terminalEofRequested = false,
): DisconnectReason {
  if (terminalEofRequested) {
    return "exit";
  }
  if (!lastCommand) {
    return localSession ? "exit" : "network";
  }
  const command = normalizeCommand(lastCommand);
  if (command === "exit") return "exit";
  if (command === "poweroff") return "poweroff";
  if (command === "reboot") return "reboot";
  return localSession ? "exit" : "network";
}
