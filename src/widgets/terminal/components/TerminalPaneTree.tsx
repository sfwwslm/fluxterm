/**
 * 终端 pane 树渲染层。
 * 职责：
 * 1. 递归渲染 split/leaf 结构。
 * 2. 为每个区域输出工作区栏和会话容器。
 * 3. 处理区域内会话拖拽排序与 split resize 交互。
 */
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { FiX } from "react-icons/fi";
import type { DisconnectReason, SessionPaneNode } from "@/types";

type TerminalPaneTreeProps = {
  root: SessionPaneNode;
  activePaneId: string | null;
  getTerminalContainerRef: (
    sessionId: string,
  ) => (element: HTMLDivElement | null) => void;
  isTerminalReady: (sessionId: string) => boolean;
  getSessionLabel: (sessionId: string) => string;
  getSessionState: (sessionId: string) => string;
  getSessionReason: (sessionId: string) => DisconnectReason | null;
  exitHint: string;
  onFocusPane: (paneId: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onReorderPaneSessions: (
    paneId: string,
    sourceSessionId: string,
    targetSessionId: string,
  ) => void;
  onOpenSessionMenu: (payload: {
    x: number;
    y: number;
    paneId: string;
    sessionId: string;
  }) => void;
  onClosePaneSession: (paneId: string, sessionId: string) => void;
  onResizePaneSplit: (paneId: string, ratio: number) => void;
  onPaneClick: (sessionId: string, event: MouseEvent<HTMLDivElement>) => void;
  onPaneContextMenu: (
    sessionId: string,
    event: MouseEvent<HTMLDivElement>,
  ) => void;
  autocomplete: {
    sessionId: string;
    items: Array<{ command: string; useCount: number }>;
    selectedIndex: number;
  } | null;
  autocompleteAnchor: {
    offset: number;
    maxHeight: number;
    placement: "top" | "bottom";
    left: number;
  } | null;
  onApplyAutocompleteSuggestion: (command?: string) => void;
};

/** 会话 pane 树。 */
export default function TerminalPaneTree(props: TerminalPaneTreeProps) {
  const hasSplitPanes = props.root.kind === "split";
  return (
    <div className="terminal-pane-tree">
      <div className="terminal-split terminal-split-single">
        <div className="terminal-split-slot">
          <PaneNodeView
            {...props}
            node={props.root}
            hasSplitPanes={hasSplitPanes}
          />
        </div>
      </div>
    </div>
  );
}

type PaneNodeViewProps = Omit<TerminalPaneTreeProps, "root"> & {
  node: SessionPaneNode;
  hasSplitPanes: boolean;
};

function PaneNodeView({
  node,
  activePaneId,
  getTerminalContainerRef,
  isTerminalReady,
  getSessionLabel,
  getSessionState,
  getSessionReason,
  exitHint,
  onFocusPane,
  onSwitchSession,
  onReorderPaneSessions,
  onOpenSessionMenu,
  onClosePaneSession,
  onResizePaneSplit,
  onPaneClick,
  onPaneContextMenu,
  autocomplete,
  autocompleteAnchor,
  onApplyAutocompleteSuggestion,
  hasSplitPanes,
}: PaneNodeViewProps) {
  if (node.kind === "split") {
    const firstBasis = `${node.ratio * 100}%`;
    const secondBasis = `${(1 - node.ratio) * 100}%`;
    return (
      <div className={`terminal-split terminal-split-${node.axis}`}>
        <div className="terminal-split-slot" style={{ flexBasis: firstBasis }}>
          <PaneNodeView
            node={node.first}
            activePaneId={activePaneId}
            getTerminalContainerRef={getTerminalContainerRef}
            isTerminalReady={isTerminalReady}
            getSessionLabel={getSessionLabel}
            getSessionState={getSessionState}
            getSessionReason={getSessionReason}
            exitHint={exitHint}
            onFocusPane={onFocusPane}
            onSwitchSession={onSwitchSession}
            onReorderPaneSessions={onReorderPaneSessions}
            onOpenSessionMenu={onOpenSessionMenu}
            onClosePaneSession={onClosePaneSession}
            onResizePaneSplit={onResizePaneSplit}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            autocomplete={autocomplete}
            autocompleteAnchor={autocompleteAnchor}
            onApplyAutocompleteSuggestion={onApplyAutocompleteSuggestion}
            hasSplitPanes={hasSplitPanes}
          />
        </div>
        <PaneResizeHandle
          axis={node.axis}
          onResize={(ratio) => {
            const targetPaneId = resolveSplitResizeTargetPaneId(node);
            if (!targetPaneId) return;
            onResizePaneSplit(targetPaneId, ratio);
          }}
        />
        <div className="terminal-split-slot" style={{ flexBasis: secondBasis }}>
          <PaneNodeView
            node={node.second}
            activePaneId={activePaneId}
            getTerminalContainerRef={getTerminalContainerRef}
            isTerminalReady={isTerminalReady}
            getSessionLabel={getSessionLabel}
            getSessionState={getSessionState}
            getSessionReason={getSessionReason}
            exitHint={exitHint}
            onFocusPane={onFocusPane}
            onSwitchSession={onSwitchSession}
            onReorderPaneSessions={onReorderPaneSessions}
            onOpenSessionMenu={onOpenSessionMenu}
            onClosePaneSession={onClosePaneSession}
            onResizePaneSplit={onResizePaneSplit}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            autocomplete={autocomplete}
            autocompleteAnchor={autocompleteAnchor}
            onApplyAutocompleteSuggestion={onApplyAutocompleteSuggestion}
            hasSplitPanes={hasSplitPanes}
          />
        </div>
      </div>
    );
  }

  // 单工作区时外层 terminal-widget 已有边框，pane 内层不再重复显示激活边框；
  // 只有拆分出多个工作区后，才用 pane 激活边框表达当前聚焦区域。
  const activePane = hasSplitPanes && node.paneId === activePaneId;
  const paneActiveSessionId =
    node.activeSessionId ?? node.sessionIds[node.sessionIds.length - 1] ?? null;
  const showExitBanner =
    !!paneActiveSessionId &&
    getSessionState(paneActiveSessionId) === "disconnected" &&
    getSessionReason(paneActiveSessionId) === "exit";
  const paneAutocomplete =
    paneActiveSessionId && autocomplete?.sessionId === paneActiveSessionId
      ? autocomplete
      : null;
  const paneAutocompleteAnchor = paneAutocomplete ? autocompleteAnchor : null;

  return (
    <div
      className={`terminal-pane ${activePane ? "active" : ""}`}
      onMouseDown={() => onFocusPane(node.paneId)}
    >
      <div className="terminal-header">
        <div className="session-tabs">
          {node.sessionIds.map((sessionId, index) => {
            const sessionActive = sessionId === paneActiveSessionId;
            const disconnected = getSessionState(sessionId) === "disconnected";
            const showCloseButton = sessionActive;
            // 标签序号按当前 pane 内顺序独立计算，分屏后各区域都从 1 开始。
            const sessionLabel = `${index + 1}. ${getSessionLabel(sessionId)}`;
            return (
              <div
                key={sessionId}
                data-pane-session-id={sessionId}
                className={`session-tab session-tab-trigger-inline ${
                  sessionActive ? "active" : ""
                } ${disconnected ? "disconnected" : ""} ${
                  showCloseButton ? "show-close" : ""
                }`}
                onPointerDown={(event) =>
                  handleSessionPointerDown(
                    event,
                    node.paneId,
                    sessionId,
                    onReorderPaneSessions,
                  )
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onFocusPane(node.paneId);
                  onSwitchSession(sessionId);
                  onOpenSessionMenu({
                    x: event.clientX,
                    y: event.clientY,
                    paneId: node.paneId,
                    sessionId,
                  });
                }}
              >
                <button
                  type="button"
                  className="session-tab-trigger"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFocusPane(node.paneId);
                    onSwitchSession(sessionId);
                  }}
                >
                  {sessionLabel}
                </button>
                {showCloseButton && (
                  <button
                    type="button"
                    className="close"
                    aria-label="close-pane-session"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClosePaneSession(node.paneId, sessionId);
                    }}
                  >
                    <FiX />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="terminal-pane-content">
        {node.sessionIds.map((sessionId) => {
          const activeSession = sessionId === paneActiveSessionId;
          const showAutocomplete =
            activeSession &&
            paneAutocomplete &&
            paneAutocompleteAnchor &&
            paneAutocomplete.items.length > 0;
          return (
            <div
              key={sessionId}
              className={`terminal-container-shell ${activeSession ? "active" : ""}`}
            >
              <div
                className={`terminal-container ${activeSession ? "active" : ""} ${
                  isTerminalReady(sessionId) ? "ready" : ""
                }`}
                ref={getTerminalContainerRef(sessionId)}
                onClick={(event) => onPaneClick(sessionId, event)}
                onContextMenu={(event) => onPaneContextMenu(sessionId, event)}
              />
              {showAutocomplete && (
                <div
                  className={`terminal-autocomplete terminal-autocomplete-${paneAutocompleteAnchor.placement}`}
                  style={{
                    left: `${paneAutocompleteAnchor.left}px`,
                    [paneAutocompleteAnchor.placement === "top"
                      ? "bottom"
                      : "top"]: `${paneAutocompleteAnchor.offset}px`,
                    maxHeight: `${paneAutocompleteAnchor.maxHeight}px`,
                  }}
                >
                  {paneAutocomplete.items.map((item, index) => (
                    <button
                      key={item.command}
                      type="button"
                      className={`terminal-autocomplete-item ${
                        index === paneAutocomplete.selectedIndex ? "active" : ""
                      }`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onApplyAutocompleteSuggestion(item.command);
                      }}
                    >
                      <span className="terminal-autocomplete-command">
                        {item.command}
                      </span>
                      <span className="terminal-autocomplete-meta">
                        {item.useCount}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {showExitBanner && <div className="terminal-banner">{exitHint}</div>}
      </div>
    </div>
  );
}

type PaneResizeHandleProps = {
  axis: "horizontal" | "vertical";
  onResize: (ratio: number) => void;
};

function PaneResizeHandle({ axis, onResize }: PaneResizeHandleProps) {
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const container = handle.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onPointerMove = (moveEvent: PointerEvent) => {
      const ratio =
        axis === "horizontal"
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
      onResize(ratio);
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  return (
    <div
      className={`terminal-split-handle terminal-split-handle-${axis}`}
      onPointerDown={handlePointerDown}
    />
  );
}

function handleSessionPointerDown(
  event: ReactPointerEvent<HTMLElement>,
  paneId: string,
  sessionId: string,
  onReorderPaneSessions: (
    paneId: string,
    sourceSessionId: string,
    targetSessionId: string,
  ) => void,
) {
  if (event.button !== 0) return;
  const sourceElement = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  let highlightedTarget: HTMLElement | null = null;
  sourceElement.classList.add("dragging");
  const onPointerMove = (moveEvent: PointerEvent) => {
    if (
      Math.abs(moveEvent.clientX - startX) > 4 ||
      Math.abs(moveEvent.clientY - startY) > 4
    ) {
      moved = true;
    }
    const nextTarget = document
      .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
      ?.closest<HTMLElement>("[data-pane-session-id]");
    if (highlightedTarget && highlightedTarget !== nextTarget) {
      highlightedTarget.classList.remove("drop-target");
      highlightedTarget = null;
    }
    if (nextTarget && nextTarget !== sourceElement) {
      nextTarget.classList.add("drop-target");
      highlightedTarget = nextTarget;
    }
  };
  const onPointerUp = (upEvent: PointerEvent) => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    sourceElement.classList.remove("dragging");
    highlightedTarget?.classList.remove("drop-target");
    if (!moved) return;
    const target = document
      .elementFromPoint(upEvent.clientX, upEvent.clientY)
      ?.closest<HTMLElement>("[data-pane-session-id]");
    const targetSessionId = target?.dataset.paneSessionId;
    if (!targetSessionId || targetSessionId === sessionId) return;
    onReorderPaneSessions(paneId, sessionId, targetSessionId);
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function findFirstLeafPaneId(node: SessionPaneNode): string | null {
  if (node.kind === "leaf") return node.paneId;
  return findFirstLeafPaneId(node.first) ?? findFirstLeafPaneId(node.second);
}

/** split 比例挂在父节点上，因此拖拽句柄只需定位该 split 下任意一个叶子 pane 即可。 */
function resolveSplitResizeTargetPaneId(
  node: Extract<SessionPaneNode, { kind: "split" }>,
) {
  return findFirstLeafPaneId(node.first) ?? findFirstLeafPaneId(node.second);
}
