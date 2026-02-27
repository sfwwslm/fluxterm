/**
 * SFTP 状态 Hook 历史兼容层。
 * 职责：保留旧路径并转发到 features/sftp 的核心实现。
 */
import useSftpStateCore from "@/features/sftp/hooks/useSftpStateCore";

/**
 * 兼容层：保留历史导入路径，实际实现已迁移到 features/sftp。
 */
export default function useSftpState(
  props: Parameters<typeof useSftpStateCore>[0],
) {
  return useSftpStateCore(props);
}
