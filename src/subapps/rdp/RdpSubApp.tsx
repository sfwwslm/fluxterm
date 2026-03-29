import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Locale, Translate } from "@/i18n";
import {
  createTraceId,
  logTelemetry,
  type TelemetryLevel,
} from "@/shared/logging/telemetry";
import type {
  RdpDisplayStrategy,
  RdpInputEvent,
  RdpProfile,
  RdpSessionSnapshot,
} from "@/types";
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

type RdpWorkerPerfSnapshot = {
  frameMessages: number;
  rectUploads: number;
  uploadedPixels: number;
  queueHighWatermark: number;
  presentCount: number;
  avgPresentCpuMs: number;
  windowMs: number;
};

type RdpSessionTab = {
  session: RdpSessionSnapshot;
  profile: RdpProfile;
  traceId: string;
  statusText: string;
  errorMessage: string;
  perf: RdpPerfSnapshot;
  remoteCursor: string;
};

const EMPTY_PERF: RdpPerfSnapshot = {
  fps: 0,
  bridgeState: "idle",
};
const RDP_WORKER_PERF_SNAPSHOT_EVENT = "rdp.worker.perf.snapshot";

function getProfileDisplayName(
  profile: Pick<RdpProfile, "name" | "host">,
  t: Translate,
) {
  return (
    profile.name.trim() || profile.host.trim() || t("rdp.profile.fallbackName")
  );
}

function getSessionResolutionValue(session: RdpSessionSnapshot | null) {
  if (!session) return "--";
  if (session.width <= 0 || session.height <= 0) return "--";
  return `${session.width} × ${session.height}`;
}

function logRdpSubAppEvent(
  level: TelemetryLevel,
  event: string,
  fields?: Record<string, unknown>,
) {
  void logTelemetry(level, event, fields);
}

/** 读取当前 RDP 视口尺寸，并做基础下限收敛。 */
function measureSurfaceViewport(surface: HTMLDivElement | null) {
  if (!surface) return null;
  const rect = surface.getBoundingClientRect();
  const width = Math.max(
    Math.floor(surface.clientWidth || rect.width || 0),
    320,
  );
  const height = Math.max(
    Math.floor(surface.clientHeight || rect.height || 0),
    200,
  );
  return { width, height };
}

/** 等待自动开窗后的视口尺寸稳定，避免首屏仍拿到过渡态大小。 */
async function waitForStableSurfaceViewport(
  surface: HTMLDivElement | null,
  minStableFrames = 2,
  maxFrames = 12,
) {
  if (!surface) return null;

  let previous: { width: number; height: number } | null = null;
  let stableFrames = 0;

  for (let frame = 0; frame < maxFrames; frame += 1) {
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    const measured = measureSurfaceViewport(surface);
    if (!measured) continue;

    if (
      previous &&
      previous.width === measured.width &&
      previous.height === measured.height
    ) {
      stableFrames += 1;
      if (stableFrames >= minStableFrames) {
        return measured;
      }
    } else {
      stableFrames = 0;
      previous = measured;
    }
  }

  return measureSurfaceViewport(surface);
}

/** 根据显示策略计算远端画面在当前视口中的实际显示区域。 */
function resolveDisplayedFrameRect(
  surfaceRect: DOMRect,
  remoteWidth: number,
  remoteHeight: number,
  strategy: RdpDisplayStrategy,
) {
  if (strategy === "stretch") {
    return {
      left: surfaceRect.left,
      top: surfaceRect.top,
      width: surfaceRect.width,
      height: surfaceRect.height,
    };
  }

  const safeRemoteWidth = Math.max(remoteWidth, 1);
  const safeRemoteHeight = Math.max(remoteHeight, 1);
  const widthScale = surfaceRect.width / safeRemoteWidth;
  const heightScale = surfaceRect.height / safeRemoteHeight;
  const scale =
    strategy === "cover"
      ? Math.max(widthScale, heightScale)
      : Math.min(widthScale, heightScale);
  const displayedWidth = safeRemoteWidth * scale;
  const displayedHeight = safeRemoteHeight * scale;
  const offsetX = (surfaceRect.width - displayedWidth) / 2;
  const offsetY = (surfaceRect.height - displayedHeight) / 2;

  return {
    left: surfaceRect.left + offsetX,
    top: surfaceRect.top + offsetY,
    width: displayedWidth,
    height: displayedHeight,
  };
}

