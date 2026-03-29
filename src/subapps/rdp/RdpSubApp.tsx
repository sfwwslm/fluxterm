import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Locale, Translate } from "@/i18n";
import type { RdpInputEvent, RdpProfile, RdpSessionSnapshot } from "@/types";
import type { SubAppId } from "@/subapps/types";
import {
  SUBAPP_LIFECYCLE_CHANNEL,
  createSubAppWindowLabel,
  type SubAppLifecycleMessage,
} from "@/subapps/core/lifecycle";
import SubAppTitleBar from "@/subapps/components/SubAppTitleBar";
import { isMacOS } from "@/utils/platform";
import {
  connectRdpSession,
  createRdpSession,
  decideRdpCertificate,
  disconnectRdpSession,
  listRdpProfiles,
  resizeRdpSession,
  sendRdpInput,
} from "@/features/rdp/core/commands";
import "./RdpSubApp.css";

type RdpSubAppProps = {
  id: SubAppId;
  locale: Locale;
  t: Translate;
};

type RdpPerfSnapshot = {
  fps: number;
  bridgeState: "idle" | "connecting" | "open" | "closed";
};

type RdpWireEvent =
  | {
      type: "state";
      state: string;
      message?: string;
      width?: number;
      height?: number;
    }
  | { type: "cursor"; cursor: string }
  | { type: "clipboard"; direction: string; text: string }
  | { type: "input-ack"; kind: string }
  | { type: "error"; code: string; message: string };

type RdpSessionTab = {
  session: RdpSessionSnapshot;
  profile: RdpProfile;
  statusText: string;
  errorMessage: string;
  perf: RdpPerfSnapshot;
  remoteCursor: string;
};

const EMPTY_PERF: RdpPerfSnapshot = {
  fps: 0,
  bridgeState: "idle",
};

function getProfileDisplayName(profile: Pick<RdpProfile, "name" | "host">) {
  return profile.name.trim() || profile.host.trim() || "RDP";
}

function getSessionResolutionValue(session: RdpSessionSnapshot | null) {
  if (!session) return "--";
  if (session.width <= 0 || session.height <= 0) return "--";
  return `${session.width} × ${session.height}`;
}

