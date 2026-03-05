import { useEffect, useMemo, useRef, useState } from "react";
import type { Translate } from "@/i18n";
import type { HostProfile } from "@/types";
import { ROOT_PROFILE_GROUP_VALUE } from "@/constants/hostGroups";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import "@/main/components/modals/ProfileModal.css";

// 与后端 profile_save 的名称校验保持一致，避免保存前后出现不同结果。
const PROFILE_NAME_MAX_LENGTH = 14;

type ProfileModalProps = {
  open: boolean;
  mode: "new" | "edit";
  draft: HostProfile;
  sshGroups: string[];
  onDraftChange: (draft: HostProfile) => void;
  onClose: () => void;
  onSubmit: () => void;
  t: Translate;
};

type ProfileModalType = "shell" | "ssh";
type ProfileModalSection = "session" | "terminal" | "window" | "ssh" | "modem";

/** 主机配置编辑弹窗。 */
export default function ProfileModal({
  open,
  mode,
  draft,
  sshGroups,
  onDraftChange,
  onClose,
  onSubmit,
  t,
}: ProfileModalProps) {
  const autoFilledRef = useRef(false);
  const [profileType, setProfileType] = useState<ProfileModalType>("ssh");
  const [activeSection, setActiveSection] =
    useState<ProfileModalSection>("session");
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      autoFilledRef.current = false;
      setProfileType("ssh");
      setActiveSection("session");
      setNameError(null);
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

  const visibleSections = useMemo<ProfileModalSection[]>(
    () =>
      profileType === "ssh"
        ? ["session", "terminal", "window", "ssh", "modem"]
        : ["session", "terminal", "window"],
    [profileType],
  );

  function handleSwitchProfileType(next: ProfileModalType) {
    setProfileType(next);
    setActiveSection("session");
  }

  /** 当前产品要求会话名称必填，且限制在较短范围内避免列表与标签过度截断。 */
  function validateProfileName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return t("profile.nameRequired");
    }
    if (trimmed.length > PROFILE_NAME_MAX_LENGTH) {
      return t("profile.nameTooLong", { max: PROFILE_NAME_MAX_LENGTH });
    }
    return null;
  }

  /** 当前版本只支持保存 SSH 会话，shell 页签先作为后续本地配置壳层。 */
  const canSubmit = profileType === "ssh";

  /** 恢复当前类型对应的默认配置，避免未来选项增多后需要逐项手工回填。 */
  function handleRestoreDefaults() {
    setActiveSection("session");
    if (profileType !== "ssh") return;
    onDraftChange({
      id: draft.id,
      name: "",
      host: "",
      port: 22,
      username: "",
      authType: "password",
      privateKeyPath: null,
      privateKeyPassphraseRef: null,
      passwordRef: null,
      knownHost: null,
      tags: null,
    });
  }

  function renderSectionContent() {
    if (profileType === "shell") {
      if (activeSection === "session") {
        return (
          <div className="profile-modal-placeholder">
            <h4>{t("profile.section.session")}</h4>
            <p>{t("profile.shell.todo")}</p>
          </div>
        );
      }
      if (activeSection === "terminal") {
        return (
          <div className="profile-modal-placeholder">
            <h4>{t("profile.section.terminal")}</h4>
            <p>{t("profile.shell.terminalTodo")}</p>
          </div>
        );
      }
      return (
        <div className="profile-modal-placeholder">
          <h4>{t("profile.section.window")}</h4>
          <p>{t("profile.shell.windowTodo")}</p>
        </div>
      );
    }

    if (activeSection === "session") {
      return (
        <div className="host-editor">
          <div className="form-row">
            <label>{t("profile.form.name")}</label>
            <input
              value={draft.name}
              maxLength={PROFILE_NAME_MAX_LENGTH}
              onChange={(event) => {
                onDraftChange({ ...draft, name: event.target.value });
                if (nameError) {
                  setNameError(null);
                }
              }}
              placeholder={t("profile.placeholder.name")}
            />
            {nameError ? (
              <div className="profile-form-error">{nameError}</div>
            ) : null}
          </div>
          <div className="form-row">
            <label>{t("profile.form.group")}</label>
            <Select
              value={draft.tags?.[0]?.trim() || ROOT_PROFILE_GROUP_VALUE}
              options={[
                {
                  value: ROOT_PROFILE_GROUP_VALUE,
                  label: t("host.ungrouped"),
                },
                ...sshGroups.map((group) => ({
                  value: group,
                  label: group,
                })),
              ]}
              onChange={(value) =>
                onDraftChange({
                  ...draft,
                  tags: value === ROOT_PROFILE_GROUP_VALUE ? null : [value],
                })
              }
              aria-label={t("profile.form.group")}
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
        </div>
      );
    }

    if (activeSection === "terminal") {
      return (
        <div className="profile-modal-placeholder">
          <h4>{t("profile.section.terminal")}</h4>
          <p>{t("profile.section.terminalHint")}</p>
        </div>
      );
    }

    if (activeSection === "window") {
      return (
        <div className="profile-modal-placeholder">
          <h4>{t("profile.section.window")}</h4>
          <p>{t("profile.section.windowHint")}</p>
        </div>
      );
    }

    if (activeSection === "modem") {
      return (
        <div className="profile-modal-placeholder">
          <h4>{t("profile.section.modem")}</h4>
          <p>{t("profile.section.modemHint")}</p>
        </div>
      );
    }

    if (activeSection === "ssh") {
      return (
        <div className="profile-modal-placeholder">
          <h4>{t("profile.section.ssh")}</h4>
          <p>{t("profile.section.sshHint")}</p>
        </div>
      );
    }

    return (
      <div className="host-editor">
        <div className="profile-modal-placeholder">
          <h4>{t("profile.section.ssh")}</h4>
          <p>{t("profile.section.sshHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      title={
        mode === "new"
          ? t("profile.modal.newTitle")
          : t("profile.modal.editTitle")
      }
      bodyClassName="profile-modal-body"
      closeLabel={t("actions.close")}
      onClose={onClose}
      actions={
        <div className="profile-modal-footer">
          <Button variant="ghost" onClick={handleRestoreDefaults}>
            {t("profile.actions.restoreDefaults")}
          </Button>
          <div className="profile-modal-footer-actions">
            <Button className="ghost" variant="ghost" onClick={onClose}>
              {t("actions.cancel")}
            </Button>
            <Button
              className="primary"
              variant="primary"
              onClick={() => {
                const errorText = validateProfileName(draft.name);
                if (errorText) {
                  setNameError(errorText);
                  return;
                }
                setNameError(null);
                onSubmit();
              }}
              disabled={!canSubmit}
              title={canSubmit ? undefined : t("profile.shell.saveDisabled")}
            >
              {t("actions.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="profile-modal">
        <div className="profile-modal-types">
          {(["shell", "ssh"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`profile-modal-type-tab ${profileType === item ? "active" : ""}`}
              onClick={() => handleSwitchProfileType(item)}
            >
              {t(`profile.type.${item}`)}
            </button>
          ))}
        </div>
        <div className="profile-modal-layout">
          <nav className="profile-modal-nav">
            {visibleSections.map((section) => (
              <button
                key={section}
                type="button"
                className={`profile-modal-nav-item ${activeSection === section ? "active" : ""}`}
                onClick={() => setActiveSection(section)}
              >
                {t(`profile.section.${section}`)}
              </button>
            ))}
          </nav>
          <section className="profile-modal-content">
            {renderSectionContent()}
          </section>
        </div>
      </div>
    </Modal>
  );
}
