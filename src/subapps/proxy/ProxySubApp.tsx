import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Locale, Translate } from "@/i18n";
import type { ProxyProtocol } from "@/types";
import type { SubAppId } from "@/subapps/types";
import {
  SUBAPP_LIFECYCLE_CHANNEL,
  createSubAppWindowLabel,
  type SubAppLifecycleMessage,
} from "@/subapps/core/lifecycle";
import SubAppTitleBar from "@/subapps/components/SubAppTitleBar";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import { formatBytes } from "@/utils/format";
import useProxyState from "@/subapps/proxy/hooks/useProxyState";
import "./ProxySubApp.css";

type ProxySubAppProps = {
  id: SubAppId;
  locale: Locale;
  t: Translate;
};

/** 代理子应用。 */
export default function ProxySubApp({ id, locale, t }: ProxySubAppProps) {
  const windowLabel = useMemo(() => createSubAppWindowLabel(id), [id]);
  const closingRef = useRef(false);
  const [protocol, setProtocol] = useState<ProxyProtocol>("http");
  const [name, setName] = useState("");
  const [bindHost, setBindHost] = useState("127.0.0.1");
  const [bindPort, setBindPort] = useState("8080");
  const [authEnabled, setAuthEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "running" | "starting" | "stopping" | "stopped" | "failed"
  >("all");
  const [sortBy, setSortBy] = useState<"traffic" | "connections" | "name">(
    "traffic",
  );
  const [bytesInRate, setBytesInRate] = useState(0);
  const [bytesOutRate, setBytesOutRate] = useState(0);
  const [updatedAtById, setUpdatedAtById] = useState<Record<string, number>>(
    {},
  );
  const prevTotalsRef = useRef<{
    at: number;
    bytesIn: number;
    bytesOut: number;
  } | null>(null);

  const {
    proxies,
    loading,
    totals,
    timeline,
    errorBuckets,
    refresh,
    create,
    close,
    closeAll,
  } = useProxyState();

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SUBAPP_LIFECYCLE_CHANNEL);

    const postMessage = (message: SubAppLifecycleMessage) => {
      channel.postMessage(message);
    };

    postMessage({
      type: "subapp:ready",
      id,
      label: windowLabel,
      source: "subapp",
    });

    channel.onmessage = (event) => {
      const payload = event.data as SubAppLifecycleMessage | undefined;
      if (!payload) return;
      if (payload.type === "subapp:main-shutdown") {
        closingRef.current = true;
        getCurrentWindow()
          .close()
          .catch(() => {});
        return;
      }
      if (
        payload.type === "subapp:close-request" &&
        payload.id === id &&
        payload.label === windowLabel
      ) {
        closingRef.current = true;
        getCurrentWindow()
          .close()
          .catch(() => {});
      }
    };

    const onUnload = () => {
      postMessage({
        type: "subapp:closed",
        id,
        label: windowLabel,
        source: "subapp",
      });
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      channel.close();
    };
  }, [id, windowLabel]);

  const totalTraffic = totals.bytesIn + totals.bytesOut;
  const unhealthyCount = useMemo(
    () =>
      proxies.filter(
        (item) => item.status === "failed" || Boolean(item.lastError?.message),
      ).length,
    [proxies],
  );

  useEffect(() => {
    const now = Date.now();
    setUpdatedAtById((prev) => {
      const next: Record<string, number> = {};
      proxies.forEach((item) => {
        next[item.proxyId] = prev[item.proxyId] ?? now;
      });
      return next;
    });
  }, [proxies]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const prev = prevTotalsRef.current;
      if (!prev) {
        prevTotalsRef.current = {
          at: now,
          bytesIn: totals.bytesIn,
          bytesOut: totals.bytesOut,
        };
        return;
      }
      const seconds = Math.max((now - prev.at) / 1000, 0.001);
      const deltaIn = Math.max(0, totals.bytesIn - prev.bytesIn);
      const deltaOut = Math.max(0, totals.bytesOut - prev.bytesOut);
      setBytesInRate(deltaIn / seconds);
      setBytesOutRate(deltaOut / seconds);
      prevTotalsRef.current = {
        at: now,
        bytesIn: totals.bytesIn,
        bytesOut: totals.bytesOut,
      };
    }, 1000);
    return () => window.clearInterval(timer);
  }, [totals.bytesIn, totals.bytesOut]);

  const filteredSortedProxies = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const filtered = proxies.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!normalized) return true;
      const alias = item.name?.trim() || "";
      const haystack = [
        item.proxyId,
        alias,
        item.protocol,
        item.bindHost,
        String(item.bindPort),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
    return filtered.sort((a, b) => {
      if (sortBy === "connections") {
        return b.activeConnections - a.activeConnections;
      }
      if (sortBy === "name") {
        const aName = a.name?.trim() || a.proxyId;
        const bName = b.name?.trim() || b.proxyId;
        return aName.localeCompare(bName);
      }
      const aTraffic = a.bytesIn + a.bytesOut;
      const bTraffic = b.bytesIn + b.bytesOut;
      return bTraffic - aTraffic;
    });
  }, [proxies, search, sortBy, statusFilter]);

  function statusLevel(status: string, hasError: boolean) {
    if (status === "failed" || hasError) return "danger";
    if (status === "stopping" || status === "starting") return "warn";
    if (status === "running") return "good";
    return "muted";
  }

  function updatedAgoText(proxyId: string) {
    const ts = updatedAtById[proxyId];
    if (!ts) return locale === "zh-CN" ? "刚刚" : "just now";
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 5) return locale === "zh-CN" ? "刚刚" : "just now";
    if (sec < 60) return locale === "zh-CN" ? `${sec}秒前` : `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return locale === "zh-CN" ? `${min}分钟前` : `${min}m ago`;
    const hour = Math.floor(min / 60);
    return locale === "zh-CN" ? `${hour}小时前` : `${hour}h ago`;
  }

  function eventAgoText(ts: number) {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 5) return locale === "zh-CN" ? "刚刚" : "just now";
    if (sec < 60) return locale === "zh-CN" ? `${sec}秒前` : `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return locale === "zh-CN" ? `${min}分钟前` : `${min}m ago`;
    const hour = Math.floor(min / 60);
    return locale === "zh-CN" ? `${hour}小时前` : `${hour}h ago`;
  }

  async function handleCreateProxy() {
    if (busy) return;
    const port = Number(bindPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setErrorMessage(t("proxy.error.invalidPort"));
      return;
    }
    if (authEnabled && (!username.trim() || !password.trim())) {
      setErrorMessage(t("proxy.error.authRequired"));
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      await create({
        protocol,
        name: name.trim() || null,
        bindHost: bindHost.trim() || "127.0.0.1",
        bindPort: port,
        auth: authEnabled
          ? {
              username: username.trim(),
              password,
            }
          : null,
      });
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseProxy(proxyId: string) {
    setBusy(true);
    setErrorMessage(null);
    try {
      await close(proxyId);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseAll() {
    setBusy(true);
    setErrorMessage(null);
    try {
      await closeAll();
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="subapp-shell proxy-subapp-shell">
      <SubAppTitleBar title="FluxTerm" t={t} />
      <main className="subapp-content proxy-subapp-content">
        <article className="proxy-subapp-body">
          <div className="proxy-heading-row">
            <h2>{t("subapp.proxy.heading")}</h2>
            <div className="proxy-actions">
              <Button
                variant="primary"
                onClick={() => handleCreateProxy().catch(() => {})}
                disabled={busy}
              >
                {t("proxy.actions.create")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => refresh().catch(() => {})}
                disabled={busy || loading}
              >
                {t("proxy.actions.refresh")}
              </Button>
              <Button
                variant="danger"
                onClick={() => handleCloseAll().catch(() => {})}
                disabled={busy || proxies.length === 0}
              >
                {t("proxy.actions.closeAll")}
              </Button>
            </div>
          </div>
          <div className="proxy-kpi-grid">
            <div className="proxy-kpi-card">
              <span>
                {t("proxy.summary.instances", { count: proxies.length })}
              </span>
              <strong>{proxies.length}</strong>
            </div>
            <div className="proxy-kpi-card">
              <span>
                {t("proxy.summary.connections", {
                  count: totals.activeConnections,
                })}
              </span>
              <strong>{totals.activeConnections}</strong>
            </div>
            <div className="proxy-kpi-card">
              <span>
                {locale === "zh-CN"
                  ? "当前上行/下行速率"
                  : "Current Up/Down Rate"}
              </span>
              <strong>
                {formatBytes(bytesOutRate)}/s · {formatBytes(bytesInRate)}/s
              </strong>
            </div>
            <div className="proxy-kpi-card">
              <span>
                {locale === "zh-CN" ? "异常实例" : "Unhealthy Instances"}
              </span>
              <strong>{unhealthyCount}</strong>
            </div>
          </div>
          <div className="proxy-summary-row">
            <span>
              {t("proxy.summary.instances", { count: proxies.length })}
            </span>
            <span>
              {t("proxy.summary.connections", {
                count: totals.activeConnections,
              })}
            </span>
            <span>
              {t("proxy.summary.in", { value: formatBytes(totals.bytesIn) })}
            </span>
            <span>
              {t("proxy.summary.out", { value: formatBytes(totals.bytesOut) })}
            </span>
            <span>
              {t("proxy.summary.total", { value: formatBytes(totalTraffic) })}
            </span>
          </div>
          <div className="proxy-toolbar">
            <label className="proxy-search">
              <span>{locale === "zh-CN" ? "搜索" : "Search"}</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  locale === "zh-CN"
                    ? "按名称 / 协议 / 地址过滤"
                    : "Filter by name / protocol / address"
                }
              />
            </label>
            <label>
              <span>{locale === "zh-CN" ? "状态" : "Status"}</span>
              <Select
                value={statusFilter}
                options={[
                  { value: "all", label: locale === "zh-CN" ? "全部" : "All" },
                  {
                    value: "running",
                    label: t("proxy.status.running"),
                  },
                  {
                    value: "starting",
                    label: t("proxy.status.starting"),
                  },
                  {
                    value: "stopping",
                    label: t("proxy.status.stopping"),
                  },
                  {
                    value: "failed",
                    label: t("proxy.status.failed"),
                  },
                  {
                    value: "stopped",
                    label: t("proxy.status.stopped"),
                  },
                ]}
                onChange={(value) =>
                  setStatusFilter(
                    value as
                      | "all"
                      | "running"
                      | "starting"
                      | "stopping"
                      | "stopped"
                      | "failed",
                  )
                }
                aria-label={locale === "zh-CN" ? "状态过滤" : "Status Filter"}
              />
            </label>
            <label>
              <span>{locale === "zh-CN" ? "排序" : "Sort By"}</span>
              <Select
                value={sortBy}
                options={[
                  {
                    value: "traffic",
                    label: locale === "zh-CN" ? "总流量" : "Traffic",
                  },
                  {
                    value: "connections",
                    label: locale === "zh-CN" ? "连接数" : "Connections",
                  },
                  {
                    value: "name",
                    label: locale === "zh-CN" ? "名称" : "Name",
                  },
                ]}
                onChange={(value) =>
                  setSortBy(value as "traffic" | "connections" | "name")
                }
                aria-label={locale === "zh-CN" ? "排序方式" : "Sort By"}
              />
            </label>
          </div>

          <div className="proxy-form-grid">
            <label>
              <span>{t("proxy.form.protocol")}</span>
              <Select
                value={protocol}
                options={[
                  { value: "http", label: "HTTP" },
                  { value: "socks5", label: "SOCKS5" },
                ]}
                onChange={(value) => setProtocol(value as ProxyProtocol)}
                aria-label={t("proxy.form.protocol")}
              />
            </label>
            <label>
              <span>{t("proxy.form.name")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span>{t("proxy.form.bindHost")}</span>
              <input
                value={bindHost}
                onChange={(e) => setBindHost(e.target.value)}
              />
            </label>
            <label>
              <span>{t("proxy.form.bindPort")}</span>
              <input
                inputMode="numeric"
                value={bindPort}
                onChange={(e) =>
                  setBindPort(e.target.value.replace(/[^\d]/g, ""))
                }
              />
            </label>
          </div>

          <div className="proxy-auth-block">
            <label className="proxy-auth-toggle">
              <input
                type="checkbox"
                checked={authEnabled}
                onChange={(e) => setAuthEnabled(e.target.checked)}
              />
              <span>{t("proxy.form.authEnabled")}</span>
            </label>
            {authEnabled && (
              <div className="proxy-form-grid auth">
                <label>
                  <span>{t("proxy.form.username")}</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label>
                  <span>{t("proxy.form.password")}</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>

          {errorMessage ? (
            <div className="proxy-error">{errorMessage}</div>
          ) : null}

          <div className="proxy-list">
            {filteredSortedProxies.length === 0 ? (
              <div className="proxy-empty">{t("proxy.empty")}</div>
            ) : (
              filteredSortedProxies.map((item) => (
                <div key={item.proxyId} className="proxy-item">
                  <div className="proxy-item-main">
                    <strong>
                      {item.name?.trim() || item.proxyId.slice(0, 8)}
                    </strong>
                    <span>{item.protocol.toUpperCase()}</span>
                    <span>
                      {item.bindHost}:{item.bindPort}
                    </span>
                    <span
                      className={`proxy-status-badge proxy-status-${statusLevel(
                        item.status,
                        Boolean(item.lastError?.message),
                      )}`}
                    >
                      {t(`proxy.status.${item.status}` as never)}
                    </span>
                    <span className="proxy-updated-at">
                      {locale === "zh-CN" ? "更新于" : "Updated"}{" "}
                      {updatedAgoText(item.proxyId)}
                    </span>
                  </div>
                  <div className="proxy-item-meta">
                    <span>
                      {t("proxy.summary.connections", {
                        count: item.activeConnections,
                      })}
                    </span>
                    <span>
                      {t("proxy.summary.in", {
                        value: formatBytes(item.bytesIn),
                      })}
                    </span>
                    <span>
                      {t("proxy.summary.out", {
                        value: formatBytes(item.bytesOut),
                      })}
                    </span>
                    <span>
                      {t("proxy.summary.total", {
                        value: formatBytes(item.bytesIn + item.bytesOut),
                      })}
                    </span>
                    <Button
                      className="proxy-item-close-inline"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleCloseProxy(item.proxyId).catch(() => {})
                      }
                      disabled={busy}
                    >
                      {t("proxy.actions.close")}
                    </Button>
                  </div>
                  {item.lastError?.message ? (
                    <div className="proxy-item-error">
                      {item.lastError.message}
                      {item.lastError.detail
                        ? `: ${item.lastError.detail}`
                        : ""}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="proxy-observability-grid">
            <section className="proxy-ob-card">
              <h3>
                {locale === "zh-CN" ? "错误码聚合" : "Error Code Aggregation"}
              </h3>
              {errorBuckets.length === 0 ? (
                <div className="proxy-empty">
                  {locale === "zh-CN" ? "暂无错误事件" : "No error events yet"}
                </div>
              ) : (
                <div className="proxy-error-buckets">
                  {errorBuckets.slice(0, 8).map((bucket) => (
                    <div key={bucket.code} className="proxy-error-bucket">
                      <strong>{bucket.code}</strong>
                      <span>
                        {locale === "zh-CN"
                          ? `次数 ${bucket.count}`
                          : `count ${bucket.count}`}
                      </span>
                      <span>{eventAgoText(bucket.lastAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="proxy-ob-card proxy-ob-card-timeline">
              <h3>{locale === "zh-CN" ? "最近事件" : "Recent Events"}</h3>
              {timeline.length === 0 ? (
                <div className="proxy-empty">
                  {locale === "zh-CN" ? "暂无事件" : "No events yet"}
                </div>
              ) : (
                <div className="proxy-timeline">
                  {timeline.slice(0, 16).map((entry) => (
                    <div key={entry.id} className="proxy-timeline-item">
                      <span
                        className={`proxy-level proxy-level-${entry.level}`}
                      >
                        {entry.level.toUpperCase()}
                      </span>
                      <span className="proxy-timeline-event">
                        {entry.event}
                      </span>
                      {entry.proxyId ? (
                        <span className="proxy-timeline-proxy">
                          {entry.proxyId.slice(0, 8)}
                        </span>
                      ) : null}
                      <span className="proxy-timeline-time">
                        {eventAgoText(entry.at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </article>
      </main>
    </div>
  );
}
