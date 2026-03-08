import { createContext, useContext } from "react";

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

export type ToastItem = ToastPayload & { id: string };
export type DialogItem = DialogPayload & { id: string };

export type NoticesContextValue = {
  toasts: ToastItem[];
  dialogs: DialogItem[];
  pushToast: (payload: ToastPayload) => void;
  openDialog: (payload: DialogPayload) => void;
  closeDialog: (id: string) => void;
};

export const NoticesContext = createContext<NoticesContextValue | null>(null);

export function useNotices() {
  const ctx = useContext(NoticesContext);
  if (!ctx) {
    throw new Error("useNotices must be used within NoticesProvider");
  }
  return ctx;
}
