import { useMemo, useState } from "react";
import { FiFolder, FiServer, FiTerminal } from "react-icons/fi";
import type { HostProfile, LocalShellProfile } from "@/types";
import type { Translate } from "@/i18n";
import {
  LOCAL_SHELL_GROUP_VALUE,
  ROOT_PROFILE_GROUP_VALUE,
} from "@/constants/hostGroups";
import ContextMenu from "@/components/terminal/menu/ContextMenu";
import Modal from "@/components/terminal/modals/Modal";
import Button from "@/components/ui/button";
import InputDialog from "@/components/ui/InputDialog";
import PathViewDialog from "@/components/ui/PathViewDialog";
import Select from "@/components/ui/select";
import "@/components/terminal/profiles/HostPanel.css";

type HostPanelProps = {
  profiles: HostProfile[];
  sshGroups: string[];
  activeProfileId: string | null;
  onPick: (id: string) => void;
  onConnectProfile: (profile: HostProfile) => void;
  onOpenNewProfile: () => void;
  onOpenEditProfile: (profile: HostProfile) => void;
  onRemoveProfile: (profile: HostProfile) => void;
  onAddGroup: (groupName: string) => boolean;
  onRenameGroup: (from: string, to: string) => Promise<boolean>;
  onRemoveGroup: (groupName: string) => Promise<boolean>;
  onMoveProfileToGroup: (
    profileId: string,
    targetGroup: string | null,
  ) => Promise<boolean>;
  localShells: LocalShellProfile[];
  onConnectLocalShell: (shell: LocalShellProfile) => void;
  t: Translate;
};

