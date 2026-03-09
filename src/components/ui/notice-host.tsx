import Button from "@/components/ui/button";
import { useNotices } from "@/hooks/useNotices";
import "@/components/ui/notice-host.css";

/**
 * 全局通知宿主组件。
 * 职责：作为全局交互反馈层的渲染入口。
 * 1. 渲染自动消失的 Toast 消息。
 * 2. 渲染命令式弹出的 Dialog 确认框（如删除确认、错误提示等）。
 * 交互：Dialog 遮罩层特意避开了标题栏，以便在弹窗时依然可以关闭或最小化应用。
 */
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
                variant="ghost"
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
