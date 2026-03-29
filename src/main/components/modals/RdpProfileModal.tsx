import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "@/components/ui/modal/Modal";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import { ROOT_PROFILE_GROUP_VALUE } from "@/constants/hostGroups";
import type { Translate } from "@/i18n";
import { saveRdpProfile } from "@/features/rdp/core/commands";
import type { RdpProfile } from "@/types";
import "@/main/components/modals/RdpProfileModal.css";

type RdpProfileModalProps = {
  open: boolean;
  mode: "new" | "edit";
  initialProfile?: RdpProfile | null;
  groups: string[];
  onClose: () => void;
  onProfilesChange?: () => Promise<void> | void;
  t: Translate;
};

type RdpProfileSection = "connection" | "display" | "security";

const RDP_RESOLUTION_CUSTOM_VALUE = "custom";
const RDP_RESOLUTION_PRESETS = [
  { value: "1024x768", width: 1024, height: 768 },
  { value: "1280x720", width: 1280, height: 720 },
  { value: "1366x768", width: 1366, height: 768 },
  { value: "1600x900", width: 1600, height: 900 },
  { value: "1920x1080", width: 1920, height: 1080 },
  { value: "2560x1440", width: 2560, height: 1440 },
] as const;

const DEFAULT_RDP_PROFILE: RdpProfile = {
  id: "",
  name: "",
  host: "",
  port: 3389,
  username: "",
  tags: null,
  passwordRef: "",
  domain: "",
  ignoreCertificate: true,
  resolutionMode: "window_sync",
  width: 1280,
  height: 720,
  clipboardMode: "text",
  reconnectPolicy: {
    enabled: true,
    maxAttempts: 3,
  },
};

function buildDefaultProfile() {
  return {
    ...DEFAULT_RDP_PROFILE,
    reconnectPolicy: { ...DEFAULT_RDP_PROFILE.reconnectPolicy },
  };
}

