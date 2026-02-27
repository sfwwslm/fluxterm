/**
 * 会话 Hook 历史兼容层。
 * 职责：保留旧路径并转发到 features/session 的核心实现。
 */
import useSessionStateCore from "@/features/session/hooks/useSessionStateCore";

/**
 * 兼容层：保留历史导入路径，实际实现已迁移到 features/session。
 */
export default function useSessionState(
  props: Parameters<typeof useSessionStateCore>[0],
) {
  return useSessionStateCore(props);
}
