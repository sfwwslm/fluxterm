import { useEffect, useMemo, useState } from "react";
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
  FiArrowRight,
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

/** 格式化端点显示文本，避免空值时出现难读的地址。 */
function formatEndpoint(
  host: string | null | undefined,
  port: string | number | null | undefined,
) {
  const finalHost = host && host.trim() ? host.trim() : "-";
  const finalPort = String(port ?? "").trim();
  return `${finalHost}:${finalPort || "-"}`;
}

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
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setSubmitError(null);
  }, [activeSessionId]);

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
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onOpenTunnel(spec);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: unknown }).code
          : null;
      if (code === "ssh_tunnel_bind_failed") {
        setSubmitError(t("tunnel.error.bindFailed"));
      } else {
        setSubmitError(
          error instanceof Error ? error.message : t("tunnel.error.openFailed"),
        );
      }
      throw error;
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
          <div className="tunnel-session-row single-line">
            <span className={`tunnel-session-indicator ${sessionMeta.tone}`}>
              <SessionIcon />
            </span>
            <strong>{sessionMeta.label}</strong>
            <span className="tunnel-session-name">
              {activeSessionLabel ?? t("session.defaultName")}
            </span>
            <span className="tunnel-session-subtitle">
              {activeSessionHost ?? "-"}
              {activeSessionUsername ? ` · ${activeSessionUsername}` : ""}
            </span>
          </div>
        )}
      </div>
      <div className="tunnel-form">
        <div className="tunnel-form-toolbar">
          <div className="tunnel-actions tunnel-actions-inline">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                handleSubmit().catch(() => {});
              }}
              disabled={!activeSessionId || !supportsSshTunnel || submitting}
            >
              {t("tunnel.actions.open")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onCloseAll()
                  .then(() => setSubmitError(null))
                  .catch(() => {});
              }}
              disabled={
                !activeSessionId || !supportsSshTunnel || tunnels.length === 0
              }
            >
              {t("tunnel.actions.closeAll")}
            </Button>
          </div>
        </div>
        <div
          className={`form-row tunnel-config-row ${
            kind === "dynamic" ? "is-dynamic" : ""
          }`}
        >
          <div className="tunnel-endpoint-card tunnel-type-card">
            <div className="tunnel-endpoint-title">{t("tunnel.form.kind")}</div>
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
          <div className="tunnel-endpoint-card">
            <div className="tunnel-endpoint-title">
              {t("tunnel.form.local")}
            </div>
            <div className="tunnel-endpoint-fields">
              <input
                aria-label={`${t("tunnel.form.local")} ${t("tunnel.form.address")}`}
                value={bindHost}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setBindHost(e.target.value)}
              />
              <div className="tunnel-port-field">
                <input
                  aria-label={`${t("tunnel.form.local")} ${t("tunnel.form.port")}`}
                  inputMode="numeric"
                  value={bindPortInput}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) =>
                    setBindPortInput(e.target.value.replace(/[^\d]/g, ""))
                  }
                />
              </div>
            </div>
          </div>
          {kind !== "dynamic" && (
            <div className="tunnel-endpoint-card">
              <div className="tunnel-endpoint-title">
                {t("tunnel.form.remote")}
              </div>
              <div className="tunnel-endpoint-fields">
                <input
                  aria-label={`${t("tunnel.form.remote")} ${t("tunnel.form.address")}`}
                  value={targetHost}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setTargetHost(e.target.value)}
                />
                <div className="tunnel-port-field">
                  <input
                    aria-label={`${t("tunnel.form.remote")} ${t("tunnel.form.port")}`}
                    inputMode="numeric"
                    value={targetPortInput}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) =>
                      setTargetPortInput(e.target.value.replace(/[^\d]/g, ""))
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        {bindWarning && (
          <div className="tunnel-warning">{t("tunnel.bind.warning")}</div>
        )}
        {submitError && <div className="tunnel-warning">{submitError}</div>}
      </div>
      <div className="tunnel-list">
        {activeSessionId && tunnels.length === 0 && (
          <div className="tunnel-empty">{t("tunnel.empty.noTunnels")}</div>
        )}
        {tunnels.map((item) => (
          <div key={item.tunnelId} className="tunnel-item">
            <div className="tunnel-item-main">
              <strong>{t(`tunnel.kind.${item.kind}` as never)}</strong>
              <span className="tunnel-item-route">
                {formatEndpoint(item.bindHost, item.bindPort)}
                <FiArrowRight aria-hidden="true" />
                {item.kind === "dynamic"
                  ? t("tunnel.flow.dynamicTarget")
                  : formatEndpoint(item.targetHost, item.targetPort)}
              </span>
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
                  onCloseTunnel(item.tunnelId)
                    .then(() => setSubmitError(null))
                    .catch(() => {});
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
