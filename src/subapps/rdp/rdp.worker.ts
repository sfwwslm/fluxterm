/**
 * @file rdp.worker.ts
 * @description RDP 离屏渲染 Worker。
 * 将 WebSocket 接收、协议解析和 WebGL 渲染完全移出主线程。
 */

import { RdpWebGLRenderer } from "./WebGLRenderer";

type WorkerSessionRuntime = {
  sessionId: string;
  ws: WebSocket | null;
  texture: WebGLTexture | null;
  textureSize: { width: number; height: number };
  pendingFrames: ArrayBuffer[];
  frameRequest: number | null;
  fpsCounter: number;
};

type SessionMetrics = {
  fps: number;
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

type WorkerMessage =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "set-active"; sessionId: string | null }
  | { type: "connect"; sessionId: string; url: string }
  | { type: "disconnect"; sessionId: string };

type MainMessage =
  | {
      type: "bridge-state";
      sessionId: string;
      state: "open" | "closed" | "error";
    }
  | { type: "wire-event"; sessionId: string; payload: RdpWireEvent }
  | { type: "metrics"; metrics: Record<string, SessionMetrics> };

class RdpWorkerContext {
  private renderer: RdpWebGLRenderer | null = null;
  private sessions = new Map<string, WorkerSessionRuntime>();
  private activeSessionId: string | null = null;

  constructor(canvas: OffscreenCanvas) {
    // 强制类型转换为 HTMLCanvasElement 兼容现有 WebGLRenderer 代码
    // 在 WebGL 上下文层面，OffscreenCanvas 和 HTMLCanvasElement 的接口是一致的
    this.renderer = new RdpWebGLRenderer(
      canvas as unknown as HTMLCanvasElement,
    );
  }

  public setActiveSession(sessionId: string | null) {
    this.activeSessionId = sessionId;
    if (!sessionId) {
      // 当前没有活动会话时立即清屏，避免主线程切到空态后仍看到上一帧。
      this.renderer?.clear();
      return;
    }

    const session = this.ensureSession(sessionId);
    if (
      session.texture &&
      session.textureSize.width > 0 &&
      session.textureSize.height > 0
    ) {
      this.renderer?.commit(
        session.texture,
        session.textureSize.width,
        session.textureSize.height,
      );
    } else {
      this.renderer?.clear();
    }
    this.requestRender(sessionId);
  }

