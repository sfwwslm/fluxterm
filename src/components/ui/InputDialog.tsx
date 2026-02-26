import { useEffect, useState } from "react";
import Modal from "@/components/terminal/modals/Modal";
import Button from "@/components/ui/button";
import "@/components/ui/InputDialog.css";

type InputDialogProps = {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmText: string;
  cancelText: string;
  closeText: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
};

/** 通用文本输入弹窗。 */
export default function InputDialog({
  open,
  title,
  label,
  placeholder,
  initialValue = "",
  confirmText,
  cancelText,
  closeText,
  onClose,
  onConfirm,
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Modal
      open={open}
      title={title}
      closeLabel={closeText}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {cancelText}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onConfirm(value.trim());
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="input-dialog-body">
        <label>{label}</label>
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onConfirm(value.trim());
          }}
        />
      </div>
    </Modal>
  );
}
