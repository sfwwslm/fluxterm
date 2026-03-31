import { useEffect, useMemo, useRef, useState } from "react";
import type { Translate } from "@/i18n";
import type { LocalShellConfig, LocalShellProfile } from "@/types";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import {
  DEFAULT_LOCAL_SHELL_CONFIG,
  normalizeLocalShellConfig,
} from "@/constants/localShellConfig";
import { TERMINAL_BELL_COOLDOWN_OPTIONS } from "@/constants/terminalBell";
import {
  TERMINAL_WORD_SEPARATORS_PRESET_A,
  TERMINAL_WORD_SEPARATORS_PRESET_B,
} from "@/constants/terminalWordSeparators";
import "@/main/components/modals/ProfileModal.css";

type LocalShellProfileModalProps = {
  open: boolean;
  shell: LocalShellProfile | null;
  draft: LocalShellConfig;
  onDraftChange: (draft: LocalShellConfig) => void;
  onClose: () => void;
  onSubmit: () => void;
  t: Translate;
};

type LocalShellSection = "terminal" | "window";

/** 本地 Shell 终端配置编辑弹窗。 */
export default function LocalShellProfileModal({
  open,
  shell,
  draft,
  onDraftChange,
  onClose,
  onSubmit,
  t,
}: LocalShellProfileModalProps) {
  const wasOpenRef = useRef(false);
  const [activeSection, setActiveSection] =
    useState<LocalShellSection>("terminal");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState("");

  const normalizedDraft = useMemo(
    () => normalizeLocalShellConfig(draft),
    [draft],
  );

  useEffect(() => {
    const becameOpen = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (becameOpen) {
      queueMicrotask(() => {
        setShowDiscardConfirm(false);
        setInitialDraftSnapshot(JSON.stringify(normalizedDraft));
        setActiveSection("terminal");
      });
    }
  }, [open, normalizedDraft]);

  const hasUnsavedChanges =
    open && JSON.stringify(normalizedDraft) !== initialDraftSnapshot;

  const terminalOptions = useMemo(
    () => [
      { value: "xterm-256color", label: "xterm-256color" },
      { value: "xterm", label: "xterm" },
      { value: "screen-256color", label: "screen-256color" },
      { value: "tmux-256color", label: "tmux-256color" },
      { value: "vt100", label: "vt100" },
    ],
    [],
  );
  const charsetOptions = useMemo(
    () => [
      { value: "utf-8", label: "UTF-8" },
      { value: "gbk", label: "GBK" },
      { value: "gb18030", label: "GB18030" },
    ],
    [],
  );
  const bellModeOptions = useMemo(
    () => [
      { value: "silent", label: t("profile.terminal.bellMode.silent") },
      { value: "sound", label: t("profile.terminal.bellMode.sound") },
    ],
    [t],
  );
  const bellCooldownOptions = useMemo(
    () =>
      TERMINAL_BELL_COOLDOWN_OPTIONS.map((value) => ({
        value: String(value),
        label: t("profile.terminal.bellCooldown.option", {
          seconds: (value / 1000).toString(),
        }),
      })),
    [t],
  );

  function handleRequestClose() {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  }

  function handleRestoreDefaults() {
    setActiveSection("terminal");
    onDraftChange(DEFAULT_LOCAL_SHELL_CONFIG);
  }

  function renderSectionContent() {
    if (activeSection === "window") {
      return (
        <div className="host-editor">
          <div className="form-row">
            <label className="form-label">
              {t("profile.window.wordSeparators")}
            </label>
            <input
              value={
                normalizedDraft.wordSeparators ??
                DEFAULT_LOCAL_SHELL_CONFIG.wordSeparators
              }
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
    }

    return (
      <div className="profile-settings-page">
        <section className="profile-settings-section">
          <header className="profile-settings-section-header">
            <div>
              <h4>{t("profile.localShell.section.basic")}</h4>
            </div>
          </header>
          <div className="profile-settings-section-body host-editor">
            <div className="form-row">
              <label className="form-label">
                {t("profile.sessionTab.terminal")}
              </label>
              <Select
                value={
                  normalizedDraft.terminalType ??
                  DEFAULT_LOCAL_SHELL_CONFIG.terminalType
                }
                options={terminalOptions}
                onChange={(value) =>
                  onDraftChange({
                    ...draft,
                    terminalType: value as NonNullable<
                      LocalShellConfig["terminalType"]
                    >,
                  })
                }
                aria-label={t("profile.sessionTab.terminal")}
              />
            </div>
            <div className="form-row">
              <label className="form-label">
                {t("profile.sessionTab.charset")}
              </label>
              <Select
                value={
                  normalizedDraft.charset ?? DEFAULT_LOCAL_SHELL_CONFIG.charset
                }
                options={charsetOptions}
                onChange={(value) =>
                  onDraftChange({
                    ...draft,
                    charset: value as NonNullable<LocalShellConfig["charset"]>,
                  })
                }
                aria-label={t("profile.sessionTab.charset")}
              />
            </div>
          </div>
        </section>
        <section className="profile-settings-section">
          <header className="profile-settings-section-header">
            <div>
              <h4>{t("profile.terminal.group.bell")}</h4>
            </div>
          </header>
          <div className="profile-settings-section-body host-editor">
            <div className="form-row">
              <label className="form-label">
                {t("profile.terminal.bellMode")}
              </label>
              <Select
                value={
                  normalizedDraft.bellMode ??
                  DEFAULT_LOCAL_SHELL_CONFIG.bellMode
                }
                options={bellModeOptions}
                onChange={(value) =>
                  onDraftChange({
                    ...draft,
                    bellMode: value as NonNullable<
                      LocalShellConfig["bellMode"]
                    >,
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
                  draft.bellCooldownMs ??
                    normalizedDraft.bellCooldownMs ??
                    DEFAULT_LOCAL_SHELL_CONFIG.bellCooldownMs,
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
  }

  return (
    <>
      <Modal
        open={open}
        title={
          shell
            ? t("profile.localShell.modal.title", { name: shell.label })
            : t("profile.localShell.modal.fallbackTitle")
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
              <Button variant="ghost" onClick={handleRequestClose}>
                {t("actions.cancel")}
              </Button>
              <Button variant="ghost" onClick={onSubmit}>
                {t("actions.save")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="profile-modal">
          <div className="profile-modal-layout">
            <nav className="profile-modal-nav">
              <button
                type="button"
                className={`profile-modal-nav-item ${activeSection === "terminal" ? "active" : ""}`}
                onClick={() => setActiveSection("terminal")}
              >
                {t("profile.section.terminal")}
              </button>
              <button
                type="button"
                className={`profile-modal-nav-item ${activeSection === "window" ? "active" : ""}`}
                onClick={() => setActiveSection("window")}
              >
                {t("profile.section.window")}
              </button>
            </nav>
            <section className="profile-modal-content">
              {shell ? (
                <div className="profile-settings-page">
                  <section className="profile-settings-section">
                    <header className="profile-settings-section-header">
                      <div>
                        <h4>{shell.label}</h4>
                        <p>{shell.path}</p>
                      </div>
                    </header>
                  </section>
                  {renderSectionContent()}
                </div>
              ) : null}
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
