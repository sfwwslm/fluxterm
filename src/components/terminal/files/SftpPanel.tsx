import { useState } from "react";
import type { IconType } from "react-icons";
import type { Locale, Translate } from "@/i18n";
import type { SftpAvailability, SftpEntry } from "@/types";
import { formatBytes, formatTime } from "@/utils/format";
import { isRootPath, parentPath } from "@/utils/path";
import { useNotices } from "@/hooks/useNotices";
import ContextMenu from "@/components/terminal/menu/ContextMenu";
import Tooltip from "@/components/terminal/menu/Tooltip";
import {
  FiCode,
  FiRefreshCw,
  FiClock,
  FiCornerLeftUp,
  FiDatabase,
  FiFile,
  FiFileText,
  FiFolder,
  FiInfo,
  FiImage,
  FiLink2,
  FiLock,
  FiLink,
  FiSlash,
  FiMoreVertical,
  FiPackage,
  FiSettings,
  FiTerminal,
  FiVideo,
} from "react-icons/fi";
import Button from "@/components/ui/button";
import "./SftpPanel.css";

type SftpPanelProps = {
  isRemote: boolean;
  isRemoteSession: boolean;
  currentPath: string;
  sftpAvailability?: SftpAvailability;
  terminalPathSyncStatus?:
    | "active"
    | "paused"
    | "checking"
    | "unsupported"
    | "disabled";
  entries: SftpEntry[];
  onRefresh: (path?: string) => void;
  onOpen: (path: string) => void;
  onUpload: () => void;
  onDownload: (entry: SftpEntry) => void;
  onMkdir: (name: string) => void;
  onRename: (entry: SftpEntry, name: string) => void;
  onRemove: (entry: SftpEntry) => void;
  locale: Locale;
  t: Translate;
};

type FileIconMeta = {
  Icon: IconType;
  tone: string;
};

const CODE_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "lua",
  "md",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
const VIDEO_EXTENSIONS = new Set([
  "avi",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "webm",
]);
const ARCHIVE_EXTENSIONS = new Set([
  "7z",
  "bz2",
  "gz",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
]);
const CONFIG_EXTENSIONS = new Set([
  "conf",
  "cfg",
  "config",
  "env",
  "ini",
  "properties",
]);

/** 图标判定优先走文件实体 kind，其次才按扩展名粗分普通文件类型。 */
function getEntryIconMeta(entry: SftpEntry): FileIconMeta {
  if (entry.kind === "dir") {
    return { Icon: FiFolder, tone: "folder" };
  }
  if (entry.kind === "link") {
    return { Icon: FiLink2, tone: "link" };
  }

  const parts = entry.name.split(".");
  const extension =
    parts.length > 1 ? (parts[parts.length - 1]?.toLowerCase() ?? "") : "";

  if (CODE_EXTENSIONS.has(extension)) {
    if (extension === "sh" || extension === "bash" || extension === "zsh") {
      return { Icon: FiTerminal, tone: "script" };
    }
    if (extension === "sql") {
      return { Icon: FiDatabase, tone: "database" };
    }
    return { Icon: FiCode, tone: "code" };
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return { Icon: FiImage, tone: "image" };
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return { Icon: FiVideo, tone: "media" };
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return { Icon: FiPackage, tone: "archive" };
  }
  if (CONFIG_EXTENSIONS.has(extension)) {
    return { Icon: FiSettings, tone: "config" };
  }
  if (
    extension === "log" ||
    extension === "txt" ||
    extension === "csv" ||
    extension === "pdf"
  ) {
    return { Icon: FiFileText, tone: "text" };
  }
  if (extension === "key" || extension === "pem" || extension === "crt") {
    return { Icon: FiLock, tone: "secure" };
  }
  return { Icon: FiFile, tone: "file" };
}