  public connect(sessionId: string, url: string) {
    const session = this.ensureSession(sessionId);
    if (session.ws) {
      session.ws.close();
    }

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      self.postMessage({
        type: "bridge-state",
        sessionId,
        state: "open",
      } satisfies MainMessage);
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data) as RdpWireEvent;
          self.postMessage({
            type: "wire-event",
            sessionId,
            payload,
          } satisfies MainMessage);
        } catch {
          // ignore
        }
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.queueFrame(sessionId, event.data);
      }
    };
    ws.onclose = () => {
      self.postMessage({
        type: "bridge-state",
        sessionId,
        state: "closed",
      } satisfies MainMessage);
    };
    ws.onerror = () => {
      self.postMessage({
        type: "bridge-state",
        sessionId,
        state: "error",
      } satisfies MainMessage);
    };
    session.ws = ws;
  }

  public disconnect(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.frameRequest !== null) {
        self.cancelAnimationFrame(session.frameRequest);
        session.frameRequest = null;
      }
      session.ws?.close();
      session.ws = null;
      if (session.texture) {
        this.renderer?.deleteTexture(session.texture);
        session.texture = null;
      }
      this.sessions.delete(sessionId);
    }
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
      // 主动断开当前活动会话时同步清屏，避免最后一帧残留在画布上。
      this.renderer?.clear();
    }
  }

  private ensureSession(sessionId: string): WorkerSessionRuntime {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        ws: null,
        texture: null,
        textureSize: { width: 0, height: 0 },
        pendingFrames: [],
        frameRequest: null,
        fpsCounter: 0,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private queueFrame(sessionId: string, buffer: ArrayBuffer) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pendingFrames.push(buffer);
    this.requestRender(sessionId);
  }

  private requestRender(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.frameRequest !== null) return;

    session.frameRequest = self.requestAnimationFrame(() => {
      session.frameRequest = null;
      // 一个动画帧内批量消费积压脏矩形，减少主线程切换和重复 commit。
      const queue = session.pendingFrames.splice(0);
      for (const buffer of queue) {
        this.drawFrame(session, buffer);
      }

      if (
        this.activeSessionId === sessionId &&
        session.texture &&
        this.renderer
      ) {
        this.renderer.commit(
          session.texture,
          session.textureSize.width,
          session.textureSize.height,
        );
        session.fpsCounter++;
      }
    });
  }

  private drawFrame(session: WorkerSessionRuntime, buffer: ArrayBuffer) {
    if (!this.renderer) return;
    const view = new DataView(buffer);
    const messageType = view.getUint8(0);

    if (messageType === 1) {
      if (view.byteLength < 25) return;
      const x = view.getUint32(1, true);
      const y = view.getUint32(5, true);
      const rectWidth = view.getUint32(9, true);
      const rectHeight = view.getUint32(13, true);
      const surfaceWidth = view.getUint32(17, true);
      const surfaceHeight = view.getUint32(21, true);
      const pixels = new Uint8ClampedArray(buffer, 25);

      if (
        !session.texture ||
        session.textureSize.width !== surfaceWidth ||
        session.textureSize.height !== surfaceHeight
      ) {
        if (session.texture) this.renderer.deleteTexture(session.texture);
        session.texture = this.renderer.createTexture(
          surfaceWidth,
          surfaceHeight,
        );
        session.textureSize = { width: surfaceWidth, height: surfaceHeight };
      }

      this.renderer.uploadRect(
        session.texture,
        x,
        y,
        rectWidth,
        rectHeight,
        pixels,
      );
    } else if (messageType === 2 && view.byteLength >= 13) {
      const surfaceWidth = view.getUint32(1, true);
      const surfaceHeight = view.getUint32(5, true);
      const rectCount = view.getUint32(9, true);

      if (
        !session.texture ||
        session.textureSize.width !== surfaceWidth ||
        session.textureSize.height !== surfaceHeight
      ) {
        if (session.texture) this.renderer.deleteTexture(session.texture);
        session.texture = this.renderer.createTexture(
          surfaceWidth,
          surfaceHeight,
        );
        session.textureSize = { width: surfaceWidth, height: surfaceHeight };
      }

      let offset = 13;
      for (let i = 0; i < rectCount; i++) {
        if (offset + 16 > view.byteLength) break;
        const x = view.getUint32(offset, true);
        const y = view.getUint32(offset + 4, true);
        const rectWidth = view.getUint32(offset + 8, true);
        const rectHeight = view.getUint32(offset + 12, true);
        offset += 16;
        const pixelBytes = rectWidth * rectHeight * 4;
        if (offset + pixelBytes > view.byteLength) break;
        const pixels = new Uint8ClampedArray(buffer, offset, pixelBytes);
        this.renderer.uploadRect(
          session.texture,
          x,
          y,
          rectWidth,
          rectHeight,
          pixels,
        );
        offset += pixelBytes;
      }
    }
  }

  public flushMetrics() {
    const metrics: Record<string, SessionMetrics> = {};
    for (const [id, session] of this.sessions) {
      metrics[id] = {
        fps: session.fpsCounter,
      };
      session.fpsCounter = 0;
    }
    self.postMessage({ type: "metrics", metrics } satisfies MainMessage);
  }
}

let context: RdpWorkerContext | null = null;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const data = event.data;

  switch (data.type) {
    case "init":
      context = new RdpWorkerContext(data.canvas);
      setInterval(() => context?.flushMetrics(), 1000);
      break;
    case "set-active":
      context?.setActiveSession(data.sessionId);
      break;
    case "connect":
      context?.connect(data.sessionId, data.url);
      break;
    case "disconnect":
      context?.disconnect(data.sessionId);
      break;
  }
};