/** 将配置中的显示策略映射为 canvas 的 object-fit。 */
function getCanvasObjectFit(strategy: RdpDisplayStrategy) {
  switch (strategy) {
    case "cover":
      return "cover";
    case "stretch":
      return "fill";
    default:
      return "contain";
  }
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
  const activeSessionIdRef = useRef<string | null>(null);
  const frameVersionBySessionRef = useRef<Record<string, number>>({});
  const presentedFpsRuntimeRef = useRef<{
    frameCount: number;
    windowStartAt: number;
    lastSeenFrameVersion: number;
    lastReportedFps: number;
    rafId: number | null;
  }>({
    frameCount: 0,
    windowStartAt: 0,
    lastSeenFrameVersion: 0,
    lastReportedFps: -1,
    rafId: null,
  });

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const activeTab = useMemo(
    () =>
      sessions.find((item) => item.session.sessionId === activeSessionId) ??
      null,
    [activeSessionId, sessions],
  );

  const activePerf = activeTab?.perf ?? EMPTY_PERF;
  const statusLineText =
    activeTab?.statusText ?? t("rdp.status.noActiveSession");

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

  /** 重置当前活动会话的可见呈现 FPS 采样窗口，避免切换标签后沿用旧计数。 */
  const resetPresentedFpsSampler = useCallback(
    (sessionId: string | null) => {
      const runtime = presentedFpsRuntimeRef.current;
      runtime.frameCount = 0;
      runtime.windowStartAt = performance.now();
      runtime.lastSeenFrameVersion = sessionId
        ? (frameVersionBySessionRef.current[sessionId] ?? 0)
        : 0;
      runtime.lastReportedFps = -1;
      if (sessionId) {
        updateSessionTab(sessionId, (tab) => ({
          ...tab,
          perf: { ...tab.perf, fps: 0 },
        }));
      }
    },
    [updateSessionTab],
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
              : (payload.message ?? tab.statusText),
          errorMessage:
            payload.state === "error"
              ? tab.errorMessage || t("rdp.status.sessionErrorHint")
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
              ? t("rdp.status.clipboardSynced")
              : payload.text,
        }));
        return;
      }
      if (payload.type === "error") {
        updateSessionTab(sessionId, (tab) => ({
          ...tab,
          errorMessage: payload.message || payload.code,
          statusText: t("rdp.status.runtimeError"),
          perf: { ...tab.perf, bridgeState: "closed" },
        }));
      }
    },
    [t, updateSessionTab],
  );

  /** 保持最新的回调引用，避免 Worker 因依赖变化频繁重启 */
  const handlersRef = useRef({
    locale,
    t,
    updateSessionTab,
    handleWireEvent,
    resetPresentedFpsSampler,
  });
  useEffect(() => {
    handlersRef.current = {
      locale,
      t,
      updateSessionTab,
      handleWireEvent,
      resetPresentedFpsSampler,
    };
  }, [locale, t, updateSessionTab, handleWireEvent, resetPresentedFpsSampler]);

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
            type:
              | "bridge-state"
              | "wire-event"
              | "frame-presented"
              | "perf-snapshot";
            sessionId: string;
            state?: "open" | "closed" | "error";
            payload?: RdpWireEvent;
            frameVersion?: number;
            perf?: RdpWorkerPerfSnapshot;
          }>,
        ) => {
          const { type, sessionId, state, payload, frameVersion, perf } =
            event.data;
          const current = handlersRef.current;

          if (type === "bridge-state") {
            const traceId =
              sessionsRef.current.find(
                (tab) => tab.session.sessionId === sessionId,
              )?.traceId ?? null;
            if (state === "open") {
              logRdpSubAppEvent("info", "rdp.bridge.open", {
                traceId,
                sessionId,
              });
            } else if (state === "error") {
              logRdpSubAppEvent("warn", "rdp.bridge.failed", {
                traceId,
                sessionId,
              });
            } else {
              logRdpSubAppEvent("info", "rdp.bridge.close", {
                traceId,
                sessionId,
              });
            }
            current.updateSessionTab(sessionId, (tab) => ({
              ...tab,
              perf: {
                ...tab.perf,
                bridgeState: state === "error" ? "closed" : (state ?? "closed"),
              },
            }));
            if (state !== "open") {
              current.resetPresentedFpsSampler(
                activeSessionIdRef.current === sessionId ? sessionId : null,
              );
            }
          } else if (type === "wire-event" && payload) {
            current.handleWireEvent(sessionId, payload);
          } else if (
            type === "frame-presented" &&
            typeof frameVersion === "number"
          ) {
            frameVersionBySessionRef.current[sessionId] = frameVersion;
          } else if (type === "perf-snapshot" && perf) {
            const tab = sessionsRef.current.find(
              (item) => item.session.sessionId === sessionId,
            );
            logRdpSubAppEvent("debug", RDP_WORKER_PERF_SNAPSHOT_EVENT, {
              traceId: tab?.traceId ?? null,
              sessionId,
              frameMessages: perf.frameMessages,
              rectUploads: perf.rectUploads,
              uploadedPixels: perf.uploadedPixels,
              queueHighWatermark: perf.queueHighWatermark,
              presentCount: perf.presentCount,
              avgPresentCpuMs: perf.avgPresentCpuMs,
              windowMs: perf.windowMs,
            });
          }
        };

        workerRef.current = worker;
      } catch (error) {
        logRdpSubAppEvent("error", "rdp.worker.init.failed", {
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  name: error.name,
                }
              : { message: String(error) },
        });
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
    resetPresentedFpsSampler(activeSessionId);
  }, [activeSessionId, resetPresentedFpsSampler]);

  useEffect(() => {
    const runtime = presentedFpsRuntimeRef.current;

    /**
     * 当前 FPS 是“可见呈现估算值”：
     * 1. 仅在窗口可见、桥接已打开且活动会话画面版本实际变化时计数；
     * 2. 它比 worker 内部的提交次数更接近用户看到的画面变化频率；
     * 3. 但它仍无法观测 WebView/Tauri 宿主合成、系统 VSync、显示器刷新和遮挡后的最终上屏结果，
     *    因此不是严格意义上的“用户肉眼实际看到的真实 FPS”。
     */
    const tick = (now: number) => {
      const sessionId = activeSessionId;
      if (
        sessionId &&
        document.visibilityState === "visible" &&
        activePerf.bridgeState === "open"
      ) {
        const frameVersion = frameVersionBySessionRef.current[sessionId] ?? 0;
        if (frameVersion !== runtime.lastSeenFrameVersion) {
          runtime.lastSeenFrameVersion = frameVersion;
          runtime.frameCount += 1;
        }

        if (runtime.windowStartAt === 0) {
          runtime.windowStartAt = now;
        }

        const elapsed = now - runtime.windowStartAt;
        if (elapsed >= 1000) {
          const fps = Math.round((runtime.frameCount * 1000) / elapsed);
          if (fps !== runtime.lastReportedFps) {
            updateSessionTab(sessionId, (tab) => ({
              ...tab,
              perf: { ...tab.perf, fps },
            }));
            runtime.lastReportedFps = fps;
          }
          runtime.frameCount = 0;
          runtime.windowStartAt = now;
        }
      } else if (sessionId) {
        if (runtime.lastReportedFps !== 0) {
          updateSessionTab(sessionId, (tab) => ({
            ...tab,
            perf: { ...tab.perf, fps: 0 },
          }));
          runtime.lastReportedFps = 0;
        }
        runtime.frameCount = 0;
        runtime.windowStartAt = now;
        runtime.lastSeenFrameVersion =
          frameVersionBySessionRef.current[sessionId] ?? 0;
      }

      runtime.rafId = window.requestAnimationFrame(tick);
    };

    runtime.rafId = window.requestAnimationFrame(tick);
    return () => {
      if (runtime.rafId !== null) {
        window.cancelAnimationFrame(runtime.rafId);
        runtime.rafId = null;
      }
    };
  }, [activePerf.bridgeState, activeSessionId, updateSessionTab]);

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

    void resizeRdpSession(activeTab.session.sessionId, width, height, {
      traceId: activeTab.traceId,
    })
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
    async (profile: RdpProfile, traceId = createTraceId()) => {
      setGlobalError("");
      try {
        let initialSize: { width: number; height: number } | undefined;
        if (profile.resolutionMode === "window_sync") {
          initialSize =
            (await waitForStableSurfaceViewport(surfaceRef.current)) ??
            undefined;
          if (!initialSize) {
            throw new Error(t("rdp.error.viewportUnavailable"));
          }
        }
        const created = await createRdpSession(profile.id, initialSize, {
          traceId,
        });
        const connected = await connectRdpSession(created.sessionId, {
          traceId,
        });
        const newTab: RdpSessionTab = {
          session: connected,
          profile,
          traceId,
          statusText: t("rdp.status.waitingBridge"),
          errorMessage: "",
          perf: { ...EMPTY_PERF },
          remoteCursor: "crosshair",
        };
        setSessions((prev) => [...prev, newTab]);
        setActiveSessionId(connected.sessionId);
      } catch (error) {
        logRdpSubAppEvent("warn", "rdp.session.launch.failed", {
          traceId,
          profileId: profile.id,
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  name: error.name,
                }
              : { message: String(error) },
        });
        setGlobalError(error instanceof Error ? error.message : String(error));
      }
    },
    [t],
  );

  /** 主窗口双击 Profile 后只传 profileId，子应用负责解析并真正建立连接。 */
  const handleConnectProfileById = useCallback(
    async (profileId: string) => {
      const traceId = createTraceId();
      const resolved = (await listRdpProfiles({ traceId })).find(
        (item) => item.id === profileId,
      );
      if (!resolved) {
        logRdpSubAppEvent("warn", "rdp.profile.resolve.failed", {
          traceId,
          profileId,
        });
        setGlobalError(t("rdp.error.profileNotFound"));
        return;
      }
      await connectFromProfile(resolved, traceId);
    },
    [connectFromProfile, t],
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
          const traceId =
            sessionsRef.current.find(
              (tab) => tab.session.sessionId === session.sessionId,
            )?.traceId ?? createTraceId();
          try {
            await disconnectRdpSession(session.sessionId, { traceId });
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
    const traceId =
      sessionsRef.current.find((tab) => tab.session.sessionId === sessionId)
        ?.traceId ?? createTraceId();
    try {
      await disconnectRdpSession(sessionId, { traceId });
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

  /** 前端只做事件采集与字段透传，Unicode / 扫描码分流由后端运行时统一决定。 */
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

  /** 远端画面失焦时补发所有 key_up，避免修饰键在远端会话中卡住。 */
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

    const surface = surfaceRef.current;
    const surfaceRect = surface?.getBoundingClientRect();
    const frameRect =
      surfaceRect && activeTab.session.width > 0 && activeTab.session.height > 0
        ? resolveDisplayedFrameRect(
            surfaceRect,
            activeTab.session.width,
            activeTab.session.height,
            activeTab.profile.displayStrategy,
          )
        : null;
    const localX = frameRect ? event.clientX - frameRect.left : 0;
    const localY = frameRect ? event.clientY - frameRect.top : 0;

    const x =
      frameRect && activeTab.session.width > 0
        ? Math.max(
            0,
            Math.min(
              activeTab.session.width,
              (localX / frameRect.width) * activeTab.session.width,
            ),
          )
        : 0;
    const y =
      frameRect && activeTab.session.height > 0
        ? Math.max(
            0,
            Math.min(
              activeTab.session.height,
              (localY / frameRect.height) * activeTab.session.height,
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
        { traceId: activeTab.traceId },
      );
      updateSessionTab(activeTab.session.sessionId, (tab) => ({
        ...tab,
        session: next,
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
                      {getProfileDisplayName(tab.profile, t)}
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
                style={{
                  objectFit: activeTab
                    ? getCanvasObjectFit(activeTab.profile.displayStrategy)
                    : "contain",
                }}
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
