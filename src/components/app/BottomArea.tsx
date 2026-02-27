import { useEffect, useMemo, useRef, useState } from "react";
import { FiSettings } from "react-icons/fi";
import type { Translate } from "@/i18n";
import type { QuickCommandGroup, QuickCommandItem } from "@/types";
import Modal from "@/components/terminal/modals/Modal";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import InputDialog from "@/components/ui/InputDialog";
import ContextMenu from "@/components/terminal/menu/ContextMenu";
import { DEFAULT_QUICKBAR_GROUP_ID } from "@/constants/quickbar";
import "@/components/app/BottomArea.css";

type FooterVisibility = {
  quickbar: boolean;
  statusbar: boolean;
};

type TerminalStats = {
  windowRows: number;
  windowCols: number;
  logicalLineCount: number;
  currentLogicalLineCharCount: number;
};

type BottomAreaProps = {
  visibility: FooterVisibility;
  managerOpen: boolean;
  onOpenManager: () => void;
  showGroupTitle: boolean;
  groups: QuickCommandGroup[];
  commands: QuickCommandItem[];
  onCloseManager: () => void;
  onAddGroup: (name: string) => string | null;
  onRenameGroup: (groupId: string, name: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onToggleGroupVisible: (groupId: string) => void;
  onAddCommand: (payload: {
    label: string;
    command: string;
    groupId?: string | null;
  }) => void;
  onUpdateCommand: (
    commandId: string,
    payload: Partial<QuickCommandItem>,
  ) => void;
  onRemoveCommand: (commandId: string) => void;
  onShowGroupTitleChange: React.Dispatch<React.SetStateAction<boolean>>;
  onRunCommand: (command: string) => void;
  getActiveTerminalStats: () => TerminalStats;
  t: Translate;
};

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function formatDateTime(value: Date) {
  return `${value.getFullYear()}/${value.getMonth() + 1}/${value.getDate()} ${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const current = new Date();
    const msUntilNextMinute =
      (60 - current.getSeconds()) * 1000 - current.getMilliseconds();
    let interval: number | null = null;
    const firstTimer = window.setTimeout(
      () => {
        setNow(new Date());
        interval = window.setInterval(() => {
          setNow(new Date());
        }, 60_000);
      },
      Math.max(msUntilNextMinute, 0),
    );
    return () => {
      window.clearTimeout(firstTimer);
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, []);
  return now;
}

/** 快捷栏与状态栏底部区域。 */
export default function BottomArea({
  visibility,
  managerOpen,
  onOpenManager,
  showGroupTitle,
  groups,
  commands,
  onCloseManager,
  onAddGroup,
  onRenameGroup,
  onRemoveGroup,
  onToggleGroupVisible,
  onAddCommand,
  onUpdateCommand,
  onRemoveCommand,
  onShowGroupTitleChange,
  onRunCommand,
  getActiveTerminalStats,
  t,
}: BottomAreaProps) {
  const [stats, setStats] = useState<TerminalStats>(() =>
    getActiveTerminalStats(),
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commandId: string;
  } | null>(null);
  const [groupDialogMode, setGroupDialogMode] = useState<
    "add" | "rename" | null
  >(null);
  const [deleteGroupPendingId, setDeleteGroupPendingId] = useState<
    string | null
  >(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(
    null,
  );
  const [pendingFocusCommandId, setPendingFocusCommandId] = useState<
    string | null
  >(null);
  const now = useMinuteClock();
  const quickbarMenuRef = useRef<HTMLDivElement | null>(null);
  const [quickbarMenuOpen, setQuickbarMenuOpen] = useState(false);

  useEffect(() => {
    setStats(getActiveTerminalStats());
    const timer = window.setInterval(() => {
      setStats(getActiveTerminalStats());
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [getActiveTerminalStats]);

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.order - b.order),
    [groups],
  );

  const visibleGroupIds = useMemo(
    () =>
      new Set(
        sortedGroups.filter((group) => group.visible).map((group) => group.id),
      ),
    [sortedGroups],
  );

  const commandsByGroup = useMemo(() => {
    const map = new Map<string, QuickCommandItem[]>();
    commands.forEach((item) => {
      if (!visibleGroupIds.has(item.groupId)) return;
      if (!map.has(item.groupId)) {
        map.set(item.groupId, []);
      }
      map.get(item.groupId)?.push(item);
    });
    return map;
  }, [commands, visibleGroupIds]);

  const hasVisibleCommands = Array.from(commandsByGroup.values()).some(
    (items) => items.length > 0,
  );

  function resolveCommandLabel(item: QuickCommandItem) {
    const value = item.label.trim();
    return value || t("quickbar.manager.newLabel");
  }

  const commandCountByGroup = useMemo(() => {
    const map = new Map<string, number>();
    commands.forEach((item) => {
      map.set(item.groupId, (map.get(item.groupId) ?? 0) + 1);
    });
    return map;
  }, [commands]);

  const managerGroupOptions = useMemo(
    () =>
      sortedGroups.map((group) => ({
        value: group.id,
        label: `${group.name} (${commandCountByGroup.get(group.id) ?? 0})`,
      })),
    [sortedGroups, commandCountByGroup],
  );

  const selectedGroup = useMemo(
    () => sortedGroups.find((group) => group.id === selectedGroupId) ?? null,
    [sortedGroups, selectedGroupId],
  );
  const deleteGroupPending = useMemo(
    () =>
      sortedGroups.find((group) => group.id === deleteGroupPendingId) ?? null,
    [sortedGroups, deleteGroupPendingId],
  );

  const groupCommands = useMemo(
    () => commands.filter((item) => item.groupId === selectedGroupId),
    [commands, selectedGroupId],
  );

  const selectedCommand = useMemo(
    () => groupCommands.find((item) => item.id === selectedCommandId) ?? null,
    [groupCommands, selectedCommandId],
  );

  useEffect(() => {
    if (!quickbarMenuOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!quickbarMenuRef.current) return;
      if (!quickbarMenuRef.current.contains(event.target as Node)) {
        setQuickbarMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
    };
  }, [quickbarMenuOpen]);

  useEffect(() => {
    if (!managerOpen) return;
    if (!sortedGroups.length) {
      setSelectedGroupId(null);
      setSelectedCommandId(null);
      return;
    }
    const focusCommand = pendingFocusCommandId
      ? (commands.find((item) => item.id === pendingFocusCommandId) ?? null)
      : null;
    if (focusCommand) {
      setSelectedGroupId(focusCommand.groupId);
      setSelectedCommandId(focusCommand.id);
      setPendingFocusCommandId(null);
      return;
    }
    const nextGroupId =
      selectedGroupId && sortedGroups.some((g) => g.id === selectedGroupId)
        ? selectedGroupId
        : sortedGroups[0].id;
    setSelectedGroupId(nextGroupId);
    const nextCommands = commands.filter(
      (item) => item.groupId === nextGroupId,
    );
    setSelectedCommandId((prev) => {
      if (prev && nextCommands.some((item) => item.id === prev)) return prev;
      return nextCommands[0]?.id ?? null;
    });
  }, [
    managerOpen,
    sortedGroups,
    commands,
    pendingFocusCommandId,
    selectedGroupId,
  ]);

  useEffect(() => {
    if (!selectedGroupId) return;
    if (groupCommands.some((item) => item.id === selectedCommandId)) return;
    setSelectedCommandId(groupCommands[0]?.id ?? null);
  }, [selectedGroupId, groupCommands, selectedCommandId]);

  function handleAddGroup() {
    setGroupDialogMode("add");
  }

  function handleRenameGroup() {
    if (!selectedGroup || selectedGroup.id === DEFAULT_QUICKBAR_GROUP_ID)
      return;
    setGroupDialogMode("rename");
  }

  function handleDeleteGroup() {
    if (!selectedGroup || selectedGroup.id === DEFAULT_QUICKBAR_GROUP_ID)
      return;
    setDeleteGroupPendingId(selectedGroup.id);
  }

  function handleAddCommand() {
    if (!selectedGroupId) return;
    onAddCommand({
      label: t("quickbar.manager.newLabel"),
      command: "",
      groupId: selectedGroupId,
    });
  }

  function handleDeleteCommand() {
    if (!selectedCommandId) return;
    onRemoveCommand(selectedCommandId);
  }

  function handleCopyCommand() {
    if (!selectedCommand) return;
    onAddCommand({
      label: `${selectedCommand.label} ${t("quickbar.manager.copySuffix")}`,
      command: selectedCommand.command,
      groupId: selectedCommand.groupId,
    });
  }

  if (!visibility.quickbar && !visibility.statusbar) {
    return null;
  }

  return (
    <>
      <footer className="bottom-area">
        {visibility.quickbar && (
          <div className="quickbar-row">
            <div className="quickbar" title={t("layout.footer.quickbar")}>
              <Button
                variant="ghost"
                size="icon"
                className="quickbar-manage-button"
                aria-label={t("quickbar.manager.open")}
                onClick={() => setQuickbarMenuOpen((prev) => !prev)}
              >
                <FiSettings />
              </Button>
              {quickbarMenuOpen && (
                <div className="quickbar-menu" ref={quickbarMenuRef}>
                  <div className="quickbar-menu-section-title">
                    {t("quickbar.menu.config")}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="quickbar-menu-item"
                    onClick={() => {
                      setQuickbarMenuOpen(false);
                      onOpenManager();
                    }}
                  >
                    {t("quickbar.manager.title")}
                  </Button>
                  <div className="quickbar-menu-divider" />
                  <div className="quickbar-menu-section-title">
                    {t("quickbar.menu.groups")}
                  </div>
                  <div className="quickbar-menu-group-list">
                    {sortedGroups.map((group) => (
                      <label
                        key={group.id}
                        className="quickbar-menu-group-item"
                      >
                        <input
                          type="checkbox"
                          checked={group.visible}
                          onChange={() => onToggleGroupVisible(group.id)}
                        />
                        <span>{group.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="quickbar-scroll">
                {hasVisibleCommands ? (
                  sortedGroups
                    .filter((group) => visibleGroupIds.has(group.id))
                    .map((group) => {
                      const groupCommandsForBar =
                        commandsByGroup.get(group.id) ?? [];
                      if (!groupCommandsForBar.length) return null;
                      return (
                        <div className="quickbar-group" key={group.id}>
                          {showGroupTitle && (
                            <span className="quickbar-group-name">
                              {group.name}
                            </span>
                          )}
                          <div className="quickbar-command-list">
                            {groupCommandsForBar.map((item) => (
                              <Button
                                key={item.id}
                                variant="ghost"
                                size="sm"
                                className="quickbar-command"
                                title={item.command}
                                onClick={() => onRunCommand(item.command)}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  setContextMenu({
                                    x: event.clientX,
                                    y: event.clientY,
                                    commandId: item.id,
                                  });
                                }}
                              >
                                {resolveCommandLabel(item)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      );
                    })
                ) : (
                  <span className="quickbar-empty">{t("quickbar.empty")}</span>
                )}
              </div>
            </div>
          </div>
        )}
        {visibility.statusbar && (
          <div
            className={`statusbar-row ${visibility.quickbar ? "with-separator" : ""}`.trim()}
          >
            <div className="statusbar" title={t("layout.footer.statusbar")}>
              <span>
                [ {t("status.window")} {stats.windowRows}x{stats.windowCols} ]
              </span>
              <span>
                [ {t("status.line")} {stats.logicalLineCount} {t("status.char")}{" "}
                {stats.currentLogicalLineCharCount} ]
              </span>
              <span>[ {formatDateTime(now)} ]</span>
            </div>
          </div>
        )}
      </footer>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: t("quickbar.command.edit"),
              disabled: false,
              onClick: () => {
                setPendingFocusCommandId(contextMenu.commandId);
                onOpenManager();
                setContextMenu(null);
              },
            },
            {
              label: t("quickbar.command.delete"),
              disabled: false,
              onClick: () => {
                onRemoveCommand(contextMenu.commandId);
                setContextMenu(null);
              },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      <Modal
        open={managerOpen}
        title={t("quickbar.manager.title")}
        closeLabel={t("actions.close")}
        onClose={onCloseManager}
      >
        <div className="quickbar-manager-v2">
          <section className="qm-top">
            <Select
              value={selectedGroupId}
              options={managerGroupOptions}
              placeholder={t("quickbar.manager.selectGroup")}
              onChange={(value) => setSelectedGroupId(value || null)}
              aria-label={t("quickbar.manager.group")}
            />
            <Button variant="ghost" size="sm" onClick={handleAddGroup}>
              {t("quickbar.manager.addGroup")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                !selectedGroup || selectedGroup.id === DEFAULT_QUICKBAR_GROUP_ID
              }
              onClick={handleDeleteGroup}
            >
              {t("quickbar.manager.deleteGroup")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                !selectedGroup || selectedGroup.id === DEFAULT_QUICKBAR_GROUP_ID
              }
              onClick={handleRenameGroup}
            >
              {t("quickbar.manager.renameGroup")}
            </Button>
          </section>

          <section className="qm-left">
            <div className="qm-title">{t("quickbar.manager.commandList")}</div>
            <div className="qm-command-list">
              {groupCommands.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`qm-command-item ${selectedCommandId === item.id ? "active" : ""}`.trim()}
                  onClick={() => setSelectedCommandId(item.id)}
                >
                  {resolveCommandLabel(item)}
                </button>
              ))}
              {!groupCommands.length && (
                <div className="qm-empty">
                  {t("quickbar.manager.emptyGroup")}
                </div>
              )}
            </div>
            <div className="qm-left-actions">
              <Button
                variant="ghost"
                size="sm"
                disabled={!selectedGroupId}
                onClick={handleAddCommand}
              >
                {t("quickbar.manager.addCommand")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!selectedCommandId}
                onClick={handleDeleteCommand}
              >
                {t("quickbar.manager.deleteCommand")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!selectedCommandId}
                onClick={handleCopyCommand}
              >
                {t("quickbar.manager.copyCommand")}
              </Button>
            </div>
          </section>

          <section className="qm-right">
            <div className="qm-title">{t("quickbar.manager.detail")}</div>
            {selectedCommand ? (
              <div className="qm-detail-form">
                <label>
                  <span>{t("quickbar.manager.commandLabel")}</span>
                  <input
                    value={selectedCommand.label}
                    onChange={(event) =>
                      onUpdateCommand(selectedCommand.id, {
                        label: event.target.value,
                      })
                    }
                    onBlur={(event) => {
                      if (event.target.value.trim()) return;
                      onUpdateCommand(selectedCommand.id, {
                        label: t("quickbar.manager.newLabel"),
                      });
                    }}
                  />
                </label>
                <label>
                  <span>{t("quickbar.manager.commandType")}</span>
                  <Select
                    value="sendText"
                    options={[
                      {
                        value: "sendText",
                        label: t("quickbar.manager.sendText"),
                      },
                    ]}
                    disabled
                    onChange={() => {}}
                    aria-label={t("quickbar.manager.commandType")}
                  />
                </label>
                <label>
                  <span>{t("quickbar.manager.commandText")}</span>
                  <textarea
                    value={selectedCommand.command}
                    onChange={(event) =>
                      onUpdateCommand(selectedCommand.id, {
                        command: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
            ) : (
              <div className="qm-empty">
                {t("quickbar.manager.noCommandSelected")}
              </div>
            )}
          </section>

          <section className="qm-bottom">
            <label className="qm-option">
              <input
                type="checkbox"
                checked={showGroupTitle}
                onChange={(event) =>
                  onShowGroupTitleChange(event.target.checked)
                }
              />
              <span>{t("quickbar.manager.showGroupTitle")}</span>
            </label>
          </section>
        </div>
      </Modal>

      <InputDialog
        open={groupDialogMode !== null}
        title={
          groupDialogMode === "add"
            ? t("quickbar.manager.addGroup")
            : t("quickbar.manager.renameGroup")
        }
        label={t("quickbar.manager.group")}
        placeholder={t("quickbar.manager.groupPlaceholder")}
        initialValue={
          groupDialogMode === "rename" ? (selectedGroup?.name ?? "") : ""
        }
        confirmText={t("actions.save")}
        cancelText={t("actions.cancel")}
        closeText={t("actions.close")}
        onClose={() => setGroupDialogMode(null)}
        onConfirm={(value) => {
          const name = value.trim();
          if (!name) return;
          if (groupDialogMode === "add") {
            const id = onAddGroup(name);
            if (id) {
              setSelectedGroupId(id);
              setSelectedCommandId(null);
            }
          } else if (groupDialogMode === "rename" && selectedGroup) {
            onRenameGroup(selectedGroup.id, name);
          }
          setGroupDialogMode(null);
        }}
      />

      <Modal
        open={!!deleteGroupPending}
        title={t("quickbar.manager.deleteGroup")}
        closeLabel={t("actions.close")}
        onClose={() => setDeleteGroupPendingId(null)}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteGroupPendingId(null)}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!deleteGroupPending) return;
                onRemoveGroup(deleteGroupPending.id);
                setDeleteGroupPendingId(null);
              }}
            >
              {t("actions.remove")}
            </Button>
          </>
        }
      >
        <p className="qm-delete-confirm">
          {deleteGroupPending
            ? t("quickbar.manager.deleteGroupConfirm", {
                name: deleteGroupPending.name,
              })
            : ""}
        </p>
      </Modal>
    </>
  );
}
