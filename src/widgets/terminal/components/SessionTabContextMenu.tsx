/**
 * 区域工作区栏中的会话菜单。
 * 这里的关闭类语义都以“当前区域内的会话列表”为作用域。
 */
import {
  FiChevronsRight,
  FiColumns,
  FiCornerDownRight,
  FiMinusCircle,
  FiRefreshCw,
  FiSave,
  FiTrash2,
  FiXCircle,
} from "react-icons/fi";
import ContextMenu from "@/components/ui/menu/ContextMenu";
import type { Translate } from "@/i18n";

type SessionTabContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  onReconnect: () => void;
  onSave: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onCloseCurrent: () => void;
  onCloseAll?: (() => void) | null;
  onCloseOthers?: (() => void) | null;
  onCloseRight?: (() => void) | null;
  t: Translate;
};

/** 标签右键菜单。 */
export default function SessionTabContextMenu({
  x,
  y,
  onClose,
  onReconnect,
  onSave,
  onSplitHorizontal,
  onSplitVertical,
  onCloseCurrent,
  onCloseAll,
  onCloseOthers,
  onCloseRight,
  t,
}: SessionTabContextMenuProps) {
  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        {
          id: "reconnect",
          label: t("terminal.tabMenu.reconnect"),
          icon: <FiRefreshCw />,
          onClick: onReconnect,
        },
        {
          id: "save",
          label: t("terminal.tabMenu.save"),
          icon: <FiSave />,
          onClick: onSave,
        },
        {
          id: "split-horizontal",
          label: t("terminal.tabMenu.splitHorizontal"),
          icon: <FiColumns />,
          onClick: onSplitHorizontal,
        },
        {
          id: "split-vertical",
          label: t("terminal.tabMenu.splitVertical"),
          icon: <FiCornerDownRight />,
          onClick: onSplitVertical,
        },
        {
          id: "close-current",
          label: t("terminal.tabMenu.close"),
          icon: <FiXCircle />,
          danger: true,
          onClick: onCloseCurrent,
        },
        ...(onCloseAll
          ? [
              {
                id: "close-all",
                label: t("terminal.tabMenu.closeAll"),
                icon: <FiTrash2 />,
                danger: true,
                onClick: onCloseAll,
              },
            ]
          : []),
        ...(onCloseOthers
          ? [
              {
                id: "close-others",
                label: t("terminal.tabMenu.closeOthers"),
                icon: <FiMinusCircle />,
                onClick: onCloseOthers,
              },
            ]
          : []),
        ...(onCloseRight
          ? [
              {
                id: "close-right",
                label: t("terminal.tabMenu.closeRight"),
                icon: <FiChevronsRight />,
                onClick: onCloseRight,
              },
            ]
          : []),
      ]}
    />
  );
}
