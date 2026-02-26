import { useEffect, useRef } from "react";
import type { Translate } from "@/i18n";
import type { HostProfile } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import Modal from "@/components/terminal/modals/Modal";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";

type ProfileModalProps = {
  open: boolean;
  mode: "new" | "edit";
  draft: HostProfile;
  onDraftChange: (draft: HostProfile) => void;
  onClose: () => void;
  onSubmit: () => void;
  t: Translate;
};

/** 主机配置编辑弹窗。 */
export default function ProfileModal({
  open,
  mode,
  draft,
  onDraftChange,
  onClose,
  onSubmit,
  t,
}: ProfileModalProps) {
  const autoFilledRef = useRef(false);

  useEffect(() => {
    if (open) {
      autoFilledRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (draft.authType !== "privateKey") return;
    if (draft.privateKeyPath) return;
    if (autoFilledRef.current) return;
    autoFilledRef.current = true;
    invoke<string[]>("local_ssh_keys")
      .then((keys) => {
        if (!keys.length) return;
        onDraftChange({ ...draft, privateKeyPath: keys[0] });
      })
      .catch(() => {});
  }, [draft, onDraftChange]);

  /** 打开文件选择器并写入私钥路径。 */
  async function handlePickPrivateKey() {
    try {
      const selection = await openFileDialog({
        title: t("profile.form.privateKeyPath"),
        multiple: false,
        directory: false,
      });
      if (!selection || Array.isArray(selection)) return;
      onDraftChange({ ...draft, privateKeyPath: selection });
    } catch {
      // 忽略选择器异常。
    }
  }

  return (
    <Modal
      open={open}
      title={
        mode === "new"
          ? t("profile.modal.newTitle")
          : t("profile.modal.editTitle")
      }
      closeLabel={t("actions.close")}
      onClose={onClose}
      actions={
        <>
          <Button className="ghost" variant="ghost" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button className="primary" variant="primary" onClick={onSubmit}>
            {t("actions.save")}
          </Button>
        </>
      }
    >
      <div className="host-editor">
        <div className="form-row">
          <label>{t("profile.form.name")}</label>
          <input
            value={draft.name}
            onChange={(event) =>
              onDraftChange({ ...draft, name: event.target.value })
            }
            placeholder={t("profile.placeholder.name")}
          />
        </div>
        <div className="form-row">
          <label>{t("profile.form.host")}</label>
          <input
            value={draft.host}
            onChange={(event) =>
              onDraftChange({ ...draft, host: event.target.value })
            }
            placeholder={t("profile.placeholder.host")}
          />
        </div>
        <div className="form-row split">
          <div>
            <label>{t("profile.form.port")}</label>
            <input
              type="number"
              value={draft.port}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  port: Number(event.target.value),
                })
              }
            />
          </div>
          <div>
            <label>{t("profile.form.username")}</label>
            <input
              value={draft.username}
              onChange={(event) =>
                onDraftChange({ ...draft, username: event.target.value })
              }
            />
          </div>
        </div>
        <div className="form-row">
          <label>{t("profile.form.authType")}</label>
          <Select
            value={draft.authType}
            options={[
              { value: "password", label: t("profile.auth.password") },
              { value: "privateKey", label: t("profile.auth.privateKey") },
            ]}
            onChange={(next) =>
              onDraftChange({
                ...draft,
                authType: next as HostProfile["authType"],
              })
            }
            aria-label={t("profile.form.authType")}
          />
        </div>
        {draft.authType === "password" && (
          <div className="form-row">
            <label>{t("profile.form.password")}</label>
            <input
              type="password"
              value={draft.passwordRef ?? ""}
              onChange={(event) =>
                onDraftChange({ ...draft, passwordRef: event.target.value })
              }
            />
          </div>
        )}
        {draft.authType === "privateKey" && (
          <>
            <div className="form-row">
              <label>{t("profile.form.privateKeyPath")}</label>
              <div className="form-file">
                <input
                  value={draft.privateKeyPath ?? ""}
                  placeholder={t("profile.placeholder.privateKeyPath")}
                  readOnly
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePickPrivateKey}
                >
                  {t("profile.actions.pickKey")}
                </Button>
              </div>
            </div>
            <div className="form-row">
              <label>{t("profile.form.privateKeyPassphrase")}</label>
              <input
                type="password"
                value={draft.privateKeyPassphraseRef ?? ""}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    privateKeyPassphraseRef: event.target.value,
                  })
                }
              />
            </div>
          </>
        )}
        <div className="form-row">
          <label>{t("profile.form.group")}</label>
          <input
            value={draft.tags?.[0] ?? ""}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                tags: event.target.value ? [event.target.value] : null,
              })
            }
            placeholder={t("profile.placeholder.group")}
          />
        </div>
      </div>
    </Modal>
  );
}
