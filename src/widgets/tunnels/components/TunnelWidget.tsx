import { useMemo, useState } from "react";
import type { IconType } from "react-icons";
import type {
  SessionStateUi,
  SshTunnelKind,
  SshTunnelRuntime,
  SshTunnelSpec,
} from "@/types";
import type { Translate } from "@/i18n";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import {
  FiAlertCircle,
  FiCheckCircle,
  FiRefreshCw,
  FiRotateCw,
  FiXCircle,
} from "react-icons/fi";
import "@/widgets/tunnels/components/TunnelWidget.css";

type TunnelWidgetProps = {
  activeSessionId: string | null;
  supportsSshTunnel: boolean;
  activeSessionState: SessionStateUi | null;
  activeSessionLabel: string | null;
  activeSessionHost: string | null;
  activeSessionUsername: string | null;
  tunnels: SshTunnelRuntime[];
  onOpenTunnel: (spec: SshTunnelSpec) => Promise<void>;
  onCloseTunnel: (tunnelId: string) => Promise<void>;
  onCloseAll: () => Promise<void>;
  t: Translate;
};

/** SSH 隧道管理小组件。 */
export default function TunnelWidget({
  activeSessionId,
  supportsSshTunnel,
  activeSessionState,
  activeSessionLabel,
  activeSessionHost,
  activeSessionUsername,
  tunnels,
  onOpenTunnel,
  onCloseTunnel,
  onCloseAll,
  t,
}: TunnelWidgetProps) {
  const [kind, setKind] = useState<SshTunnelKind>("local");
  const [bindHost, setBindHost] = useState("127.0.0.1");
  const [bindPortInput, setBindPortInput] = useState("1080");
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPortInput, setTargetPortInput] = useState("22");
  const [submitting, setSubmitting] = useState(false);

  const bindWarning = useMemo(
    () =>
      bindHost !== "127.0.0.1" &&
      bindHost !== "::1" &&
      bindHost !== "localhost",
    [bindHost],
  );
  const sessionState = activeSessionState ?? "disconnected";
  const isTunnelUnsupportedInLocalMode =
    Boolean(activeSessionId) && !supportsSshTunnel;
  const sessionMeta = useMemo(() => {
    const table: Record<
      SessionStateUi,
      { icon: IconType; label: string; tone: string }
    > = {
      connected: {
        icon: FiCheckCircle,
        label: t("session.connected"),
        tone: "active",
      },
      connecting: {
        icon: FiRefreshCw,
        label: t("session.connecting"),
        tone: "checking",
      },
      reconnecting: {
        icon: FiRotateCw,
        label: t("session.reconnecting"),
        tone: "paused",
      },
      disconnected: {
        icon: FiXCircle,
        label: t("session.disconnected"),
        tone: "disabled",
      },
      error: {
        icon: FiAlertCircle,
        label: t("session.error"),
        tone: "unsupported",
      },
    };
    return table[sessionState];
  }, [sessionState, t]);
  const SessionIcon = sessionMeta.icon;

  if (isTunnelUnsupportedInLocalMode) {
    return (
      <div className="tunnel-widget">
        <div className="tunnel-unavailable">{t("tunnel.onlySsh")}</div>
      </div>
    );
  }

  async function handleSubmit() {
    if (!activeSessionId || !supportsSshTunnel || submitting) return;
    const bindPort = Number(bindPortInput);
    if (!Number.isInteger(bindPort) || bindPort <= 0 || bindPort > 65535)
      return;
    const targetPort = Number(targetPortInput);
    if (
      kind !== "dynamic" &&
      (!Number.isInteger(targetPort) || targetPort <= 0 || targetPort > 65535)
    ) {
      return;
    }
    const spec: SshTunnelSpec = {
      kind,
      bindHost,
      bindPort,
      targetHost: kind === "dynamic" ? null : targetHost,
      targetPort: kind === "dynamic" ? null : targetPort,
    };
    setSubmitting(true);
    try {
      await onOpenTunnel(spec);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tunnel-widget">
      <div className="tunnel-session-meta">
        {!activeSessionId ? (
          <div className="tunnel-empty">{t("tunnel.empty.noSession")}</div>
        ) : (
          <>
            <div className="tunnel-session-row">
              <span className={`tunnel-session-indicator ${sessionMeta.tone}`}>
                <SessionIcon />
              </span>
              <strong>{sessionMeta.label}</strong>
            </div>
            <div className="tunnel-session-object">
              <span className="tunnel-session-name">
                {activeSessionLabel ?? t("session.defaultName")}
              </span>
              <span className="tunnel-session-subtitle">
                {activeSessionHost ?? "-"}{" "}
                {activeSessionUsername ? `· ${activeSessionUsername}` : ""}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="tunnel-form">
        <div className="form-row">
          <label>{t("tunnel.form.kind")}</label>
          <Select
            value={kind}
            options={[
              { value: "local", label: t("tunnel.kind.local") },
              { value: "remote", label: t("tunnel.kind.remote") },
              { value: "dynamic", label: t("tunnel.kind.dynamic") },
            ]}
            onChange={(value) => setKind(value as SshTunnelKind)}
            aria-label={t("tunnel.form.kind")}
          />
        </div>
        <div className="form-row split">
          <div>
            <label>{t("tunnel.form.bindHost")}</label>
            <input
              value={bindHost}
              onChange={(e) => setBindHost(e.target.value)}
            />
          </div>
          <div>
            <label>{t("tunnel.form.bindPort")}</label>
            <input
              inputMode="numeric"
              value={bindPortInput}
              onChange={(e) =>
                setBindPortInput(e.target.value.replace(/[^\d]/g, ""))
              }
            />
          </div>
        </div>
        {kind !== "dynamic" && (
          <div className="form-row split">
            <div>
              <label>{t("tunnel.form.targetHost")}</label>
              <input
                value={targetHost}
                onChange={(e) => setTargetHost(e.target.value)}
              />
            </div>
            <div>
              <label>{t("tunnel.form.targetPort")}</label>
              <input
                inputMode="numeric"
                value={targetPortInput}
                onChange={(e) =>
                  setTargetPortInput(e.target.value.replace(/[^\d]/g, ""))
                }
              />
            </div>
          </div>
        )}
        {bindWarning && (
          <div className="tunnel-warning">{t("tunnel.bind.warning")}</div>
        )}
        <div className="tunnel-actions">
          <Button
            variant="primary"
            onClick={() => {
              handleSubmit().catch(() => {});
            }}
            disabled={!activeSessionId || !supportsSshTunnel || submitting}
          >
            {t("tunnel.actions.open")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onCloseAll().catch(() => {});
            }}
            disabled={
              !activeSessionId || !supportsSshTunnel || tunnels.length === 0
            }
          >
            {t("tunnel.actions.closeAll")}
          </Button>
        </div>
      </div>
      <div className="tunnel-list">
        {activeSessionId && tunnels.length === 0 && (
          <div className="tunnel-empty">{t("tunnel.empty.noTunnels")}</div>
        )}
        {tunnels.map((item) => (
          <div key={item.tunnelId} className="tunnel-item">
            <div className="tunnel-item-main">
              <strong>{t(`tunnel.kind.${item.kind}` as never)}</strong>
              <span>
                {item.bindHost}:{item.bindPort}
              </span>
              {item.kind !== "dynamic" && item.targetHost && item.targetPort ? (
                <span>
                  {item.targetHost}:{item.targetPort}
                </span>
              ) : null}
            </div>
            <div className="tunnel-item-meta">
              <span>{item.status}</span>
              <span>
                {item.activeConnections} {t("tunnel.connections")}
              </span>
            </div>
            <div className="tunnel-item-actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onCloseTunnel(item.tunnelId).catch(() => {});
                }}
                disabled={!supportsSshTunnel}
              >
                {t("tunnel.actions.close")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
