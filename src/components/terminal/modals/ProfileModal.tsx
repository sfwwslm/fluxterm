import type { Translate } from "@/i18n";
import type { HostProfile } from "@/types";
import Modal from "@/components/terminal/modals/Modal";

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
          <button className="ghost" onClick={onClose}>
            {t("actions.cancel")}
          </button>
          <button className="primary" onClick={onSubmit}>
            {t("actions.save")}
          </button>
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
          <select
            value={draft.authType}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                authType: event.target.value as HostProfile["authType"],
              })
            }
          >
            <option value="password">{t("profile.auth.password")}</option>
            <option value="key">{t("profile.auth.key")}</option>
            <option value="agent">{t("profile.auth.agent")}</option>
          </select>
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
        {draft.authType === "key" && (
          <>
            <div className="form-row">
              <label>{t("profile.form.keyPath")}</label>
              <input
                value={draft.keyPath ?? ""}
                onChange={(event) =>
                  onDraftChange({ ...draft, keyPath: event.target.value })
                }
                placeholder="~/.ssh/id_ed25519"
              />
            </div>
            <div className="form-row">
              <label>{t("profile.form.keyPassphrase")}</label>
              <input
                type="password"
                value={draft.keyPassphraseRef ?? ""}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    keyPassphraseRef: event.target.value,
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
