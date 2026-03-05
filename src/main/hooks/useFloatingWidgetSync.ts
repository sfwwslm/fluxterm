/**
 * 浮动面板同步通用 Hook。
 * 职责：
 * 1. 统一管理 BroadcastChannel 的生命周期。
 * 2. 抽象主窗口快照广播与浮动窗口请求/接收快照的骨架。
 */
import { useCallback, useEffect, useRef } from "react";
import type { DependencyList } from "react";
import type { WidgetKey } from "@/types";

type UseFloatingWidgetSnapshotSyncOptions<Message> = {
  channelName: string;
  floatingWidgetKey: WidgetKey | null;
  isFloatingWidget: boolean;
  broadcastSnapshot?: (channel: BroadcastChannel) => void;
  onMainWindowMessage?: (message: Message, channel: BroadcastChannel) => void;
  onFloatingWindowMessage?: (message: Message) => void;
  requestSnapshot: (channel: BroadcastChannel) => void;
  deps: DependencyList;
};

/** 管理浮动面板动作消息通道，并返回稳定的发送函数。 */
export function useFloatingWidgetMessagePoster<Message>(
  channelName: string,
  enabled: boolean,
) {
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined" || !enabled) {
      channelRef.current?.close();
      channelRef.current = null;
      return;
    }
    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;
    return () => {
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
      channel.close();
    };
  }, [channelName, enabled]);

  return useCallback((message: Message) => {
    channelRef.current?.postMessage(message);
  }, []);
}

/** 管理主窗口与浮动窗口之间的快照同步骨架。 */
export function useFloatingWidgetSnapshotSync<Message>({
  channelName,
  floatingWidgetKey,
  isFloatingWidget,
  broadcastSnapshot,
  onMainWindowMessage,
  onFloatingWindowMessage,
  requestSnapshot,
  deps,
}: UseFloatingWidgetSnapshotSyncOptions<Message>) {
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(channelName);

    if (!floatingWidgetKey) {
      broadcastSnapshot?.(channel);
      channel.onmessage = (event) => {
        const message = event.data as Message | undefined;
        if (!message) return;
        onMainWindowMessage?.(message, channel);
      };
      return () => {
        channel.close();
      };
    }

    if (isFloatingWidget) {
      channel.onmessage = (event) => {
        const message = event.data as Message | undefined;
        if (!message) return;
        onFloatingWindowMessage?.(message);
      };
      requestSnapshot(channel);
      return () => {
        channel.close();
      };
    }

    channel.close();
    return undefined;
  }, [channelName, floatingWidgetKey, isFloatingWidget, ...deps]);
}