export default function RdpProfileModal({
  open,
  mode,
  initialProfile = null,
  groups,
  onClose,
  onProfilesChange,
  t,
}: RdpProfileModalProps) {
  const [draftProfile, setDraftProfile] = useState<RdpProfile>(() =>
    buildDefaultProfile(),
  );
  const [activeSection, setActiveSection] =
    useState<RdpProfileSection>("connection");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const resolveInitialDraft = useCallback(() => {
    if (mode === "edit" && initialProfile) {
      return {
        ...initialProfile,
        reconnectPolicy: { ...initialProfile.reconnectPolicy },
      };
    }
    return buildDefaultProfile();
  }, [initialProfile, mode]);

  useEffect(() => {
    if (!open) return;
    setActiveSection("connection");
    setErrorMessage("");
    setDraftProfile(resolveInitialDraft());
  }, [open, resolveInitialDraft]);

  async function handleSaveProfile() {
    setBusy(true);
    setErrorMessage("");
    try {
      const saved = await saveRdpProfile(draftProfile);
      setDraftProfile(saved);
      await onProfilesChange?.();
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const sectionItems: Array<{ key: RdpProfileSection; label: string }> = [
    { key: "connection", label: t("rdp.drawer.sections.connection") },
    { key: "display", label: t("rdp.drawer.sections.display") },
    { key: "security", label: t("rdp.drawer.sections.security") },
  ];

  const resolutionModeOptions = useMemo(
    () => [
      {
        value: "window_sync",
        label: t("rdp.resolution.windowSync"),
      },
      {
        value: "fixed",
        label: t("rdp.resolution.fixed"),
      },
    ],
    [t],
  );

  const groupOptions = useMemo(
    () => [
      { value: ROOT_PROFILE_GROUP_VALUE, label: t("host.ungrouped") },
      ...groups.map((group) => ({
        value: group,
        label: group,
      })),
    ],
    [groups, t],
  );

  const resolutionPresetOptions = useMemo(
    () => [
      ...RDP_RESOLUTION_PRESETS.map((item) => ({
        value: item.value,
        label: item.value,
      })),
      {
        value: RDP_RESOLUTION_CUSTOM_VALUE,
        label: t("rdp.resolution.custom"),
      },
    ],
    [t],
  );

  const resolutionPresetValue = useMemo(() => {
    const matchedPreset = RDP_RESOLUTION_PRESETS.find(
      (item) =>
        item.width === draftProfile.width &&
        item.height === draftProfile.height,
    );
    return matchedPreset?.value ?? RDP_RESOLUTION_CUSTOM_VALUE;
  }, [draftProfile.height, draftProfile.width]);

  return (
    <Modal
      open={open}
      busy={busy}
      title={t("rdp.config.title")}
      closeLabel={t("actions.close")}
      onClose={onClose}
      bodyClassName="rdp-profile-modal-body"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSaveProfile()}
            disabled={busy}
          >
            {t("actions.save")}
          </Button>
        </>
      }
    >
      <div className="rdp-profile-modal" data-ui="rdp-profile-modal">
        <aside className="rdp-profile-modal-nav" data-slot="rdp-profile-nav">
          <div className="rdp-profile-modal-menu">
            {sectionItems.map((section) => (
              <Button
                key={section.key}
                className={`rdp-profile-modal-menu-item ${
                  section.key === activeSection ? "is-active" : ""
                }`}
                variant="ghost"
                size="sm"
                onClick={() => setActiveSection(section.key)}
              >
                {section.label}
              </Button>
            ))}
          </div>
        </aside>
        <div
          className="rdp-profile-modal-content"
          data-slot="rdp-profile-content"
        >
          <div className="rdp-profile-modal-scroll">
            {activeSection === "connection" ? (
              <section className="rdp-profile-modal-section">
                <div className="host-editor">
                  <div className="form-row">
                    <label className="form-label">
                      {t("profile.form.name")}
                    </label>
                    <input
                      value={draftProfile.name}
                      onChange={(event) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">
                      {t("profile.form.group")}
                    </label>
                    <Select
                      value={
                        draftProfile.tags?.[0]?.trim() ||
                        ROOT_PROFILE_GROUP_VALUE
                      }
                      options={groupOptions}
                      onChange={(value) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          tags:
                            value === ROOT_PROFILE_GROUP_VALUE ? null : [value],
                        }))
                      }
                      aria-label={t("profile.form.group")}
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">
                      {t("profile.form.host")}
                    </label>
                    <input
                      value={draftProfile.host}
                      onChange={(event) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          host: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">
                      {t("profile.form.port")}
                    </label>
                    <input
                      inputMode="numeric"
                      value={String(draftProfile.port)}
                      onChange={(event) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          port: Number(
                            event.target.value.replace(/[^\d]/g, "") || "3389",
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">
                      {t("profile.form.username")}
                    </label>
                    <input
                      value={draftProfile.username}
                      onChange={(event) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          username: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">
                      {t("profile.form.password")}
                    </label>
                    <input
                      type="password"
                      value={draftProfile.passwordRef ?? ""}
                      onChange={(event) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          passwordRef: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">{t("rdp.form.domain")}</label>
                    <input
                      value={draftProfile.domain ?? ""}
                      onChange={(event) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          domain: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {activeSection === "display" ? (
              <section className="rdp-profile-modal-section">
                <div className="rdp-profile-group-card">
                  <div className="host-editor">
                    <div className="form-row">
                      <label className="form-label">
                        {t("rdp.form.resolutionMode")}
                      </label>
                      <div className="config-select-control rdp-profile-select-control">
                        <Select
                          value={draftProfile.resolutionMode}
                          options={resolutionModeOptions}
                          aria-label={t("rdp.form.resolutionMode")}
                          onChange={(value) =>
                            setDraftProfile((prev) => ({
                              ...prev,
                              resolutionMode:
                                value as RdpProfile["resolutionMode"],
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                  {draftProfile.resolutionMode === "fixed" ? (
                    <div className="rdp-profile-group-body host-editor">
                      <div className="form-row">
                        <label className="form-label">
                          {t("rdp.form.fixedResolution")}
                        </label>
                        <Select
                          value={resolutionPresetValue}
                          options={resolutionPresetOptions}
                          aria-label={t("rdp.form.fixedResolution")}
                          onChange={(value) => {
                            if (value === RDP_RESOLUTION_CUSTOM_VALUE) {
                              return;
                            }
                            const preset = RDP_RESOLUTION_PRESETS.find(
                              (item) => item.value === value,
                            );
                            if (!preset) return;
                            setDraftProfile((prev) => ({
                              ...prev,
                              width: preset.width,
                              height: preset.height,
                            }));
                          }}
                        />
                      </div>
                      {resolutionPresetValue === RDP_RESOLUTION_CUSTOM_VALUE ? (
                        <>
                          <div className="form-row">
                            <label className="form-label">
                              {t("rdp.form.width")}
                            </label>
                            <input
                              inputMode="numeric"
                              value={String(draftProfile.width)}
                              onChange={(event) =>
                                setDraftProfile((prev) => ({
                                  ...prev,
                                  width: Number(
                                    event.target.value.replace(/[^\d]/g, "") ||
                                      "1280",
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div className="form-row">
                            <label className="form-label">
                              {t("rdp.form.height")}
                            </label>
                            <input
                              inputMode="numeric"
                              value={String(draftProfile.height)}
                              onChange={(event) =>
                                setDraftProfile((prev) => ({
                                  ...prev,
                                  height: Number(
                                    event.target.value.replace(/[^\d]/g, "") ||
                                      "720",
                                  ),
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeSection === "security" ? (
              <section className="rdp-profile-modal-section">
                <label className="config-toggle-card">
                  <div className="config-toggle-copy">
                    <span className="config-toggle-title">
                      {t("rdp.form.ignoreCertificate")}
                    </span>
                    <span className="config-toggle-desc">
                      {t("rdp.security.ignoreCertificateHint")}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={draftProfile.ignoreCertificate}
                    onChange={(event) =>
                      setDraftProfile((prev) => ({
                        ...prev,
                        ignoreCertificate: event.target.checked,
                      }))
                    }
                  />
                </label>
              </section>
            ) : null}

            {errorMessage ? (
              <div className="rdp-profile-modal-error">{errorMessage}</div>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