/** SFTP 文件管理面板。 */
export default function SftpPanel({
  isRemote,
  isRemoteSession,
  currentPath,
  sftpAvailability = "ready",
  terminalPathSyncStatus = "checking",
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
  const { openDialog } = useNotices();
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
  const showSftpDisabled = isRemoteSession && sftpAvailability === "disabled";
  const showSftpUnsupported =
    isRemoteSession && sftpAvailability === "unsupported";
  const interactionsDisabled =
    showUnavailable || showSftpDisabled || showSftpUnsupported;

  const pathSyncMeta =
    terminalPathSyncStatus === "active"
      ? {
          Icon: FiLink,
          tone: "active",
          label: t("sftp.pathSync.active"),
        }
      : terminalPathSyncStatus === "checking"
        ? {
            Icon: FiRefreshCw,
            tone: "checking",
            label: t("sftp.pathSync.checking"),
          }
        : terminalPathSyncStatus === "paused"
          ? {
              Icon: FiClock,
              tone: "paused",
              label: t("sftp.pathSync.paused"),
            }
          : terminalPathSyncStatus === "unsupported"
            ? {
                Icon: FiInfo,
                tone: "unsupported",
                label: t("sftp.pathSync.unsupported"),
              }
            : {
                Icon: FiSlash,
                tone: "disabled",
                label: t("sftp.pathSync.disabled"),
              };

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
        <div className="path-with-sync">
          <Tooltip content={pathSyncMeta.label}>
            <span
              className={`path-sync-indicator ${pathSyncMeta.tone}`}
              aria-label={pathSyncMeta.label}
            >
              <pathSyncMeta.Icon />
            </span>
          </Tooltip>
          <div
            className="path"
            title={interactionsDisabled ? "-" : currentPath}
          >
            {interactionsDisabled ? "-" : currentPath}
          </div>
        </div>
        {!interactionsDisabled && (
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
        {!interactionsDisabled && (
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
          {!interactionsDisabled &&
            entries.map((entry) => {
              const iconMeta = getEntryIconMeta(entry);
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={`sftp-table-row sftp-table-item ${entry.kind}`}
                  onClick={() =>
                    (entry.kind === "dir" || entry.kind === "link") &&
                    onOpen(entry.path)
                  }
                  onContextMenu={(event) => openMenu(event, entry)}
                >
                  <span className="sftp-cell sftp-cell-name">
                    <span
                      className={`sftp-entry-icon ${iconMeta.tone}`}
                      aria-hidden="true"
                    >
                      <iconMeta.Icon />
                    </span>
                    <span className="sftp-entry-name-text">{entry.name}</span>
                  </span>
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
              );
            })}
          {showUnavailable && (
            <div className="empty-hint">{t("sftp.emptyUnavailable")}</div>
          )}
          {showSftpDisabled && (
            <div className="empty-hint">{t("sftp.disabled")}</div>
          )}
          {isRemoteSession && sftpAvailability === "checking" && (
            <div className="empty-hint">{t("sftp.checking")}</div>
          )}
          {showSftpUnsupported && (
            <div className="empty-hint">{t("sftp.unsupported")}</div>
          )}
          {!interactionsDisabled && !entries.length && (
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
                const name = window.prompt(
                  t("prompts.rename"),
                  menu.entry.name,
                );
                if (!name || name === menu.entry.name) return;
                onRename(menu.entry, name);
                closeMenu();
              },
            },
            {
              label: t("actions.remove"),
              disabled: !isRemote,
              onClick: () => {
                if (!isRemote) return;
                closeMenu();
                openDialog({
                  title: t("actions.remove"),
                  message: t("prompts.confirmDelete", {
                    name: menu.entry.name,
                  }),
                  confirmLabel: t("actions.remove"),
                  cancelLabel: t("actions.cancel"),
                  onConfirm: () => onRemove(menu.entry),
                });
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
                const name = window.prompt(t("prompts.newFolder"));
                if (!name) return;
                onMkdir(name);
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
