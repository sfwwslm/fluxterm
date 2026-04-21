import { useEffect, useState } from "react";
import {
  securityChangePassword,
  securityEnableStrongProtection,
  securityEnableWeakProtection,
  securityLock,
  securityStatusGet,
  securityUnlock,
} from "@/features/security/core/commands";
import type { SecurityStatus } from "@/features/security/types";
import { extractErrorMessage } from "@/shared/errors/appError";
import { scheduleDeferredTask } from "@/hooks/useDeferredEffect";

const DEFAULT_SECURITY_STATUS: SecurityStatus = {
  provider: "embedded",
  locked: false,
  encryptionEnabled: true,
};

type UseSecurityResult = {
  status: SecurityStatus;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<SecurityStatus>;
  unlock: (password: string) => Promise<SecurityStatus>;
  lock: () => Promise<SecurityStatus>;
  enableStrongProtection: (password: string) => Promise<SecurityStatus>;
  changePassword: (
    currentPassword: string,
    nextPassword: string,
  ) => Promise<SecurityStatus>;
  enableWeakProtection: () => Promise<SecurityStatus>;
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
    const cancel = scheduleDeferredTask(() => {
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
    });
    return () => {
      cancel();
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
    enableStrongProtection: (password) =>
      runAction(() => securityEnableStrongProtection(password)),
    changePassword: (currentPassword, nextPassword) =>
      runAction(() => securityChangePassword(currentPassword, nextPassword)),
    enableWeakProtection: () => runAction(() => securityEnableWeakProtection()),
  };
}
