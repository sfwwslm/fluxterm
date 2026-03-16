import { callTauri } from "@/shared/tauri/commands";
import type { SecurityStatus } from "@/features/security/types";

/** 读取当前安全状态。 */
export function securityStatusGet() {
  return callTauri<SecurityStatus>("security_status");
}

/** 使用安全密码解锁当前密文。 */
export function securityUnlock(password: string) {
  return callTauri<SecurityStatus>("security_unlock", { input: { password } });
}

/** 锁定当前安全会话。 */
export function securityLock() {
  return callTauri<SecurityStatus>("security_lock");
}

/** 启用或更换主密码加密。 */
export function securityEnableWithPassword(password: string) {
  return callTauri<SecurityStatus>("security_enable_with_password", {
    input: { password },
  });
}

/** 修改当前安全密码。 */
export function securityChangePassword(
  currentPassword: string,
  nextPassword: string,
) {
  return callTauri<SecurityStatus>("security_change_password", {
    input: {
      currentPassword,
      nextPassword,
    },
  });
}

/** 关闭加密，恢复明文保存。 */
export function securityDisableEncryption() {
  return callTauri<SecurityStatus>("security_disable_encryption");
}