/** 主机管理与分组列表。 */
export default function HostPanel({
  profiles,
  sshGroups,
  activeProfileId,
  onPick,
  onConnectProfile,
  onOpenNewProfile,
  onOpenEditProfile,
  onRemoveProfile,
  onAddGroup,
  onRenameGroup,
  onRemoveGroup,
  onMoveProfileToGroup,
  localShells,
  onConnectLocalShell,
  t,
}: HostPanelProps) {
  const localShellKey = LOCAL_SHELL_GROUP_VALUE;
  const localShellLabel = t("host.shellGroup");
  const customGroups = useMemo(() => {
    const map = new Map<string, { label: string; items: HostProfile[] }>();
    sshGroups.forEach((group) => {
      const label = group.trim();
      if (!label) return;
      map.set(label.toLowerCase(), { label, items: [] });
    });
    profiles.forEach((profile) => {
      const label = (profile.tags?.[0] ?? "").trim();
      if (!label) return;
      const key = label.toLowerCase();
      const group = map.get(key) ?? { label, items: [] };
      group.items.push(profile);
      map.set(key, group);
    });
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [profiles, sshGroups]);
  // 未设置分组的 SSH 会话直接挂在根级，不再包裹默认 SSH 分组。
  const rootProfiles = useMemo(
    () =>
      profiles.filter((profile) => {
        const tag = profile.tags?.[0]?.trim() ?? "";
        return !tag;
      }),
    [profiles],
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: Array<{
      label: string;
      disabled: boolean;
      onClick: () => void;
    }>;
  } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{
    mode: "add" | "rename";
    sourceGroup?: string;
    initialValue?: string;
  } | null>(null);
  const [pathDialog, setPathDialog] = useState<{
    title: string;
    path: string;
  } | null>(null);
  const [removeGroupDialog, setRemoveGroupDialog] = useState<{
    name: string;
    hostCount: number;
  } | null>(null);
  const [moveDialog, setMoveDialog] = useState<HostProfile | null>(null);
  const [moveGroupValue, setMoveGroupValue] = useState<string>(
    ROOT_PROFILE_GROUP_VALUE,
  );

  const normalizedQuery = query.trim().toLowerCase();
  const queryActive = normalizedQuery.length > 0;
  const matchesProfile = (profile: HostProfile) => {
    if (!queryActive) return true;
    const text =
      `${profile.name} ${profile.host} ${profile.username}`.toLowerCase();
    return text.includes(normalizedQuery);
  };
  const matchesGroup = (group: string) =>
    queryActive && group.toLowerCase().includes(normalizedQuery);
  const matchesShell = (shell: LocalShellProfile) => {
    if (!queryActive) return true;
    const text = `${shell.label} ${shell.path}`.toLowerCase();
    return text.includes(normalizedQuery);
  };

  const filteredLocalShells = useMemo(() => {
    if (!queryActive) return localShells;
    if (matchesGroup(localShellLabel)) return localShells;
    return localShells.filter(matchesShell);
  }, [localShells, queryActive, normalizedQuery, localShellLabel]);

  const filteredGroups = useMemo(() => {
    if (!queryActive) return customGroups;
    return customGroups
      .map((group) => {
        if (matchesGroup(group.label)) return group;
        const matched = group.items.filter(matchesProfile);
        return matched.length
          ? ({ label: group.label, items: matched } as {
              label: string;
              items: HostProfile[];
            })
          : null;
      })
      .filter(
        (
          item,
        ): item is {
          label: string;
          items: HostProfile[];
        } => item !== null,
      );
  }, [customGroups, queryActive, normalizedQuery]);

  const showLocalShellGroup =
    !queryActive ||
    matchesGroup(localShellLabel) ||
    filteredLocalShells.length > 0;
  const filteredRootProfiles = useMemo(() => {
    if (!queryActive) return rootProfiles;
    return rootProfiles.filter(matchesProfile);
  }, [rootProfiles, queryActive, normalizedQuery]);

  const moveGroupOptions = useMemo(
    () => [
      { value: ROOT_PROFILE_GROUP_VALUE, label: t("host.ungrouped") },
      ...customGroups.map((group) => ({
        value: group.label,
        label: group.label,
      })),
    ],
    [customGroups, t],
  );

  const currentMoveGroupValue = useMemo(() => {
    if (!moveDialog) return ROOT_PROFILE_GROUP_VALUE;
    return moveDialog.tags?.[0]?.trim() || ROOT_PROFILE_GROUP_VALUE;
  }, [moveDialog]);

  const getGroupHostCount = (groupName: string) =>
    profiles.filter(
      (profile) =>
        (profile.tags?.[0]?.trim().toLowerCase() ?? "") ===
        groupName.trim().toLowerCase(),
    ).length;

  function openMenu(
    event: {
      preventDefault: () => void;
      stopPropagation: () => void;
      clientX: number;
      clientY: number;
    },
    items: Array<{
      label: string;
      disabled: boolean;
      onClick: () => void;
    }>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  function toggleGroup(group: string, expandable: boolean) {
    if (!expandable) return;
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  function openAddGroupDialog() {
    setMenu(null);
    setGroupDialog({ mode: "add", initialValue: "" });
  }

  return (
    <div className="host-panel">
      <div className="host-list">
        <div className="host-list-header">
          <input
            className="host-search"
            placeholder={t("host.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div
          className="host-list-body"
          onContextMenu={(event) => {
            openMenu(event, [
              {
                label: t("host.addGroup"),
                disabled: false,
                onClick: openAddGroupDialog,
              },
              {
                label: t("profile.menu.new"),
                disabled: false,
                onClick: () => {
                  setMenu(null);
                  onOpenNewProfile();
                },
              },
            ]);
          }}
        >
          {showLocalShellGroup && (
            <div key={localShellKey} className="host-group">
              <Button
                className={`host-group-title ${
                  filteredLocalShells.length > 0 &&
                  expandedGroups.has(localShellKey)
                    ? "expanded"
                    : ""
                }`}
                variant="ghost"
                size="sm"
                onContextMenu={(event) =>
                  openMenu(event, [
                    {
                      label: t("profile.menu.new"),
                      disabled: false,
                      onClick: () => {
                        setMenu(null);
                        onOpenNewProfile();
                      },
                    },
                    {
                      label: t("host.addGroup"),
                      disabled: false,
                      onClick: openAddGroupDialog,
                    },
                    {
                      label: t("host.menu.renameGroup"),
                      disabled: true,
                      onClick: () => {},
                    },
                  ])
                }
                onClick={() =>
                  toggleGroup(localShellKey, filteredLocalShells.length > 0)
                }
              >
                <span className="host-row-label">
                  <FiFolder className="host-row-icon" />
                  <span>{localShellLabel}</span>
                </span>
                <em>{filteredLocalShells.length}</em>
              </Button>
              {(queryActive || expandedGroups.has(localShellKey)) && (
                <div className="host-group-list host-group-list--nested">
                  {filteredLocalShells.map((shell) => (
                    <Button
                      key={shell.id}
                      variant="ghost"
                      size="sm"
                      onContextMenu={(event) =>
                        openMenu(event, [
                          {
                            label: t("host.addGroup"),
                            disabled: false,
                            onClick: openAddGroupDialog,
                          },
                          {
                            label: t("host.menu.viewShellPath"),
                            disabled: false,
                            onClick: () => {
                              setMenu(null);
                              setPathDialog({
                                title: t("host.pathDialogTitle", {
                                  name: shell.label,
                                }),
                                path: shell.path,
                              });
                            },
                          },
                        ])
                      }
                      onDoubleClick={() => onConnectLocalShell(shell)}
                    >
                      <span className="host-row-label">
                        <FiTerminal className="host-row-icon" />
                        <span>{shell.label}</span>
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {filteredRootProfiles.map((profile) => (
            <Button
              key={profile.id}
              className={profile.id === activeProfileId ? "active" : ""}
              variant="ghost"
              size="sm"
              onContextMenu={(event) =>
                openMenu(event, [
                  {
                    label: t("host.addGroup"),
                    disabled: false,
                    onClick: openAddGroupDialog,
                  },
                  {
                    label: t("profile.menu.edit"),
                    disabled: false,
                    onClick: () => {
                      setMenu(null);
                      onOpenEditProfile(profile);
                    },
                  },
                  {
                    label: t("host.menu.moveTo"),
                    disabled: false,
                    onClick: () => {
                      setMenu(null);
                      setMoveDialog(profile);
                      setMoveGroupValue(
                        profile.tags?.[0]?.trim() || ROOT_PROFILE_GROUP_VALUE,
                      );
                    },
                  },
                  {
                    label: t("profile.menu.delete"),
                    disabled: false,
                    onClick: () => {
                      setMenu(null);
                      onRemoveProfile(profile);
                    },
                  },
                ])
              }
              onClick={() => onPick(profile.id)}
              onDoubleClick={() => onConnectProfile(profile)}
            >
              {/* 分组与会话用不同图标区分，保持树结构语义一眼可辨。 */}
              <span className="host-row-label">
                <FiServer className="host-row-icon" />
                <span>{profile.name || profile.host}</span>
              </span>
            </Button>
          ))}
          {filteredGroups.map((group) => (
            <div key={group.label} className="host-group">
              <Button
                className={`host-group-title ${
                  group.items.length > 0 && expandedGroups.has(group.label)
                    ? "expanded"
                    : ""
                }`}
                variant="ghost"
                size="sm"
                onContextMenu={(event) =>
                  openMenu(event, [
                    {
                      label: t("profile.menu.new"),
                      disabled: false,
                      onClick: () => {
                        setMenu(null);
                        onOpenNewProfile();
                      },
                    },
                    {
                      label: t("host.addGroup"),
                      disabled: false,
                      onClick: openAddGroupDialog,
                    },
                    {
                      label: t("host.menu.renameGroup"),
                      disabled: false,
                      onClick: () => {
                        setMenu(null);
                        setGroupDialog({
                          mode: "rename",
                          sourceGroup: group.label,
                          initialValue: group.label,
                        });
                      },
                    },
                    {
                      label: t("host.menu.deleteGroup"),
                      disabled: false,
                      onClick: () => {
                        setMenu(null);
                        const hostCount = getGroupHostCount(group.label);
                        if (hostCount === 0) {
                          onRemoveGroup(group.label).catch(() => {});
                          return;
                        }
                        setRemoveGroupDialog({ name: group.label, hostCount });
                      },
                    },
                  ])
                }
                onClick={() => toggleGroup(group.label, group.items.length > 0)}
              >
                <span className="host-row-label">
                  <FiFolder className="host-row-icon" />
                  <span>{group.label}</span>
                </span>
                <em>{group.items.length}</em>
              </Button>
              {(queryActive || expandedGroups.has(group.label)) && (
                <div className="host-group-list host-group-list--nested">
                  {group.items.map((profile) => (
                    <Button
                      key={profile.id}
                      className={profile.id === activeProfileId ? "active" : ""}
                      variant="ghost"
                      size="sm"
                      onContextMenu={(event) =>
                        openMenu(event, [
                          {
                            label: t("host.addGroup"),
                            disabled: false,
                            onClick: openAddGroupDialog,
                          },
                          {
                            label: t("profile.menu.edit"),
                            disabled: false,
                            onClick: () => {
                              setMenu(null);
                              onOpenEditProfile(profile);
                            },
                          },
                          {
                            label: t("host.menu.moveTo"),
                            disabled: false,
                            onClick: () => {
                              setMenu(null);
                              setMoveDialog(profile);
                              setMoveGroupValue(
                                profile.tags?.[0]?.trim() ||
                                  ROOT_PROFILE_GROUP_VALUE,
                              );
                            },
                          },
                          {
                            label: t("profile.menu.delete"),
                            disabled: false,
                            onClick: () => {
                              setMenu(null);
                              onRemoveProfile(profile);
                            },
                          },
                        ])
                      }
                      onClick={() => onPick(profile.id)}
                      onDoubleClick={() => onConnectProfile(profile)}
                    >
                      <span className="host-row-label">
                        <FiServer className="host-row-icon" />
                        <span>{profile.name || profile.host}</span>
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!profiles.length && localShells.length === 0 && (
            <div className="empty-hint">{t("host.empty")}</div>
          )}
          {(profiles.length > 0 ||
            localShells.length > 0 ||
            customGroups.length > 0) &&
            !filteredRootProfiles.length &&
            !filteredGroups.length &&
            !filteredLocalShells.length && (
              <div className="empty-hint">{t("host.noMatch")}</div>
            )}
        </div>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={() => setMenu(null)}
          />
        )}
        {groupDialog && (
          <InputDialog
            open
            title={
              groupDialog.mode === "add"
                ? t("host.addGroup")
                : t("host.menu.renameGroup")
            }
            label={t("profile.form.group")}
            placeholder={t("profile.placeholder.group")}
            initialValue={groupDialog.initialValue ?? ""}
            confirmText={t("actions.save")}
            cancelText={t("actions.cancel")}
            closeText={t("actions.close")}
            onClose={() => setGroupDialog(null)}
            onConfirm={(value) => {
              if (!value) return;
              if (groupDialog.mode === "add") {
                onAddGroup(value);
                setGroupDialog(null);
                return;
              }
              if (
                !groupDialog.sourceGroup ||
                value === groupDialog.sourceGroup
              ) {
                setGroupDialog(null);
                return;
              }
              onRenameGroup(groupDialog.sourceGroup, value)
                .then(() => setGroupDialog(null))
                .catch(() => {});
            }}
          />
        )}
        {pathDialog && (
          <PathViewDialog
            open
            title={pathDialog.title}
            path={pathDialog.path}
            copyText={t("actions.copy")}
            copiedText={t("actions.copied")}
            closeText={t("actions.close")}
            onClose={() => setPathDialog(null)}
          />
        )}
        {moveDialog && (
          <Modal
            open
            title={t("host.moveDialogTitle")}
            closeLabel={t("actions.close")}
            bodyClassName="host-move-modal-body"
            onClose={() => setMoveDialog(null)}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMoveDialog(null)}
                >
                  {t("actions.cancel")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onMoveProfileToGroup(
                      moveDialog.id,
                      moveGroupValue === ROOT_PROFILE_GROUP_VALUE
                        ? null
                        : moveGroupValue,
                    )
                      .then(() => setMoveDialog(null))
                      .catch(() => {});
                  }}
                >
                  {t("actions.save")}
                </Button>
              </>
            }
          >
            <div className="host-move-dialog">
              <label>{t("host.moveTargetLabel")}</label>
              <Select
                value={moveGroupValue}
                options={moveGroupOptions.map((item) => ({
                  ...item,
                  disabled: item.value === currentMoveGroupValue,
                }))}
                onChange={(value) => setMoveGroupValue(value)}
                aria-label={t("host.moveTargetLabel")}
              />
            </div>
          </Modal>
        )}
        {removeGroupDialog && (
          <Modal
            open
            title={t("host.deleteGroupTitle")}
            closeLabel={t("actions.close")}
            bodyClassName="host-remove-group-modal-body"
            onClose={() => setRemoveGroupDialog(null)}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoveGroupDialog(null)}
                >
                  {t("actions.cancel")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onRemoveGroup(removeGroupDialog.name)
                      .then(() => setRemoveGroupDialog(null))
                      .catch(() => {});
                  }}
                >
                  {t("actions.remove")}
                </Button>
              </>
            }
          >
            <div className="host-remove-group-dialog">
              <p>
                {t("host.deleteGroupConfirm", {
                  name: removeGroupDialog.name,
                })}
              </p>
              <p>
                {t("host.deleteGroupHint", {
                  target: t("host.ungrouped"),
                  count: removeGroupDialog.hostCount,
                })}
              </p>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
