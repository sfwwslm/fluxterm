/**
 * 终端运行时 Hook 历史兼容层。
 * 职责：保留旧路径并转发到 features/terminal 的核心实现。
 */
import useTerminalRuntimeCore from "@/features/terminal/hooks/useTerminalRuntimeCore";

/**
 * 兼容层：保留历史导入路径，实际实现已迁移到 features/terminal。
 */
export default function useTerminalRuntime(
  props: Parameters<typeof useTerminalRuntimeCore>[0],
) {
  return useTerminalRuntimeCore(props);
}
