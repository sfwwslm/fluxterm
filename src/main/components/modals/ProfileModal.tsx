import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const formId = useId();
  const autoFilledRef = useRef(false);
  const wasOpenRef = useRef(false);
  const [activeSection, setActiveSection] =
    useState<ProfileModalSection>("session");
  const [nameError, setNameError] = useState<string | null>(null);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState("");

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    const becameOpen = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (becameOpen) {
      autoFilledRef.current = false;
      queueMicrotask(() => {
        setShowDiscardConfirm(false);
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

  /** 为列表中的某个私钥项选择文件，或追加新的私钥项。 */
  async function handlePickIdentityFile(index?: number) {
    try {
      const selection = await openFileDialog({
        title: t("profile.form.identityFiles"),
        multiple: false,
        directory: false,
      });
      if (!selection || Array.isArray(selection)) return;
      const nextIdentityFiles = [
        ...(draft.identityFiles?.length
          ? draft.identityFiles
          : draft.privateKeyPath
            ? [draft.privateKeyPath]
            : []),
      ];
      if (
        typeof index === "number" &&
        index >= 0 &&
        index < nextIdentityFiles.length
      ) {
        nextIdentityFiles[index] = selection;
      } else {
        nextIdentityFiles.push(selection);
      }
      onDraftChange({
        ...draft,
        identityFiles: nextIdentityFiles,
        privateKeyPath: nextIdentityFiles[0] ?? null,
      });
    } catch {
      // 忽略选择器异常。
    }
  }

  /** 选择附加 known_hosts 文件。 */
  async function handlePickUserKnownHostsFile() {
    try {
      const selection = await openFileDialog({
        title: t("profile.form.userKnownHostsFile"),
        multiple: false,
        directory: false,
      });
      if (!selection || Array.isArray(selection)) return;
      onDraftChange({
        ...draft,
        userKnownHostsFile: selection,
      });
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

  /** 统一处理关闭请求：有未保存草稿时显示 UI 确认框而非阻塞式系统对话框。 */
  function handleRequestClose() {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
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
      identityFiles: null,
      privateKeyPassphraseRef: null,
      passwordRef: null,
      knownHost: null,
      proxyCommand: null,
      proxyJump: null,
      addKeysToAgent: null,
      userKnownHostsFile: null,
      strictHostKeyChecking: null,
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
    const nameInputId = `${formId}-name`;
    const terminalTypeSelectId = `${formId}-terminal-type`;
    const targetSystemSelectId = `${formId}-target-system`;
    const descriptionInputId = `${formId}-description`;
    const wordSeparatorsInputId = `${formId}-word-separators`;
    const groupSelectId = `${formId}-group`;
    const hostInputId = `${formId}-host`;
    const portInputId = `${formId}-port`;
    const usernameInputId = `${formId}-username`;
    const authTypeSelectId = `${formId}-auth-type`;
    const passwordInputId = `${formId}-password`;
    const privateKeyPathInputId = `${formId}-private-key-path`;
    const privateKeyPassphraseInputId = `${formId}-private-key-passphrase`;
    const strictHostKeyCheckingSelectId = `${formId}-strict-host-key-checking`;
    const proxyJumpInputId = `${formId}-proxy-jump`;
    const proxyCommandInputId = `${formId}-proxy-command`;
    const userKnownHostsFileInputId = `${formId}-user-known-hosts-file`;
    const addKeysToAgentInputId = `${formId}-add-keys-to-agent`;
    const bellModeSelectId = `${formId}-bell-mode`;
    const bellCooldownSelectId = `${formId}-bell-cooldown`;
    const identityFiles = draft.identityFiles?.length
      ? draft.identityFiles
      : draft.privateKeyPath
        ? [draft.privateKeyPath]
        : [];
    const strictHostKeyCheckingValue =
      draft.strictHostKeyChecking === null ||
      typeof draft.strictHostKeyChecking === "undefined"
        ? "inherit"
        : draft.strictHostKeyChecking
          ? "strict"
          : "off";
    const proxyJumpEnabled = Boolean(draft.proxyJump?.trim());

    const nameRow = (
      <div className="form-row">
        <label className="form-label" htmlFor={nameInputId}>
          {t("profile.form.name")}
        </label>
        <input
          id={nameInputId}
          value={draft.name}
          maxLength={PROFILE_NAME_MAX_LENGTH}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
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
          <label className="form-label" htmlFor={terminalTypeSelectId}>
            {t("profile.sessionTab.terminal")}
          </label>
          <Select
            id={terminalTypeSelectId}
            value={draft.terminalType ?? "xterm-256color"}
            options={terminalOptions}
            onChange={(value) =>
              onDraftChange({ ...draft, terminalType: value })
            }
            aria-label={t("profile.sessionTab.terminal")}
          />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor={targetSystemSelectId}>
            {t("profile.sessionTab.system")}
          </label>
          <Select
            id={targetSystemSelectId}
            value={draft.targetSystem ?? "auto"}
            options={systemOptions}
            onChange={(value) =>
              onDraftChange({ ...draft, targetSystem: value })
            }
            aria-label={t("profile.sessionTab.system")}
          />
        </div>
        <div className="form-row form-row-textarea">
          <label className="form-label" htmlFor={descriptionInputId}>
            {t("profile.sessionTab.description")}
          </label>
          <textarea
            id={descriptionInputId}
            rows={4}
            value={draft.description ?? ""}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) =>
              onDraftChange({ ...draft, description: event.target.value })
            }
          />
        </div>
      </>
    );

    const windowRows = (
      <div className="profile-settings-page">
        <section className="profile-settings-section">
          <div className="profile-settings-section-body host-editor">
            <div className="form-row">
              <label className="form-label" htmlFor={wordSeparatorsInputId}>
                {t("profile.window.wordSeparators")}
              </label>
              <input
                id={wordSeparatorsInputId}
                value={draft.wordSeparators ?? DEFAULT_TERMINAL_WORD_SEPARATORS}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
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
              <span className="form-label">{t("profile.window.presets")}</span>
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
        </section>
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
              <label className="form-label" htmlFor={bellModeSelectId}>
                {t("profile.terminal.bellMode")}
              </label>
              <Select
                id={bellModeSelectId}
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
              <label className="form-label" htmlFor={bellCooldownSelectId}>
                {t("profile.terminal.bellCooldown")}
              </label>
              <Select
                id={bellCooldownSelectId}
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
            <label className="form-label" htmlFor={groupSelectId}>
              {t("profile.form.group")}
            </label>
            <Select
              id={groupSelectId}
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
            <label className="form-label" htmlFor={hostInputId}>
              {t("profile.form.host")}
            </label>
            <input
              id={hostInputId}
              value={draft.host}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) =>
                onDraftChange({ ...draft, host: event.target.value })
              }
              placeholder={t("profile.placeholder.host")}
            />
          </div>
          <div className="form-row split">
            <div className="form-inline-field">
              <label className="form-label" htmlFor={portInputId}>
                {t("profile.form.port")}
              </label>
              <input
                id={portInputId}
                type="number"
                value={draft.port}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    port: Number(event.target.value),
                  })
                }
              />
            </div>
            <div className="form-inline-field">
              <label className="form-label" htmlFor={usernameInputId}>
                {t("profile.form.username")}
              </label>
              <input
                id={usernameInputId}
                value={draft.username}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) =>
                  onDraftChange({ ...draft, username: event.target.value })
                }
              />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor={authTypeSelectId}>
              {t("profile.form.authType")}
            </label>
            <Select
              id={authTypeSelectId}
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
              <label className="form-label" htmlFor={passwordInputId}>
                {t("profile.form.password")}
              </label>
              <input
                id={passwordInputId}
                type="password"
                value={draft.passwordRef ?? ""}
                autoComplete="off"
                onChange={(event) =>
                  onDraftChange({ ...draft, passwordRef: event.target.value })
                }
              />
            </div>
          )}
          {draft.authType === "privateKey" && (
            <div className="form-row">
              <label
                className="form-label"
                htmlFor={privateKeyPassphraseInputId}
              >
                {t("profile.form.privateKeyPassphrase")}
              </label>
              <input
                id={privateKeyPassphraseInputId}
                type="password"
                value={draft.privateKeyPassphraseRef ?? ""}
                autoComplete="off"
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    privateKeyPassphraseRef: event.target.value,
                  })
                }
              />
            </div>
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
        <div className="profile-settings-page" data-page="profile-ssh">
          <section className="profile-settings-section" data-ui="ssh-auth">
            <header className="profile-settings-section-header">
              <div>
                <h4>{t("profile.ssh.group.auth")}</h4>
                <p>{t("profile.ssh.group.authHint")}</p>
              </div>
            </header>
            <div className="profile-settings-section-body host-editor">
              {draft.authType === "privateKey" ? (
                <>
                  <div className="form-row">
                    <label
                      className="form-label"
                      htmlFor={privateKeyPathInputId}
                    >
                      {t("profile.form.privateKeyPath")}
                    </label>
                    <div className="form-file">
                      <input
                        id={privateKeyPathInputId}
                        value={draft.privateKeyPath ?? ""}
                        placeholder={t("profile.placeholder.privateKeyPath")}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        readOnly
                        data-ui="identity-file-primary"
                        data-slot="primary-path"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        data-ui="identity-file-pick-primary"
                        data-slot="pick-primary"
                        onClick={() => {
                          void handlePickPrivateKey();
                        }}
                      >
                        {t("profile.actions.pickKey")}
                      </Button>
                    </div>
                    <div className="profile-form-hint">
                      {t("profile.ssh.identityFilesHint")}
                    </div>
                  </div>
                  <div className="form-row form-row-align-start">
                    <span className="form-label">
                      {t("profile.form.identityFiles")}
                    </span>
                    <div
                      className="profile-identity-files"
                      data-ui="identity-files"
                    >
                      {identityFiles.length ? (
                        identityFiles.map((item, index) => (
                          <div
                            key={`${item}-${index}`}
                            className="profile-identity-file-row"
                            data-slot={`identity-file-row-${index}`}
                          >
                            <input
                              value={item}
                              placeholder={t(
                                "profile.placeholder.privateKeyPath",
                              )}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              onChange={(event) => {
                                const next = [...identityFiles];
                                next[index] = event.target.value;
                                onDraftChange({
                                  ...draft,
                                  identityFiles: next,
                                  privateKeyPath: next[0] ?? null,
                                });
                              }}
                              data-ui="identity-file-input"
                              data-slot={`identity-file-${index}`}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              data-ui="identity-file-pick"
                              data-slot={`pick-identity-file-${index}`}
                              onClick={() => {
                                void handlePickIdentityFile(index);
                              }}
                            >
                              {t("profile.actions.pickKey")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={index === 0}
                              data-ui="identity-file-up"
                              data-slot={`move-up-${index}`}
                              onClick={() => {
                                if (index === 0) return;
                                const next = [...identityFiles];
                                [next[index - 1], next[index]] = [
                                  next[index],
                                  next[index - 1],
                                ];
                                onDraftChange({
                                  ...draft,
                                  identityFiles: next,
                                  privateKeyPath: next[0] ?? null,
                                });
                              }}
                            >
                              {t("profile.actions.moveUp")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={index === identityFiles.length - 1}
                              data-ui="identity-file-down"
                              data-slot={`move-down-${index}`}
                              onClick={() => {
                                if (index >= identityFiles.length - 1) return;
                                const next = [...identityFiles];
                                [next[index], next[index + 1]] = [
                                  next[index + 1],
                                  next[index],
                                ];
                                onDraftChange({
                                  ...draft,
                                  identityFiles: next,
                                  privateKeyPath: next[0] ?? null,
                                });
                              }}
                            >
                              {t("profile.actions.moveDown")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-ui="identity-file-remove"
                              data-slot={`remove-identity-file-${index}`}
                              onClick={() => {
                                const next = identityFiles.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                );
                                onDraftChange({
                                  ...draft,
                                  identityFiles: next.length ? next : null,
                                  privateKeyPath: next[0] ?? null,
                                });
                              }}
                            >
                              {t("actions.remove")}
                            </Button>
                          </div>
                        ))
                      ) : (
                        <div className="profile-form-hint">
                          {t("profile.ssh.identityFilesEmpty")}
                        </div>
                      )}
                      <div className="profile-identity-files-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          data-ui="identity-file-add"
                          data-slot="identity-file-add"
                          onClick={() => {
                            void handlePickIdentityFile();
                          }}
                        >
                          {t("profile.actions.addIdentityFile")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="profile-form-hint">
                  {t("profile.ssh.identityFilesDisabled")}
                </div>
              )}
            </div>
          </section>
          <section className="profile-settings-section" data-ui="ssh-proxy">
            <header className="profile-settings-section-header">
              <div>
                <h4>{t("profile.ssh.group.proxy")}</h4>
                <p>{t("profile.ssh.group.proxyHint")}</p>
              </div>
            </header>
            <div className="profile-settings-section-body host-editor">
              <div className="form-row">
                <label className="form-label" htmlFor={proxyJumpInputId}>
                  {t("profile.form.proxyJump")}
                </label>
                <input
                  id={proxyJumpInputId}
                  value={draft.proxyJump ?? ""}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t("profile.placeholder.proxyJump")}
                  onChange={(event) =>
                    onDraftChange({ ...draft, proxyJump: event.target.value })
                  }
                  data-ui="proxy-jump"
                  data-slot="proxy-jump"
                />
                <div className="profile-form-hint">
                  {t("profile.ssh.proxyJumpHint")}
                </div>
              </div>
              <div className="form-row">
                <label className="form-label" htmlFor={proxyCommandInputId}>
                  {t("profile.form.proxyCommand")}
                </label>
                <input
                  id={proxyCommandInputId}
                  value={draft.proxyCommand ?? ""}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t("profile.placeholder.proxyCommand")}
                  disabled={proxyJumpEnabled}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      proxyCommand: event.target.value,
                    })
                  }
                  data-ui="proxy-command"
                  data-slot="proxy-command"
                />
                <div className="profile-form-hint">
                  {proxyJumpEnabled
                    ? t("profile.ssh.proxyCommandDisabledHint")
                    : t("profile.ssh.proxyCommandHint")}
                </div>
              </div>
            </div>
          </section>
          <section className="profile-settings-section" data-ui="ssh-host-key">
            <header className="profile-settings-section-header">
              <div>
                <h4>{t("profile.ssh.group.hostKey")}</h4>
                <p>{t("profile.ssh.group.hostKeyHint")}</p>
              </div>
            </header>
            <div className="profile-settings-section-body host-editor">
              <div className="form-row">
                <label
                  className="form-label"
                  htmlFor={userKnownHostsFileInputId}
                >
                  {t("profile.form.userKnownHostsFile")}
                </label>
                <div className="form-file">
                  <input
                    id={userKnownHostsFileInputId}
                    value={draft.userKnownHostsFile ?? ""}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={t("profile.placeholder.userKnownHostsFile")}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        userKnownHostsFile: event.target.value,
                      })
                    }
                    data-ui="user-known-hosts-file"
                    data-slot="user-known-hosts-file"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    data-ui="user-known-hosts-file-pick"
                    data-slot="pick-user-known-hosts-file"
                    onClick={() => {
                      void handlePickUserKnownHostsFile();
                    }}
                  >
                    {t("profile.actions.pickKey")}
                  </Button>
                </div>
                <div className="profile-form-hint">
                  {t("profile.ssh.userKnownHostsFileHint")}
                </div>
              </div>
              <div className="form-row">
                <label
                  className="form-label"
                  htmlFor={strictHostKeyCheckingSelectId}
                >
                  {t("profile.form.strictHostKeyChecking")}
                </label>
                <Select
                  id={strictHostKeyCheckingSelectId}
                  value={strictHostKeyCheckingValue}
                  options={[
                    {
                      value: "inherit",
                      label: t("profile.ssh.strictHostKeyChecking.inherit"),
                    },
                    {
                      value: "strict",
                      label: t("profile.ssh.strictHostKeyChecking.strict"),
                    },
                    {
                      value: "off",
                      label: t("profile.ssh.strictHostKeyChecking.off"),
                    },
                  ]}
                  onChange={(value) =>
                    onDraftChange({
                      ...draft,
                      strictHostKeyChecking:
                        value === "inherit" ? null : value === "strict",
                    })
                  }
                  aria-label={t("profile.form.strictHostKeyChecking")}
                />
                <div className="profile-form-hint">
                  {t("profile.ssh.strictHostKeyCheckingHint")}
                </div>
              </div>
              <div className="form-row">
                <label className="form-label" htmlFor={addKeysToAgentInputId}>
                  {t("profile.form.addKeysToAgent")}
                </label>
                <input
                  id={addKeysToAgentInputId}
                  value={draft.addKeysToAgent ?? ""}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t("profile.placeholder.addKeysToAgent")}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      addKeysToAgent: event.target.value,
                    })
                  }
                  data-ui="add-keys-to-agent"
                  data-slot="add-keys-to-agent"
                />
                <div className="profile-form-hint">
                  {t("profile.ssh.addKeysToAgentHint")}
                </div>
              </div>
            </div>
          </section>
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
    <>
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

      {showDiscardConfirm && (
        <Modal
          open
          title={
            t("profile.unsavedChangesConfirmTitle") || t("actions.confirm")
          }
          closeLabel={t("actions.close")}
          onClose={() => setShowDiscardConfirm(false)}
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDiscardConfirm(false)}
              >
                {t("profile.actions.continueEditing") || t("actions.cancel")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onClose();
                }}
              >
                {t("profile.actions.discardAndClose") || t("actions.ok")}
              </Button>
            </>
          }
        >
          <div className="profile-discard-confirm-dialog">
            <p>{t("profile.unsavedChangesConfirm")}</p>
          </div>
        </Modal>
      )}
    </>
  );
}
