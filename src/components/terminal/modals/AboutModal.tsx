import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Translate } from "@/i18n";
import Modal from "@/components/terminal/modals/Modal";
import { APP_VERSION, COMMIT_HASH, TOOLCHAIN_INFO } from "@/appInfo";

type AboutModalProps = {
  open: boolean;
  onClose: () => void;
  t: Translate;
};

/** 关于弹窗。 */
export default function AboutModal({ open, onClose, t }: AboutModalProps) {
  const [version, setVersion] = useState(APP_VERSION);

  useEffect(() => {
    const hasTauriRuntime =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!hasTauriRuntime) return;
    getVersion()
      .then((value) => setVersion(value))
      .catch(() => {});
  }, []);

  return (
    <Modal
      open={open}
      title={t("about.title")}
      closeLabel={t("actions.close")}
      onClose={onClose}
    >
      <div className="about-list">
        <div className="about-row">
          <span>{t("about.version")}</span>
          <strong>{version}</strong>
        </div>
        <div className="about-row">
          <span>{t("about.commit")}</span>
          <strong>{COMMIT_HASH}</strong>
        </div>
        <div className="about-row">
          <span>{t("about.toolchain")}</span>
          <strong>{TOOLCHAIN_INFO}</strong>
        </div>
      </div>
    </Modal>
  );
}
