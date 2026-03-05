/**
 * 终端右键菜单局部状态 Hook。
 * 统一管理：
 * - 终端正文右键菜单
 * - 区域工作区栏会话菜单
 * - 链接操作菜单
 */
import { useState } from "react";
import {
  FiCpu,
  FiClipboard,
  FiCopy,
  FiExternalLink,
  FiSearch,
  FiSlash,
} from "react-icons/fi";
import type { Translate } from "@/i18n";
import ContextMenu from "@/components/ui/menu/ContextMenu";
import SessionTabContextMenu from "@/widgets/terminal/components/SessionTabContextMenu";

type TerminalContextMenuProps = {
  activeSessionId: string | null;
  activeLinkMenu: { x: number; y: number; uri: string } | null;
  hasFocusedLine: () => boolean;
  hasActiveSelection: () => boolean;
  getActiveSelectionText: () => string;
  onCopyFocusedLine: () => Promise<boolean>;
  onCopySelection: () => Promise<boolean>;
  onSendSelectionToAi: (selectionText: string) => Promise<void>;
  onPaste: () => Promise<boolean>;
  onClear: () => boolean;
  onOpenSearch: () => void;
  onOpenLink: () => Promise<boolean>;
  onCopyLink: () => Promise<boolean>;
  onCloseLinkMenu: () => void;
  onFocusPane: (paneId: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onReconnectSession: (sessionId: string) => Promise<void>;
  onSaveSession: (sessionId: string) => Promise<void>;
  onSplitActivePane: (axis: "horizontal" | "vertical") => Promise<void>;
  onClosePaneSession: (paneId: string, sessionId: string) => Promise<void>;
  onCloseOtherSessionsInPane: (
    paneId: string,
    sessionId: string,
  ) => Promise<void>;
  onCloseSessionsToRightInPane: (
    paneId: string,
    sessionId: string,
  ) => Promise<void>;
  onCloseAllSessionsInPane: (paneId: string) => Promise<void>;
  t: Translate;
};

type SessionMenuState = {
  x: number;
  y: number;
  paneId: string;
  sessionId: string;
};

/** 终端右键菜单局部状态 Hook。 */
export default function useTerminalMenus({
  activeSessionId,
  activeLinkMenu,
  hasFocusedLine,
  hasActiveSelection,
  getActiveSelectionText,
  onCopyFocusedLine,
  onCopySelection,
  onSendSelectionToAi,
  onPaste,
  onClear,
  onOpenSearch,
  onOpenLink,
  onCopyLink,
  onCloseLinkMenu,
  onFocusPane,
  onSwitchSession,
  onReconnectSession,
  onSaveSession,
  onSplitActivePane,
  onClosePaneSession,
  onCloseOtherSessionsInPane,
  onCloseSessionsToRightInPane,
  onCloseAllSessionsInPane,
  t,
}: TerminalContextMenuProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);

  function closeMenu() {
    setMenu(null);
  }

  return {
    openTerminalMenu: (x: number, y: number) => {
      onCloseLinkMenu();
      setMenu({ x, y });
    },
    openSessionMenu: (payload: SessionMenuState) => {
      onFocusPane(payload.paneId);
      onSwitchSession(payload.sessionId);
      setSessionMenu(payload);
    },
    renderedMenus: (
      <>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              {
                id: "copy",
                label: t("terminal.menu.copy"),
                icon: <FiCopy />,
                disabled: !hasFocusedLine() && !hasActiveSelection(),
                onClick: () => {
                  if (hasActiveSelection()) {
                    onCopySelection().catch(() => {});
                  } else {
                    onCopyFocusedLine().catch(() => {});
                  }
                  closeMenu();
                },
              },
              {
                id: "send-selection-to-ai",
                label: t("terminal.menu.sendToAi"),
                icon: <FiCpu />,
                disabled: !activeSessionId || !hasActiveSelection(),
                onClick: () => {
                  const selectionText = getActiveSelectionText();
                  if (!selectionText.trim()) {
                    closeMenu();
                    return;
                  }
                  onSendSelectionToAi(selectionText).catch(() => {});
                  closeMenu();
                },
              },
              {
                id: "paste",
                label: t("terminal.menu.paste"),
                icon: <FiClipboard />,
                disabled: !activeSessionId,
                onClick: () => {
                  onPaste().catch(() => {});
                  closeMenu();
                },
              },
              {
                id: "clear",
                label: t("terminal.menu.clear"),
                icon: <FiSlash />,
                disabled: !activeSessionId,
                onClick: () => {
                  onClear();
                  closeMenu();
                },
              },
              {
                id: "search",
                label: t("terminal.menu.search"),
                icon: <FiSearch />,
                disabled: !activeSessionId,
                onClick: () => {
                  closeMenu();
                  onOpenSearch();
                },
              },
            ]}
            onClose={closeMenu}
          />
        )}
        {sessionMenu && (
          <SessionTabContextMenu
            x={sessionMenu.x}
            y={sessionMenu.y}
            onClose={() => setSessionMenu(null)}
            onReconnect={() => {
              onReconnectSession(sessionMenu.sessionId).catch(() => {});
              setSessionMenu(null);
            }}
            onSave={() => {
              onSaveSession(sessionMenu.sessionId).catch(() => {});
              setSessionMenu(null);
            }}
            onSplitHorizontal={() => {
              onFocusPane(sessionMenu.paneId);
              onSwitchSession(sessionMenu.sessionId);
              onSplitActivePane("horizontal").catch(() => {});
              setSessionMenu(null);
            }}
            onSplitVertical={() => {
              onFocusPane(sessionMenu.paneId);
              onSwitchSession(sessionMenu.sessionId);
              onSplitActivePane("vertical").catch(() => {});
              setSessionMenu(null);
            }}
            onCloseCurrent={() => {
              onClosePaneSession(
                sessionMenu.paneId,
                sessionMenu.sessionId,
              ).catch(() => {});
              setSessionMenu(null);
            }}
            onCloseAll={() => {
              onCloseAllSessionsInPane(sessionMenu.paneId).catch(() => {});
              setSessionMenu(null);
            }}
            onCloseOthers={() => {
              onCloseOtherSessionsInPane(
                sessionMenu.paneId,
                sessionMenu.sessionId,
              ).catch(() => {});
              setSessionMenu(null);
            }}
            onCloseRight={() => {
              onCloseSessionsToRightInPane(
                sessionMenu.paneId,
                sessionMenu.sessionId,
              ).catch(() => {});
              setSessionMenu(null);
            }}
            t={t}
          />
        )}
        {activeLinkMenu && (
          <ContextMenu
            x={activeLinkMenu.x}
            y={activeLinkMenu.y}
            items={[
              {
                id: "open-link",
                label: t("terminal.menu.openLink"),
                icon: <FiExternalLink />,
                onClick: () => {
                  onOpenLink().catch(() => {});
                },
              },
              {
                id: "copy-link",
                label: t("terminal.menu.copyLink"),
                icon: <FiCopy />,
                onClick: () => {
                  onCopyLink().catch(() => {});
                },
              },
            ]}
            onClose={onCloseLinkMenu}
          />
        )}
      </>
    ),
  };
}