/** RDP 子应用。 */
export default function RdpSubApp({ id, locale, t }: RdpSubAppProps) {
  const isMac = useMemo(() => isMacOS(), []);
  const windowLabel = useMemo(() => createSubAppWindowLabel(id), [id]);
  const closingRef = useRef(false);
  const cleanupInFlightRef = useRef<Promise<void> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());

  const [sessions, setSessions] = useState<RdpSessionTab[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState("");
  const sessionsRef = useRef<RdpSessionTab[]>([]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activeTab = useMemo(
    () =>
      sessions.find((item) => item.session.sessionId === activeSessionId) ??
      null,
    [activeSessionId, sessions],
  );

  const activePerf = activeTab?.perf ?? EMPTY_PERF;
  const statusLineText =
    activeTab?.statusText ??
    (locale === "zh-CN" ? "当前没有活动会话" : "No active session");

  /** 统一更新某个会话标签的状态。 */
  const updateSessionTab = useCallback(
    (sessionId: string, updater: (tab: RdpSessionTab) => RdpSessionTab) => {
      setSessions((prev) =>
        prev.map((tab) =>
          tab.session.sessionId === sessionId ? updater(tab) : tab,
        ),
      );
    },
    [],
  );

  /** 处理运行时状态、光标、剪贴板和错误事件。 */
  const handleWireEvent = useCallback(
    (sessionId: string, payload: RdpWireEvent) => {
      if (payload.type === "state") {
        updateSessionTab(sessionId, (tab) => ({
          ...tab,
          statusText:
            payload.message === "desktop resized"
              ? tab.statusText
              : (payload.message ??
                (payload.state === "error"
                  ? locale === "zh-CN"
                    ? "RDP 会话异常断开"
                    : "RDP session failed"
                  : payload.state === "disconnected"
                    ? locale === "zh-CN"
                      ? "RDP 会话已断开"
                      : "RDP session disconnected"
                    : payload.state)),
          errorMessage:
            payload.state === "error"
              ? tab.errorMessage ||
                (locale === "zh-CN"
                  ? "远程桌面会话发生异常，请检查运行时日志。"
                  : "The remote desktop session failed. Check runtime logs.")
              : tab.errorMessage,
          perf:
            payload.state === "error" || payload.state === "disconnected"
              ? { ...tab.perf, bridgeState: "closed" }
              : tab.perf,
          session: {
            ...tab.session,
            state: payload.state as RdpSessionSnapshot["state"],
            width:
              typeof payload.width === "number"
                ? payload.width
                : tab.session.width,
            height:
              typeof payload.height === "number"
                ? payload.height
                : tab.session.height,
          },
        }));
        return;
      }
      if (payload.type === "cursor") {
        updateSessionTab(sessionId, (tab) => ({
          ...tab,
          remoteCursor: payload.cursor || "crosshair",
        }));
        return;
      }
      if (payload.type === "clipboard") {
        updateSessionTab(sessionId, (tab) => ({
          ...tab,
          statusText:
            payload.direction === "local-to-remote"
              ? locale === "zh-CN"
                ? "已同步本地剪贴板"
                : "Clipboard synced"
              : payload.text,
        }));
        return;
      }
      if (payload.type === "error") {
        updateSessionTab(sessionId, (tab) => ({
          ...tab,
          errorMessage: payload.message || payload.code,
          statusText:
            locale === "zh-CN" ? "RDP 运行时异常" : "RDP runtime error",
          perf: { ...tab.perf, bridgeState: "closed" },
        }));
      }
    },
    [locale, updateSessionTab],
  );

  /** 保持最新的回调引用，避免 Worker 因依赖变化频繁重启 */
  const handlersRef = useRef({ locale, updateSessionTab, handleWireEvent });
  useEffect(() => {
    handlersRef.current = { locale, updateSessionTab, handleWireEvent };
  }, [locale, updateSessionTab, handleWireEvent]);

  /** 初始化 Web Worker 和 OffscreenCanvas */
  useEffect(() => {
    if (canvasRef.current && !workerRef.current) {
      try {
        const offscreen = canvasRef.current.transferControlToOffscreen();
        const worker = new Worker(new URL("./rdp.worker.ts", import.meta.url), {
          type: "module",
        });

        worker.postMessage({ type: "init", canvas: offscreen }, [offscreen]);

        worker.onmessage = (
          event: MessageEvent<{
            type: "bridge-state" | "wire-event" | "metrics";
            sessionId: string;
            state?: "open" | "closed" | "error";
            payload?: RdpWireEvent;
            metrics?: Record<string, { fps: number }>;
          }>,
        ) => {
          const { type, sessionId, state, payload, metrics } = event.data;
          const current = handlersRef.current;

          if (type === "bridge-state") {
            current.updateSessionTab(sessionId, (tab) => ({
              ...tab,
              statusText:
                state === "open"
                  ? current.locale === "zh-CN"
                    ? "远端画面已连接"
                    : "Remote surface connected"
                  : current.locale === "zh-CN"
                    ? "桥接连接已关闭"
                    : "Bridge closed",
              perf: {
                ...tab.perf,
                bridgeState: state === "error" ? "closed" : (state ?? "closed"),
              },
            }));
          } else if (type === "wire-event" && payload) {
            current.handleWireEvent(sessionId, payload);
          } else if (type === "metrics" && metrics) {
            setSessions((prev) =>
              prev.map((tab) => {
                const m = metrics[tab.session.sessionId];
                if (!m) return tab;
                return {
                  ...tab,
                  perf: {
                    ...tab.perf,
                    fps: m.fps,
                  },
                };
              }),
            );
          }
        };

        workerRef.current = worker;
      } catch (error) {
        console.error("Failed to initialize RDP Worker:", error);
      }
    }
    return () => {
      // 仅在组件真正销毁时关闭 Worker
      if (closingRef.current || !workerRef.current) {
        workerRef.current?.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    workerRef.current?.postMessage({
      type: "set-active",
      sessionId: activeSessionId,
    });
  }, [activeSessionId]);

  /** 从标签栏移除会话，并在需要时切换到邻近会话。 */
  /** 关闭标签后优先切到相邻标签，避免 activeSessionId 悬空。 */
  const removeSessionTab = useCallback((sessionId: string) => {
    let nextActiveId: string | null = null;
    setSessions((prev) => {
      const index = prev.findIndex(
        (tab) => tab.session.sessionId === sessionId,
      );
      if (index === -1) return prev;
      const nextTabs = prev.filter(
        (tab) => tab.session.sessionId !== sessionId,
      );
      nextActiveId =
        nextTabs[index]?.session.sessionId ??
        nextTabs[index - 1]?.session.sessionId ??
        nextTabs[0]?.session.sessionId ??
        null;
      return nextTabs;
    });
    setActiveSessionId((current) =>
      current === sessionId ? nextActiveId : current,
    );
    workerRef.current?.postMessage({ type: "disconnect", sessionId });
  }, []);

  const resizeRuntimeRef = useRef<{
    timer: number | null;
    inFlight: boolean;
    pending: { width: number; height: number } | null;
    lastRequested: { width: number; height: number } | null;
  }>({
    timer: null,
    inFlight: false,
    pending: null,
    lastRequested: null,
  });

  /** 统一执行后端的尺寸更新。 */
  const flushResize = useCallback(() => {
    const rr = resizeRuntimeRef.current;
    if (!activeTab || rr.inFlight || !rr.pending) return;

    const { width, height } = rr.pending;

    // 过滤重复的相同尺寸请求
    if (
      rr.lastRequested?.width === width &&
      rr.lastRequested?.height === height
    ) {
      rr.pending = null;
      return;
    }

    rr.inFlight = true;
    rr.lastRequested = { width, height };
    rr.pending = null;

    void resizeRdpSession(activeTab.session.sessionId, width, height)
      .then((next) => {
        updateSessionTab(activeTab.session.sessionId, (tab) => ({
          ...tab,
          session: next,
        }));
      })
      .catch(() => {})
      .finally(() => {
        rr.inFlight = false;
        // 如果在执行期间又有新的尺寸需求，递归执行
        if (rr.pending) {
          flushResize();
        }
      });
  }, [activeTab, updateSessionTab]);

  /** 对窗口跟随模式的 resize 做节流收敛。 */
  const scheduleResize = useCallback(
    (width: number, height: number) => {
      const rr = resizeRuntimeRef.current;
      rr.pending = { width, height };

      if (rr.timer !== null) {
        window.clearTimeout(rr.timer);
      }

      // 增加 60ms 的稳定期，防止拖拽过程中的中间态导致闪屏
      rr.timer = window.setTimeout(() => {
        rr.timer = null;
        flushResize();
      }, 60);
    },
    [flushResize],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !activeTab) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || activeTab.profile.resolutionMode !== "window_sync") return;
      if (activePerf.bridgeState !== "open") return;
      const width = Math.max(Math.floor(entry.contentRect.width), 320);
      const height = Math.max(Math.floor(entry.contentRect.height), 200);
      scheduleResize(width, height);
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [
    activePerf.bridgeState,
    activeTab,
    activeTab?.profile.resolutionMode,
    scheduleResize,
  ]);

  /** 在桥接刚进入 open 状态时主动同步一次当前视口尺寸，避免错过首次 ResizeObserver 回调。 */
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !activeTab) return;
    if (activeTab.profile.resolutionMode !== "window_sync") return;
    if (activePerf.bridgeState !== "open") return;

    const rect = surface.getBoundingClientRect();
    const width = Math.max(Math.floor(rect.width), 320);
    const height = Math.max(Math.floor(rect.height), 200);
    scheduleResize(width, height);
  }, [
    activePerf.bridgeState,
    activeTab,
    activeTab?.profile.resolutionMode,
    scheduleResize,
  ]);

  useEffect(() => {
    handleSurfaceBlur();
    if (!activeTab) {
      return;
    }

    workerRef.current?.postMessage({
      type: "connect",
      sessionId: activeTab.session.sessionId,
      url: activeTab.session.wsUrl,
    });

    return () => {
      handleSurfaceBlur();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, activeTab?.session.sessionId, activeTab?.session.wsUrl]);

  /** 子应用只消费已保存的 RDP Profile，不再承担 Profile 配置编辑。 */
  const connectFromProfile = useCallback(
    async (profile: RdpProfile) => {
      setGlobalError("");
      try {
        const created = await createRdpSession(profile.id);
        const connected = await connectRdpSession(created.sessionId);
        const newTab: RdpSessionTab = {
          session: connected,
          profile,
          statusText:
            locale === "zh-CN" ? "正在等待桥接连接" : "Waiting for bridge",
          errorMessage: "",
          perf: { ...EMPTY_PERF },
          remoteCursor: "crosshair",
        };
        setSessions((prev) => [...prev, newTab]);
        setActiveSessionId(connected.sessionId);
      } catch (error) {
        setGlobalError(error instanceof Error ? error.message : String(error));
      }
    },
    [locale],
  );

  /** 主窗口双击 Profile 后只传 profileId，子应用负责解析并真正建立连接。 */
  const handleConnectProfileById = useCallback(
    async (profileId: string) => {
      const resolved = (await listRdpProfiles()).find(
        (item) => item.id === profileId,
      );
      if (!resolved) {
        setGlobalError(
          locale === "zh-CN"
            ? "找不到要连接的 RDP Profile。"
            : "Unable to find the requested RDP profile.",
        );
        return;
      }
      await connectFromProfile(resolved);
    },
    [connectFromProfile, locale],
  );

  /** 关闭窗口前统一断开全部会话，避免后端运行时残留。 */
  const cleanupAllSessions = useCallback(async () => {
    if (cleanupInFlightRef.current) {
      await cleanupInFlightRef.current;
      return;
    }

    const task = (async () => {
      const currentSessions = [...sessionsRef.current];
      if (currentSessions.length === 0) return;

      await Promise.allSettled(
        currentSessions.map(async ({ session }) => {
          try {
            await disconnectRdpSession(session.sessionId);
          } catch {
            // 忽略单个会话断开失败，尽量继续清理剩余会话。
          } finally {
            workerRef.current?.postMessage({
              type: "disconnect",
              sessionId: session.sessionId,
            });
          }
        }),
      );

      setSessions([]);
      setActiveSessionId(null);
      sessionsRef.current = [];
    })();

    cleanupInFlightRef.current = task;
    try {
      await task;
    } finally {
      cleanupInFlightRef.current = null;
    }
  }, []);

  /** 统一执行子应用关闭，确保只触发一次异步清理。 */
  const requestWindowClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    await cleanupAllSessions();
    await getCurrentWindow()
      .close()
      .catch(() => {});
  }, [cleanupAllSessions]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SUBAPP_LIFECYCLE_CHANNEL);
    // 先绑定监听，再上报 ready，避免主窗口在 ready 回调里立即派发的连接命令被首轮挂载吞掉。
    channel.onmessage = (event) => {
      const payload = event.data as SubAppLifecycleMessage | undefined;
      if (!payload) return;
      if (payload.type === "subapp:main-shutdown") {
        void requestWindowClose();
        return;
      }
      if (
        payload.type === "subapp:close-request" &&
        payload.id === id &&
        payload.label === windowLabel
      ) {
        void requestWindowClose();
        return;
      }
      if (
        payload.type === "subapp:rdp-connect" &&
        payload.target.id === id &&
        payload.target.label === windowLabel
      ) {
        void handleConnectProfileById(payload.profileId);
      }
    };
    channel.postMessage({
      type: "subapp:ready",
      id,
      label: windowLabel,
      source: "subapp",
    } satisfies SubAppLifecycleMessage);
    const onUnload = () => {
      channel.postMessage({
        type: "subapp:closed",
        id,
        label: windowLabel,
        source: "subapp",
      } satisfies SubAppLifecycleMessage);
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      channel.close();
    };
  }, [handleConnectProfileById, id, requestWindowClose, windowLabel]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    // 直接关闭子应用窗口时先断开全部 RDP 会话，避免运行时残留影响后续再次连接。
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closingRef.current) return;
        event.preventDefault();
        await requestWindowClose();
      })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [requestWindowClose]);

  /** 主动关闭某个会话标签，并同步断开后端会话。 */
  async function handleCloseSession(sessionId: string) {
    setGlobalError("");
    try {
      await disconnectRdpSession(sessionId);
      removeSessionTab(sessionId);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleActivateSession(sessionId: string) {
    setActiveSessionId(sessionId);
  }

  /** 发送 RDP 输入前先确认当前仍有活动会话。 */
  function sendInput(input: RdpInputEvent) {
    if (!activeTab) return;
    void sendRdpInput(activeTab.session.sessionId, input).catch(() => {});
  }

  /** 统一构造键盘输入负载。 */
  function buildKeyboardInput(
    kind: "key_down" | "key_up",
    event: React.KeyboardEvent<HTMLDivElement>,
  ): RdpInputEvent {
    return {
      kind,
      text: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    };
  }

  /** 记录按下键集合，确保 keydown/keyup 成对发给远端。 */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    event.preventDefault();
    pressedKeysRef.current.add(event.code);
    sendInput(buildKeyboardInput("key_down", event));
  }

  /** 键释放时同步移除本地按下状态。 */
  function handleKeyUp(event: React.KeyboardEvent<HTMLDivElement>) {
    event.preventDefault();
    pressedKeysRef.current.delete(event.code);
    sendInput(buildKeyboardInput("key_up", event));
  }

  /** 远端画面失焦时补发所有 key_up。 */
  function handleSurfaceBlur() {
    if (!activeTab || pressedKeysRef.current.size === 0) return;
    for (const code of pressedKeysRef.current) {
      void sendRdpInput(activeTab.session.sessionId, {
        kind: "key_up",
        code,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }).catch(() => {});
    }
    pressedKeysRef.current.clear();
  }

  /**
   * 将浏览器坐标映射到远端桌面像素坐标。
   */
  function handleMouse(
    kind: string,
    event: React.MouseEvent<HTMLDivElement> | React.WheelEvent<HTMLDivElement>,
  ) {
    if (!activeTab) return;
    if ("currentTarget" in event) {
      event.currentTarget.focus();
    }

    // 输入坐标只认会话当前桌面尺寸，避免状态栏分辨率和输入映射读取两套来源。
    const surface = surfaceRef.current;
    const rect = surface?.getBoundingClientRect();
    const localX = rect ? event.clientX - rect.left : 0;
    const localY = rect ? event.clientY - rect.top : 0;

    const x =
      rect && activeTab.session.width > 0
        ? Math.max(
            0,
            Math.min(
              activeTab.session.width,
              (localX / rect.width) * activeTab.session.width,
            ),
          )
        : 0;
    const y =
      rect && activeTab.session.height > 0
        ? Math.max(
            0,
            Math.min(
              activeTab.session.height,
              (localY / rect.height) * activeTab.session.height,
            ),
          )
        : 0;

    sendInput({
      kind,
      x,
      y,
      button: "button" in event ? event.button : undefined,
      deltaX: "deltaX" in event ? event.deltaX : undefined,
      deltaY: "deltaY" in event ? event.deltaY : undefined,
    });
  }

  /** 响应运行时给出的证书决策请求。 */
  async function handleCertDecision(accept: boolean) {
    if (!activeTab) return;
    try {
      const next = await decideRdpCertificate(
        activeTab.session.sessionId,
        accept,
      );
      updateSessionTab(activeTab.session.sessionId, (tab) => ({
        ...tab,
        session: next,
        statusText: accept
          ? locale === "zh-CN"
            ? "已接受证书"
            : "Certificate accepted"
          : locale === "zh-CN"
            ? "已拒绝证书"
            : "Certificate rejected",
      }));
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="subapp-shell rdp-subapp-shell" data-page="rdp-subapp">
      {!isMac ? <SubAppTitleBar title="FluxTerm" t={t} /> : null}
      <main className="subapp-content rdp-subapp-content">
        <article className="rdp-layout" data-ui="rdp-layout">
          {/* 顶部栏拆成“可滚动标签区 + 固定操作区”，
              避免配置入口跟随标签一起被横向滚走。 */}
          <div className="rdp-tabbar" data-slot="rdp-tabbar">
            <div className="rdp-tabbar-scroll" data-slot="rdp-tablist">
              {sessions.map((tab) => {
                const isActive = tab.session.sessionId === activeSessionId;
                return (
                  <button
                    key={tab.session.sessionId}
                    type="button"
                    className={`rdp-tab ${isActive ? "is-active" : ""}`}
                    data-ui="rdp-tab"
                    onClick={() => handleActivateSession(tab.session.sessionId)}
                  >
                    <span className={`rdp-tab-dot is-${tab.session.state}`} />
                    <span className="rdp-tab-copy">
                      {getProfileDisplayName(tab.profile)}
                    </span>
                    <span
                      className="rdp-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleCloseSession(tab.session.sessionId);
                      }}
                    >
                      ×
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rdp-viewport" data-slot="rdp-viewport">
            {globalError ? (
              <div className="rdp-banner rdp-banner-error">{globalError}</div>
            ) : null}

            <div
              ref={surfaceRef}
              className="rdp-surface"
              data-ui="rdp-viewport-surface"
              style={{ cursor: activeTab?.remoteCursor ?? "default" }}
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onBlur={handleSurfaceBlur}
              onMouseDown={(event) => handleMouse("mouse_down", event)}
              onMouseUp={(event) => handleMouse("mouse_up", event)}
              onMouseMove={(event) => handleMouse("mouse_move", event)}
              onWheel={(event) => handleMouse("wheel", event)}
            >
              {/* 无活动会话时保留 OffscreenCanvas 绑定，但隐藏 DOM canvas，
                  避免最后一帧在空态 overlay 下形成残留黑块。 */}
              <canvas
                ref={canvasRef}
                className={`rdp-canvas ${activeTab ? "" : "is-hidden"}`.trim()}
              />

              {activeTab?.errorMessage ? (
                <div
                  className="rdp-overlay rdp-stage-message"
                  data-ui="rdp-error"
                >
                  <strong>{t("rdp.status.error")}</strong>
                  <span>{activeTab.errorMessage}</span>
                </div>
              ) : null}

              {activeTab?.session.certificatePrompt ? (
                <div
                  className="rdp-overlay rdp-cert-dialog"
                  data-ui="rdp-cert-dialog"
                >
                  <strong>{t("rdp.cert.title")}</strong>
                  <p>{activeTab.session.certificatePrompt.subject}</p>
                  <p>{activeTab.session.certificatePrompt.fingerprint}</p>
                  <div className="rdp-cert-actions">
                    <button
                      type="button"
                      onClick={() => void handleCertDecision(false)}
                    >
                      {t("rdp.cert.reject")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCertDecision(true)}
                    >
                      {t("rdp.cert.accept")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {/* 底栏默认展示状态/活动会话/指标三块信息，
              窄宽度下通过 CSS 收敛成只显示左侧状态。 */}
          <div className="rdp-statusbar" data-slot="rdp-statusbar">
            <div
              className="rdp-footer-section rdp-footer-section-left"
              data-slot="rdp-statusbar-left"
            >
              <p className="rdp-status-line" data-ui="rdp-status">
                {statusLineText}
              </p>
            </div>
            <div
              className="rdp-footer-section rdp-footer-section-center"
              data-slot="rdp-statusbar-center"
            >
              <span className="rdp-session-counter">
                {t("rdp.header.activeSessions", {
                  value: String(sessions.length),
                })}
              </span>
            </div>
            <div
              className="rdp-footer-section rdp-footer-section-right rdp-metrics"
              data-slot="rdp-statusbar-right"
              data-ui="rdp-metrics"
            >
              <span>
                {t("rdp.metrics.fps", { value: String(activePerf.fps) })}
              </span>
              <span>
                {t("rdp.metrics.resolution", {
                  value: getSessionResolutionValue(activeTab?.session ?? null),
                })}
              </span>
              <span>
                {t("rdp.metrics.bridge", {
                  value: t(`rdp.metrics.bridgeState.${activePerf.bridgeState}`),
                })}
              </span>
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}
