import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import "@/components/ui/PathViewDialog.css";

type PathViewDialogProps = {
  open: boolean;
  title: string;
  path: string;
  copyText: string;
  copiedText: string;
  closeText: string;
  onClose: () => void;
};

/** 路径查看弹窗，支持一键复制。 */
export default function PathViewDialog({
  open,
  title,
  path,
  copyText,
  copiedText,
  closeText,
  onClose,
}: PathViewDialogProps) {
  const [copied, setCopied] = useState(false);

  return (
    <Modal
      open={open}
      title={title}
      closeLabel={closeText}
      onClose={() => {
        setCopied(false);
        onClose();
      }}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void (async () => {
              if (!path) return;
              await writeText(path).catch(() => {});
              setCopied(true);
            })();
          }}
        >
          {copied ? copiedText : copyText}
        </Button>
      }
    >
      <div className="path-view-body">
        <div className="path-view-value">{path}</div>
      </div>
    </Modal>
  );
}
