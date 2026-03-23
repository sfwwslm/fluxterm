export type SecurityProvider = "embedded" | "user_password";

/** 安全状态视图。 */
export type SecurityStatus = {
  provider: SecurityProvider;
  locked: boolean;
  encryptionEnabled: boolean;
};
