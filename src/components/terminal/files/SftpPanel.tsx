import { useState } from "react";
import type { Locale, Translate } from "@/i18n";
import type { SftpEntry } from "@/types";
import { formatBytes, formatTime } from "@/utils/format";
import { isRootPath, parentPath } from "@/utils/path";
import ContextMenu from "@/components/terminal/menu/ContextMenu";
import Tooltip from "@/components/terminal/menu/Tooltip";
import { FiCornerLeftUp, FiMoreVertical, FiRefreshCw } from "react-icons/fi";
import Button from "@/components/ui/button";
import "./SftpPanel.css";

type SftpPanelProps = {
  isRemote: boolean;
  isRemoteSession: boolean;
  currentPath: string;
  entries: SftpEntry[];
  onRefresh: (path?: string) => void;
  onOpen: (path: string) => void;
  onUpload: () => void;
  onDownload: (entry: SftpEntry) => void;
  onMkdir: () => void;
  onRename: (entry: SftpEntry) => void;
  onRemove: (entry: SftpEntry) => void;
  locale: Locale;
  t: Translate;
};

/** SFTP 文件管理面板。 */
export default function SftpPanel({
  isRemote,
  isRemoteSession,
  currentPath,
  entries,
  onRefresh,
  onOpen,
  onUpload,
  onDownload,
  onMkdir,
  onRename,
  onRemove,
  locale,
  t,
}: SftpPanelProps) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: SftpEntry;
  } | null>(null);
  const [actionsMenu, setActionsMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const showUnavailable = isRemoteSession && !isRemote;

  function openMenu(event: React.MouseEvent, entry: SftpEntry) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, entry });
  }

  function closeMenu() {
    setMenu(null);
  }

  function openActionsMenu(event: React.MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setActionsMenu({ x: rect.left, y: rect.bottom + 6 });
  }

  function closeActionsMenu() {
    setActionsMenu(null);
  }

  return (
    <div className="sftp-panel">
      <div className="sftp-toolbar">
        <div className="path">{showUnavailable ? "-" : currentPath}</div>
        {!showUnavailable && (
          <div className="sftp-actions">
            <Tooltip content={t("actions.refresh")}>
              <Button
                className="icon-button"
                variant="ghost"
                size="icon"
                onClick={() => onRefresh()}
                aria-label={t("actions.refresh")}
              >
                <FiRefreshCw />
              </Button>
            </Tooltip>
            <Tooltip content={t("sftp.back")}>
              <Button
                className="icon-button"
                variant="ghost"
                size="icon"
                onClick={() => onOpen(parentPath(currentPath))}
                aria-label={t("sftp.back")}
                disabled={isRootPath(currentPath)}
              >
                <FiCornerLeftUp />
              </Button>
            </Tooltip>
            <Tooltip content={t("actions.more")}>
              <Button
                className="icon-button"
                variant="ghost"
                size="icon"
                onClick={openActionsMenu}
                aria-label={t("actions.more")}
                disabled={!isRemote}
              >
                <FiMoreVertical />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
      <div className="sftp-list">
        {!showUnavailable && (
          <div className="sftp-table-row sftp-table-header">
            <span className="sftp-cell sftp-cell-name">
              {t("sftp.columns.name")}
            </span>
            <span className="sftp-cell">{t("sftp.columns.mtime")}</span>
            <span className="sftp-cell">{t("sftp.columns.type")}</span>
            <span className="sftp-cell">{t("sftp.columns.size")}</span>
            <span className="sftp-cell">{t("sftp.columns.perm")}</span>
            <span className="sftp-cell sftp-cell-owner">
              {t("sftp.columns.owner")}
            </span>
            <span className="sftp-cell sftp-cell-group">
              {t("sftp.columns.group")}
            </span>
          </div>
        )}
        <div className="sftp-list-body">
          {!showUnavailable &&
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`sftp-table-row sftp-table-item ${entry.kind}`}
                onClick={() => entry.kind === "dir" && onOpen(entry.path)}
                onContextMenu={(event) => openMenu(event, entry)}
              >
                <span className="sftp-cell sftp-cell-name">{entry.name}</span>
                <span className="sftp-cell">
                  {entry.mtime ? formatTime(entry.mtime, locale) : "-"}
                </span>
                <span className={`sftp-cell sftp-kind ${entry.kind}`}>
                  {entry.kind === "dir"
                    ? t("sftp.kind.dir")
                    : entry.kind === "link"
                      ? t("sftp.kind.link")
                      : t("sftp.kind.file")}
                </span>
                <span className="sftp-cell">
                  {entry.kind === "dir" ? "-" : formatBytes(entry.size ?? 0)}
                </span>
                <span className="sftp-cell">{entry.permissions ?? "-"}</span>
                <span className="sftp-cell sftp-cell-owner">
                  {entry.owner ?? "-"}
                </span>
                <span className="sftp-cell sftp-cell-group">
                  {entry.group ?? "-"}
                </span>
              </button>
            ))}
          {showUnavailable && (
            <div className="empty-hint">{t("sftp.emptyUnavailable")}</div>
          )}
          {!showUnavailable && !entries.length && (
            <div className="empty-hint">{t("sftp.empty")}</div>
          )}
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              label: t("actions.download"),
              disabled: !isRemote || menu.entry.kind === "dir",
              onClick: () => {
                if (!isRemote || menu.entry.kind === "dir") return;
                onDownload(menu.entry);
                closeMenu();
              },
            },
            {
              label: t("actions.rename"),
              disabled: !isRemote,
              onClick: () => {
                if (!isRemote) return;
                onRename(menu.entry);
                closeMenu();
              },
            },
            {
              label: t("actions.remove"),
              disabled: !isRemote,
              onClick: () => {
                if (!isRemote) return;
                onRemove(menu.entry);
                closeMenu();
              },
            },
          ]}
          onClose={closeMenu}
        />
      )}
      {actionsMenu && (
        <ContextMenu
          x={actionsMenu.x}
          y={actionsMenu.y}
          items={[
            {
              label: t("actions.new"),
              disabled: !isRemote,
              onClick: () => {
                if (!isRemote) return;
                onMkdir();
                closeActionsMenu();
              },
            },
            {
              label: t("actions.upload"),
              disabled: !isRemote,
              onClick: () => {
                if (!isRemote) return;
                onUpload();
                closeActionsMenu();
              },
            },
          ]}
          onClose={closeActionsMenu}
        />
      )}
    </div>
  );
}
