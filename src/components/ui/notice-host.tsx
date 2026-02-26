import Button from "@/components/ui/button";
import { useNotices } from "@/hooks/useNotices";

/** 通用提示容器（Toast + 对话框）。 */
export default function NoticeHost() {
  const { toasts, dialogs, closeDialog } = useNotices();
  const activeDialog = dialogs[dialogs.length - 1] ?? null;

  return (
    <>
      <div className="toast-layer" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-item ${toast.level ?? "info"}`}>
            {toast.title && <strong>{toast.title}</strong>}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {activeDialog && (
        <div className="dialog-overlay" role="presentation">
          <div className="dialog-card" role="alertdialog" aria-modal="true">
            <div className="dialog-title">{activeDialog.title}</div>
            <div className="dialog-body">{activeDialog.message}</div>
            <div className="dialog-actions">
              {activeDialog.cancelLabel && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    activeDialog.onCancel?.();
                    closeDialog(activeDialog.id);
                  }}
                >
                  {activeDialog.cancelLabel}
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  activeDialog.onConfirm?.();
                  closeDialog(activeDialog.id);
                }}
              >
                {activeDialog.confirmLabel ?? "OK"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
