import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type React from "react";

export type ToastLevel = "info" | "success" | "error";

export type ToastPayload = {
  title?: string;
  message: string;
  level?: ToastLevel;
  durationMs?: number;
};

export type DialogPayload = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
};

type ToastItem = ToastPayload & { id: string };
type DialogItem = DialogPayload & { id: string };

type NoticesContextValue = {
  toasts: ToastItem[];
  dialogs: DialogItem[];
  pushToast: (payload: ToastPayload) => void;
  openDialog: (payload: DialogPayload) => void;
  closeDialog: (id: string) => void;
};

const NoticesContext = createContext<NoticesContextValue | null>(null);

function buildId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 通用提示（Toast/对话框）管理。 */
export function NoticesProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialogs, setDialogs] = useState<DialogItem[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  const closeDialog = useCallback((id: string) => {
    setDialogs((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback((payload: ToastPayload) => {
    const id = buildId("toast");
    const next: ToastItem = {
      id,
      level: payload.level ?? "info",
      durationMs: payload.durationMs ?? 2600,
      ...payload,
    };
    setToasts((prev) => [next, ...prev].slice(0, 4));
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
      delete timersRef.current[id];
    }, next.durationMs);
    timersRef.current[id] = timer;
  }, []);

  const openDialog = useCallback((payload: DialogPayload) => {
    const id = buildId("dialog");
    const next: DialogItem = { id, ...payload };
    setDialogs((prev) => prev.concat(next));
  }, []);

  const value = useMemo(
    () => ({ toasts, dialogs, pushToast, openDialog, closeDialog }),
    [toasts, dialogs, pushToast, openDialog, closeDialog],
  );

  return (
    <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>
  );
}

export function useNotices() {
  const ctx = useContext(NoticesContext);
  if (!ctx) {
    throw new Error("useNotices must be used within NoticesProvider");
  }
  return ctx;
}
