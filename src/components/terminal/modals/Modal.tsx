import type React from "react";
import Button from "@/components/ui/button";

type ModalProps = {
  open: boolean;
  title: string;
  actions?: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
};

/** 通用模态框组件。 */
export default function Modal({
  open,
  title,
  actions,
  closeLabel,
  onClose,
  children,
}: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <Button className="ghost" variant="ghost" size="sm" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
