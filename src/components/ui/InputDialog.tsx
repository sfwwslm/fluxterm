import { useEffect, useState } from "react";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import "@/components/ui/InputDialog.css";

type InputDialogProps = {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  maxLength?: number;
  errorText?: string | null;
  confirmText: string;
  cancelText: string;
  closeText: string;
  onClose: () => void;
  onValueChange?: (value: string) => void;
  onConfirm: (value: string) => void;
};

/** 通用文本输入弹窗。 */
export default function InputDialog({
  open,
  title,
  label,
  placeholder,
  initialValue = "",
  maxLength,
  errorText,
  confirmText,
  cancelText,
  closeText,
  onClose,
  onValueChange,
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
          maxLength={maxLength}
          onChange={(event) => {
            setValue(event.target.value);
            // 输入变更后通知外层清理校验错误，避免旧错误文案残留。
            onValueChange?.(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onConfirm(value.trim());
          }}
        />
        {errorText ? (
          <div className="input-dialog-error">{errorText}</div>
        ) : null}
      </div>
    </Modal>
  );
}
