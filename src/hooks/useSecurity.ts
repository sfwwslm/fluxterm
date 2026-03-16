import { useEffect, useState } from "react";
import {
  securityChangePassword,
  securityDisableEncryption,
  securityEnableWithPassword,
  securityLock,
  securityStatusGet,
  securityUnlock,
} from "@/features/security/core/commands";
import type { SecurityStatus } from "@/features/security/types";
import { extractErrorMessage } from "@/shared/errors/appError";

const DEFAULT_SECURITY_STATUS: SecurityStatus = {
  provider: "plaintext",
  locked: false,
  encryptionEnabled: false,
};

type UseSecurityResult = {
  status: SecurityStatus;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<SecurityStatus>;
  unlock: (password: string) => Promise<SecurityStatus>;
  lock: () => Promise<SecurityStatus>;
  enableWithPassword: (password: string) => Promise<SecurityStatus>;
  changePassword: (
    currentPassword: string,
    nextPassword: string,
  ) => Promise<SecurityStatus>;
  disableEncryption: () => Promise<SecurityStatus>;
};

/** 安全配置与主密码状态管理。 */
export default function useSecurity(): UseSecurityResult {
  const [status, setStatus] = useState<SecurityStatus>(DEFAULT_SECURITY_STATUS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAction(
    action: () => Promise<SecurityStatus>,
  ): Promise<SecurityStatus> {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setStatus(next);
      return next;
    } catch (actionError) {
      const message = extractErrorMessage(actionError);
      setError(message);
      throw actionError;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    return runAction(() => securityStatusGet());
  }

  useEffect(() => {
    let active = true;
    setBusy(true);
    securityStatusGet()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setError(null);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(extractErrorMessage(loadError));
      })
      .finally(() => {
        if (!active) return;
        setBusy(false);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return {
    status,
    loaded,
    busy,
    error,
    refresh,
    unlock: (password) => runAction(() => securityUnlock(password)),
    lock: () => runAction(() => securityLock()),
    enableWithPassword: (password) =>
      runAction(() => securityEnableWithPassword(password)),
    changePassword: (currentPassword, nextPassword) =>
      runAction(() => securityChangePassword(currentPassword, nextPassword)),
    disableEncryption: () => runAction(() => securityDisableEncryption()),
  };
}
