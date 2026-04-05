import { useEffect, useMemo, useRef, useState } from "react";
import type { Translate } from "@/i18n";
import type { SerialPortInfo, SerialProfile } from "@/types";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import "@/main/components/modals/ProfileModal.css";

type SerialProfileModalProps = {
  open: boolean;
  mode: "new" | "edit";
  draft: SerialProfile;
  groups: string[];
  availablePorts: SerialPortInfo[];
  onDraftChange: (draft: SerialProfile) => void;
  onClose: () => void;
  onSubmit: () => void;
  onRefreshPorts: () => Promise<void>;
  t: Translate;
};

const PROFILE_NAME_MAX_LENGTH = 14;

/** 串口 Profile 编辑弹窗。 */
export default function SerialProfileModal({
  open,
  mode,
  draft,
  groups,
  availablePorts,
  onDraftChange,
  onClose,
  onSubmit,
  onRefreshPorts,
  t,
}: SerialProfileModalProps) {
  const wasOpenRef = useRef(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState("");

  useEffect(() => {
    const becameOpen = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (becameOpen) {
      queueMicrotask(() => {
        setShowDiscardConfirm(false);
        setInitialDraftSnapshot(JSON.stringify(draft));
      });
    }
  }, [draft, open]);

  const hasUnsavedChanges =
    open && JSON.stringify(draft) !== initialDraftSnapshot;

  const portOptions = useMemo(
    () =>
      availablePorts.map((item) => ({
        value: item.path,
        label: item.portName,
      })),
    [availablePorts],
  );
  const dataBitsOptions = [
    { value: "five", label: "5" },
    { value: "six", label: "6" },
    { value: "seven", label: "7" },
    { value: "eight", label: "8" },
  ];
  const stopBitsOptions = [
    { value: "one", label: "1" },
    { value: "two", label: "2" },
  ];
  const parityOptions = [
    { value: "none", label: t("serial.form.parity.none") },
    { value: "odd", label: t("serial.form.parity.odd") },
    { value: "even", label: t("serial.form.parity.even") },
  ];
  const flowControlOptions = [
    { value: "none", label: t("serial.form.flow.none") },
    { value: "software", label: t("serial.form.flow.software") },
    { value: "hardware", label: t("serial.form.flow.hardware") },
  ];
  const lineEndingOptions = [
    { value: "none", label: t("serial.form.lineEnding.none") },
    { value: "lf", label: "LF" },
    { value: "cr", label: "CR" },
    { value: "crLf", label: "CRLF" },
  ];
  const charsetOptions = [
    { value: "utf-8", label: "UTF-8" },
    { value: "gbk", label: "GBK" },
    { value: "gb18030", label: "GB18030" },
  ];

  function handleRequestClose() {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Modal
        open={open}
        title={
          mode === "new"
            ? t("serial.modal.newTitle")
            : t("serial.modal.editTitle")
        }
        bodyClassName="profile-modal-body"
        closeLabel={t("actions.close")}
        onClose={handleRequestClose}
        actions={
          <div className="profile-modal-footer">
            <Button
              variant="ghost"
              onClick={() => {
                void onRefreshPorts();
              }}
            >
              {t("serial.actions.refreshPorts")}
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
        <div className="profile-settings-page">
          <section className="profile-settings-section">
            <header className="profile-settings-section-header">
              <div>
                <h4>{t("serial.section.connection")}</h4>
              </div>
            </header>
            <div className="profile-settings-section-body host-editor">
              <div className="form-row">
                <label className="form-label">{t("profile.form.name")}</label>
                <input
                  value={draft.name}
                  maxLength={PROFILE_NAME_MAX_LENGTH}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) =>
                    onDraftChange({ ...draft, name: event.target.value })
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">{t("profile.form.group")}</label>
                <Select
                  value={draft.tags?.[0] ?? ""}
                  options={[
                    { value: "", label: t("host.ungrouped") },
                    ...groups.map((group) => ({ value: group, label: group })),
                  ]}
                  onChange={(value) =>
                    onDraftChange({
                      ...draft,
                      tags: value ? [value] : null,
                    })
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">{t("serial.form.port")}</label>
                <Select
                  value={draft.portPath}
                  options={portOptions}
                  onChange={(value) =>
                    onDraftChange({ ...draft, portPath: value })
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">
                  {t("serial.form.baudRate")}
                </label>
                <input
                  value={String(draft.baudRate || "")}
                  inputMode="numeric"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      baudRate: Number(event.target.value || 0),
                    })
                  }
                />
              </div>
            </div>
          </section>
          <section className="profile-settings-section">
            <header className="profile-settings-section-header">
              <div>
                <h4>{t("serial.section.parameters")}</h4>
              </div>
            </header>
            <div className="profile-settings-section-body host-editor">
              <div className="form-row">
                <label className="form-label">
                  {t("serial.form.dataBits")}
                </label>
                <Select
                  value={draft.dataBits ?? "eight"}
                  options={dataBitsOptions}
                  onChange={(value) =>
                    onDraftChange({
                      ...draft,
                      dataBits: value as SerialProfile["dataBits"],
                    })
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">
                  {t("serial.form.stopBits")}
                </label>
                <Select
                  value={draft.stopBits ?? "one"}
                  options={stopBitsOptions}
                  onChange={(value) =>
                    onDraftChange({
                      ...draft,
                      stopBits: value as SerialProfile["stopBits"],
                    })
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">{t("serial.form.parity")}</label>
                <Select
                  value={draft.parity ?? "none"}
                  options={parityOptions}
                  onChange={(value) =>
                    onDraftChange({
                      ...draft,
                      parity: value as SerialProfile["parity"],
                    })
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">
                  {t("serial.form.flowControl")}
                </label>
                <Select
                  value={draft.flowControl ?? "none"}
                  options={flowControlOptions}
                  onChange={(value) =>
                    onDraftChange({
                      ...draft,
                      flowControl: value as SerialProfile["flowControl"],
                    })
                  }
                />
              </div>
            </div>
          </section>
          <section className="profile-settings-section">
            <header className="profile-settings-section-header">
              <div>
                <h4>{t("serial.section.terminal")}</h4>
              </div>
            </header>
            <div className="profile-settings-section-body host-editor">
              <div className="form-row">
                <label className="form-label">
                  {t("profile.sessionTab.charset")}
                </label>
                <Select
                  value={draft.charset ?? "utf-8"}
                  options={charsetOptions}
                  onChange={(value) =>
                    onDraftChange({ ...draft, charset: value })
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">
                  {t("serial.form.lineEnding")}
                </label>
                <Select
                  value={draft.lineEnding ?? "lf"}
                  options={lineEndingOptions}
                  onChange={(value) =>
                    onDraftChange({
                      ...draft,
                      lineEnding: value as SerialProfile["lineEnding"],
                    })
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">
                  {t("serial.form.localEcho")}
                </label>
                <label className="profile-checkbox-row">
                  <input
                    type="checkbox"
                    checked={!!draft.localEcho}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        localEcho: event.target.checked,
                      })
                    }
                  />
                  <span>{t("serial.form.localEchoHint")}</span>
                </label>
              </div>
            </div>
          </section>
        </div>
      </Modal>
      {showDiscardConfirm ? (
        <Modal
          open
          title={t("profile.unsavedChangesConfirmTitle")}
          closeLabel={t("actions.close")}
          onClose={() => setShowDiscardConfirm(false)}
          actions={
            <>
              <Button
                variant="ghost"
                onClick={() => setShowDiscardConfirm(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onClose();
                }}
              >
                {t("profile.actions.discardAndClose")}
              </Button>
            </>
          }
        >
          <p>{t("profile.unsavedChangesConfirm")}</p>
        </Modal>
      ) : null}
    </>
  );
}
