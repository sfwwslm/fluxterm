import { useEffect, useMemo, useRef, useState } from "react";
import type { Translate } from "@/i18n";
import type { HostProfile } from "@/types";
import { ROOT_PROFILE_GROUP_VALUE } from "@/constants/hostGroups";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import {
  DEFAULT_TERMINAL_BELL_COOLDOWN_MS,
  DEFAULT_TERMINAL_BELL_MODE,
  TERMINAL_BELL_COOLDOWN_OPTIONS,
} from "@/constants/terminalBell";
import {
  DEFAULT_TERMINAL_WORD_SEPARATORS,
  TERMINAL_WORD_SEPARATORS_PRESET_A,
  TERMINAL_WORD_SEPARATORS_PRESET_B,
} from "@/constants/terminalWordSeparators";
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
  const wasOpenRef = useRef(false);
  const [activeSection, setActiveSection] =
    useState<ProfileModalSection>("session");
  const [nameError, setNameError] = useState<string | null>(null);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState("");

  useEffect(() => {
    const becameOpen = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (becameOpen) {
      autoFilledRef.current = false;
      queueMicrotask(() => {
        setInitialDraftSnapshot(JSON.stringify(draft));
        setActiveSection("session");
        setNameError(null);
      });
    }
  }, [open, draft]);

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
    () => ["session", "terminal", "window", "ssh", "modem"],
    [],
  );

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

  const canSubmit = true;
  const hasUnsavedChanges =
    open && JSON.stringify(draft) !== initialDraftSnapshot;

  /** 统一处理关闭请求：有未保存草稿时给出放弃确认。 */
  function handleRequestClose() {
    if (
      hasUnsavedChanges &&
      !window.confirm(t("profile.unsavedChangesConfirm"))
    ) {
      return;
    }
    onClose();
  }

  /** 恢复当前类型对应的默认配置，避免未来选项增多后需要逐项手工回填。 */
  function handleRestoreDefaults() {
    setActiveSection("session");
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
      terminalType: null,
      targetSystem: null,
      charset: null,
      wordSeparators: null,
      bellMode: DEFAULT_TERMINAL_BELL_MODE,
      bellCooldownMs: DEFAULT_TERMINAL_BELL_COOLDOWN_MS,
      description: null,
    });
  }

  function renderSectionContent() {
    const terminalOptions = [
      { value: "xterm-256color", label: "xterm-256color" },
      { value: "xterm", label: "xterm" },
      { value: "screen-256color", label: "screen-256color" },
      { value: "tmux-256color", label: "tmux-256color" },
      { value: "vt100", label: "vt100" },
    ];
    const systemOptions = [
      { value: "auto", label: "Auto" },
      { value: "linux", label: "Linux" },
      { value: "macos", label: "macOS" },
      { value: "windows", label: "Windows" },
    ];
    const bellModeOptions = [
      { value: "silent", label: t("profile.terminal.bellMode.silent") },
      { value: "sound", label: t("profile.terminal.bellMode.sound") },
    ];
    const bellCooldownOptions = TERMINAL_BELL_COOLDOWN_OPTIONS.map((value) => ({
      value: String(value),
      label: t("profile.terminal.bellCooldown.option", {
        seconds: (value / 1000).toString(),
      }),
    }));

    const nameRow = (
      <div className="form-row">
        <label className="form-label">{t("profile.form.name")}</label>
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
    );

    const extraSessionRows = (
      <>
        <div className="form-row">
          <label className="form-label">
            {t("profile.sessionTab.terminal")}
          </label>
          <Select
            value={draft.terminalType ?? "xterm-256color"}
            options={terminalOptions}
            onChange={(value) =>
              onDraftChange({ ...draft, terminalType: value })
            }
            aria-label={t("profile.sessionTab.terminal")}
          />
        </div>
        <div className="form-row">
          <label className="form-label">{t("profile.sessionTab.system")}</label>
          <Select
            value={draft.targetSystem ?? "auto"}
            options={systemOptions}
            onChange={(value) =>
              onDraftChange({ ...draft, targetSystem: value })
            }
            aria-label={t("profile.sessionTab.system")}
          />
        </div>
        <div className="form-row form-row-textarea">
          <label className="form-label">
            {t("profile.sessionTab.description")}
          </label>
          <textarea
            rows={4}
            value={draft.description ?? ""}
            onChange={(event) =>
              onDraftChange({ ...draft, description: event.target.value })
            }
          />
        </div>
      </>
    );

    const windowRows = (
      <div className="host-editor">
        <div className="form-row">
          <label className="form-label">
            {t("profile.window.wordSeparators")}
          </label>
          <input
            value={draft.wordSeparators ?? DEFAULT_TERMINAL_WORD_SEPARATORS}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                wordSeparators: event.target.value,
              })
            }
          />
          <div className="profile-form-hint">
            {t("profile.window.wordSeparatorsHint")}
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">{t("profile.window.presets")}</label>
          <div className="form-file profile-window-presets">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onDraftChange({
                  ...draft,
                  wordSeparators: TERMINAL_WORD_SEPARATORS_PRESET_A,
                })
              }
            >
              {t("profile.window.presetA")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onDraftChange({
                  ...draft,
                  wordSeparators: TERMINAL_WORD_SEPARATORS_PRESET_B,
                })
              }
            >
              {t("profile.window.presetB")}
            </Button>
          </div>
          <div className="profile-form-hint">
            {t("profile.window.applyHint")}
          </div>
        </div>
      </div>
    );

    const terminalRows = (
      <div className="profile-settings-page">
        <section className="profile-settings-section">
          <header className="profile-settings-section-header">
            <div>
              <h4>{t("profile.terminal.group.bell")}</h4>
              <p>{t("profile.terminal.group.bellHint")}</p>
            </div>
          </header>
          <div className="profile-settings-section-body host-editor">
            <div className="form-row">
              <label className="form-label">
                {t("profile.terminal.bellMode")}
              </label>
              <Select
                value={draft.bellMode ?? DEFAULT_TERMINAL_BELL_MODE}
                options={bellModeOptions}
                onChange={(value) =>
                  onDraftChange({
                    ...draft,
                    bellMode: value as NonNullable<HostProfile["bellMode"]>,
                  })
                }
                aria-label={t("profile.terminal.bellMode")}
              />
              <div className="profile-form-hint">
                {t("profile.terminal.bellModeHint")}
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">
                {t("profile.terminal.bellCooldown")}
              </label>
              <Select
                value={String(
                  draft.bellCooldownMs ?? DEFAULT_TERMINAL_BELL_COOLDOWN_MS,
                )}
                options={bellCooldownOptions}
                onChange={(value) =>
                  onDraftChange({
                    ...draft,
                    bellCooldownMs: Number(value),
                  })
                }
                aria-label={t("profile.terminal.bellCooldown")}
              />
              <div className="profile-form-hint">
                {t("profile.terminal.bellCooldownHint")}
              </div>
            </div>
          </div>
        </section>
      </div>
    );

    if (activeSection === "session") {
      return (
        <div className="host-editor">
          {nameRow}
          <div className="form-row">
            <label className="form-label">{t("profile.form.group")}</label>
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
            <label className="form-label">{t("profile.form.host")}</label>
            <input
              value={draft.host}
              onChange={(event) =>
                onDraftChange({ ...draft, host: event.target.value })
              }
              placeholder={t("profile.placeholder.host")}
            />
          </div>
          <div className="form-row split">
            <div className="form-inline-field">
              <label className="form-label">{t("profile.form.port")}</label>
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
            <div className="form-inline-field">
              <label className="form-label">{t("profile.form.username")}</label>
              <input
                value={draft.username}
                onChange={(event) =>
                  onDraftChange({ ...draft, username: event.target.value })
                }
              />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">{t("profile.form.authType")}</label>
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
              <label className="form-label">{t("profile.form.password")}</label>
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
                <label className="form-label">
                  {t("profile.form.privateKeyPath")}
                </label>
                <div className="form-file">
                  <input
                    value={draft.privateKeyPath ?? ""}
                    placeholder={t("profile.placeholder.privateKeyPath")}
                    readOnly
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void handlePickPrivateKey();
                    }}
                  >
                    {t("profile.actions.pickKey")}
                  </Button>
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">
                  {t("profile.form.privateKeyPassphrase")}
                </label>
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
          {extraSessionRows}
        </div>
      );
    }

    if (activeSection === "terminal") {
      return terminalRows;
    }

    if (activeSection === "window") {
      return windowRows;
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
      onClose={handleRequestClose}
      actions={
        <div className="profile-modal-footer">
          <Button variant="ghost" onClick={handleRestoreDefaults}>
            {t("profile.actions.restoreDefaults")}
          </Button>
          <div className="profile-modal-footer-actions">
            <Button
              className="ghost"
              variant="ghost"
              onClick={handleRequestClose}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              className="ghost"
              variant="ghost"
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
            >
              {t("actions.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="profile-modal">
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
