/**
 * RDP 管理组件。
 * 职责：按连接配置管理面板的交互方式展示 RDP Profile 与分组。
 */
import { useCallback, useMemo, useState } from "react";
import {
  FiEdit2,
  FiFolder,
  FiFolderPlus,
  FiLoader,
  FiMonitor,
  FiPlus,
  FiTrash2,
} from "react-icons/fi";
import Button from "@/components/ui/button";
import ContextMenu from "@/components/ui/menu/ContextMenu";
import type { ContextMenuItem } from "@/components/ui/menu/ContextMenu";
import InputDialog from "@/components/ui/InputDialog";
import Modal from "@/components/ui/modal/Modal";
import Select from "@/components/ui/select";
import { ROOT_PROFILE_GROUP_VALUE } from "@/constants/hostGroups";
import type { Translate } from "@/i18n";
import type { ConnectingProfileMap, RdpProfile } from "@/types";
import "@/widgets/rdp/components/RdpWidget.css";

const GROUP_NAME_MAX_LENGTH = 12;

type RdpWidgetProps = {
  profiles: RdpProfile[];
  groups: string[];
  activeProfileId: string | null;
  connectingProfiles: ConnectingProfileMap;
  onPick: (id: string) => void;
  onConnectProfile: (profile: RdpProfile) => Promise<void>;
  onOpenNewProfile: () => void;
  onOpenEditProfile: (profile: RdpProfile) => void;
  onRemoveProfile: (profile: RdpProfile) => Promise<void>;
  onAddGroup: (groupName: string) => boolean;
  onRenameGroup: (from: string, to: string) => Promise<boolean>;
  onRemoveGroup: (groupName: string) => Promise<boolean>;
  onMoveProfileToGroup: (
    profileId: string,
    targetGroup: string | null,
  ) => Promise<boolean>;
  t: Translate;
};

export default function RdpWidget({
  profiles,
  groups,
  activeProfileId,
  connectingProfiles,
  onPick,
  onConnectProfile,
  onOpenNewProfile,
  onOpenEditProfile,
  onRemoveProfile,
  onAddGroup,
  onRenameGroup,
  onRemoveGroup,
  onMoveProfileToGroup,
  t,
}: RdpWidgetProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{
    mode: "add" | "rename";
    sourceGroup?: string;
    initialValue?: string;
  } | null>(null);
  const [groupDialogError, setGroupDialogError] = useState<string | null>(null);
  const [removeGroupDialog, setRemoveGroupDialog] = useState<{
    name: string;
    profileCount: number;
  } | null>(null);
  const [moveDialog, setMoveDialog] = useState<RdpProfile | null>(null);
  const [moveGroupValue, setMoveGroupValue] = useState<string>(
    ROOT_PROFILE_GROUP_VALUE,
  );

  const normalizedQuery = query.trim().toLowerCase();
  const queryActive = normalizedQuery.length > 0;

  /** 合并持久化分组与 profile 实际分组，构建当前可渲染的分组列表。 */
  const customGroups = useMemo(() => {
    const map = new Map<string, { label: string; items: RdpProfile[] }>();
    groups.forEach((group) => {
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
  }, [groups, profiles]);

  /** 提取未归入任何分组的根级连接配置。 */
  const rootProfiles = useMemo(
    () =>
      profiles.filter((profile) => {
        const tag = profile.tags?.[0]?.trim() ?? "";
        return !tag;
      }),
    [profiles],
  );

  /** 判断单个连接配置是否命中当前搜索条件。 */
  const matchesProfile = useCallback(
    (profile: RdpProfile) => {
      if (!queryActive) return true;
      const text =
        `${profile.name} ${profile.host} ${profile.username}`.toLowerCase();
      return text.includes(normalizedQuery);
    },
    [normalizedQuery, queryActive],
  );

  /** 判断分组名称本身是否命中搜索条件。 */
  const matchesGroup = useCallback(
    (group: string) =>
      queryActive && group.toLowerCase().includes(normalizedQuery),
    [normalizedQuery, queryActive],
  );

  /** 根据搜索条件过滤分组，同时保留命中的子连接配置。 */
  const filteredGroups = useMemo(() => {
    if (!queryActive) return customGroups;
    return customGroups
      .map((group) => {
        if (matchesGroup(group.label)) return group;
        const matched = group.items.filter(matchesProfile);
        return matched.length
          ? ({ label: group.label, items: matched } as {
              label: string;
              items: RdpProfile[];
            })
          : null;
      })
      .filter(
        (
          item,
        ): item is {
          label: string;
          items: RdpProfile[];
        } => item !== null,
      );
  }, [customGroups, matchesGroup, matchesProfile, queryActive]);

  /** 根据搜索条件过滤根级连接配置。 */
  const filteredRootProfiles = useMemo(() => {
    if (!queryActive) return rootProfiles;
    return rootProfiles.filter(matchesProfile);
  }, [matchesProfile, queryActive, rootProfiles]);

  /** 构建“移动到分组”对话框的可选目标。 */
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

  /** 读取当前待移动连接配置的原始分组，用于禁用重复目标。 */
  const currentMoveGroupValue = useMemo(() => {
    if (!moveDialog) return ROOT_PROFILE_GROUP_VALUE;
    return moveDialog.tags?.[0]?.trim() || ROOT_PROFILE_GROUP_VALUE;
  }, [moveDialog]);

  /** 校验分组名称的必填和长度约束。 */
  function validateGroupName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return t("host.groupNameRequired");
    }
    if (trimmed.length > GROUP_NAME_MAX_LENGTH) {
      return t("host.groupNameTooLong", {
        max: GROUP_NAME_MAX_LENGTH,
      });
    }
    return null;
  }

  /** 统计某个分组下的连接配置数量，用于删除前确认。 */
  function getGroupProfileCount(groupName: string) {
    return profiles.filter(
      (profile) =>
        (profile.tags?.[0]?.trim().toLowerCase() ?? "") ===
        groupName.trim().toLowerCase(),
    ).length;
  }

  /** 在指定坐标打开右键菜单，并阻止事件继续冒泡。 */
  function openMenu(
    event: {
      preventDefault: () => void;
      stopPropagation: () => void;
      clientX: number;
      clientY: number;
    },
    items: ContextMenuItem[],
  ) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  /** 切换分组展开状态，仅对有子项的分组生效。 */
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

  /** 打开新增分组对话框，并清理上一次的错误状态。 */
  function openAddGroupDialog() {
    setMenu(null);
    setGroupDialogError(null);
    setGroupDialog({ mode: "add", initialValue: "" });
  }

  /** 删除指定连接配置，并在失败时向面板回填错误信息。 */
  async function handleRemoveProfile(profile: RdpProfile) {
    setBusy(true);
    setErrorMessage(null);
    try {
      await onRemoveProfile(profile);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** 发起远程桌面连接，重复点击当前连接中的配置时直接忽略。 */
  async function handleConnect(profile: RdpProfile) {
    if (connectingProfiles[profile.id]) return;
    setErrorMessage(null);
    try {
      await onConnectProfile(profile);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  /** 提交分组重命名，并将重复名错误回填到输入对话框。 */
  async function handleRenameGroup(sourceGroup: string, value: string) {
    try {
      const ok = await onRenameGroup(sourceGroup, value);
      if (!ok) {
        setGroupDialogError(t("host.groupNameDuplicate"));
        return;
      }
      setGroupDialogError(null);
      setGroupDialog(null);
    } catch (error) {
      setGroupDialogError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** 删除分组，并在成功后关闭删除确认对话框。 */
  async function handleRemoveGroup(groupName: string) {
    setBusy(true);
    setErrorMessage(null);
    try {
      await onRemoveGroup(groupName);
      setRemoveGroupDialog(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** 将当前待移动连接配置保存到目标分组。 */
  async function handleMoveProfile() {
    if (!moveDialog) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      await onMoveProfileToGroup(
        moveDialog.id,
        moveGroupValue === ROOT_PROFILE_GROUP_VALUE ? null : moveGroupValue,
      );
      setMoveDialog(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** 构建列表空白区域的右键菜单。 */
  function buildRootBlankMenuItems(): ContextMenuItem[] {
    return [
      {
        label: t("host.addGroup"),
        icon: <FiFolderPlus />,
        disabled: busy,
        onClick: openAddGroupDialog,
      },
      {
        label: t("rdp.menu.new"),
        icon: <FiPlus />,
        disabled: busy,
        onClick: () => {
          setMenu(null);
          onOpenNewProfile();
        },
      },
    ];
  }

  /** 构建分组标题的右键菜单。 */
  function buildGroupMenuItems(groupLabel: string): ContextMenuItem[] {
    return [
      {
        label: t("rdp.menu.new"),
        icon: <FiPlus />,
        disabled: busy,
        onClick: () => {
          setMenu(null);
          onOpenNewProfile();
        },
      },
      {
        label: t("host.addGroup"),
        icon: <FiFolderPlus />,
        disabled: busy,
        onClick: openAddGroupDialog,
      },
      {
        label: t("host.menu.renameGroup"),
        icon: <FiEdit2 />,
        disabled: busy,
        onClick: () => {
          setMenu(null);
          setGroupDialog({
            mode: "rename",
            sourceGroup: groupLabel,
            initialValue: groupLabel,
          });
        },
      },
      {
        label: t("host.menu.deleteGroup"),
        icon: <FiTrash2 />,
        disabled: busy,
        onClick: () => {
          setMenu(null);
          const profileCount = getGroupProfileCount(groupLabel);
          if (profileCount === 0) {
            void handleRemoveGroup(groupLabel);
            return;
          }
          setRemoveGroupDialog({ name: groupLabel, profileCount });
        },
      },
    ];
  }

  /** 构建单个连接配置条目的右键菜单。 */
  function buildProfileMenuItems(profile: RdpProfile): ContextMenuItem[] {
    return [
      {
        label: t("profile.menu.edit"),
        icon: <FiEdit2 />,
        disabled: busy,
        onClick: () => {
          setMenu(null);
          onOpenEditProfile(profile);
        },
      },
      {
        label: t("host.menu.moveTo"),
        icon: <FiFolder />,
        disabled: busy,
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
        icon: <FiTrash2 />,
        disabled: busy,
        onClick: () => {
          setMenu(null);
          void handleRemoveProfile(profile);
        },
      },
    ];
  }

  function renderConnectingChip(profileId: string) {
    if (!connectingProfiles[profileId]) return null;
    return (
      <span className="rdp-connecting-chip">
        <FiLoader className="rdp-connecting-icon" />
        <span>{t("session.connecting")}</span>
      </span>
    );
  }

  return (
    <div className="rdp-widget" data-ui="rdp-widget">
      <div className="rdp-list">
        <div className="rdp-list-header" data-slot="rdp-widget-header">
          <input
            className="rdp-search"
            data-ui="rdp-search"
            placeholder={t("rdp.searchPlaceholder")}
            value={query}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div
          className="rdp-list-body"
          data-slot="rdp-widget-list"
          onContextMenu={(event) => {
            openMenu(event, buildRootBlankMenuItems());
          }}
        >
          {filteredGroups.map((group) => (
            <div key={group.label} className="rdp-group">
              <Button
                className={`rdp-group-title ${
                  group.items.length > 0 && expandedGroups.has(group.label)
                    ? "expanded"
                    : ""
                }`}
                variant="ghost"
                size="sm"
                onContextMenu={(event) =>
                  openMenu(event, buildGroupMenuItems(group.label))
                }
                onClick={() => toggleGroup(group.label, group.items.length > 0)}
              >
                <span className="rdp-row-label">
                  <FiFolder className="rdp-row-icon" />
                  <span>{group.label}</span>
                </span>
                <em>{group.items.length}</em>
              </Button>
              {(queryActive || expandedGroups.has(group.label)) && (
                <div className="rdp-group-list rdp-group-list--nested">
                  {group.items.map((profile) => (
                    <Button
                      key={profile.id}
                      className={profile.id === activeProfileId ? "active" : ""}
                      variant="ghost"
                      size="sm"
                      onContextMenu={(event) =>
                        openMenu(event, buildProfileMenuItems(profile))
                      }
                      onClick={() => onPick(profile.id)}
                      onDoubleClick={() => {
                        if (connectingProfiles[profile.id]) return;
                        void handleConnect(profile);
                      }}
                    >
                      <span className="rdp-row-label">
                        <FiMonitor className="rdp-row-icon" />
                        <span>{profile.name || profile.host}</span>
                        {renderConnectingChip(profile.id)}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {filteredRootProfiles.map((profile) => (
            <Button
              key={profile.id}
              className={`rdp-root-profile${
                profile.id === activeProfileId ? " active" : ""
              }`}
              variant="ghost"
              size="sm"
              onContextMenu={(event) =>
                openMenu(event, buildProfileMenuItems(profile))
              }
              onClick={() => onPick(profile.id)}
              onDoubleClick={() => {
                if (connectingProfiles[profile.id]) return;
                void handleConnect(profile);
              }}
            >
              <span className="rdp-row-label">
                <FiMonitor className="rdp-row-icon" />
                <span>{profile.name || profile.host}</span>
                {renderConnectingChip(profile.id)}
              </span>
            </Button>
          ))}
          {!profiles.length ? (
            <div className="rdp-empty-hint" data-ui="rdp-widget-empty">
              {t("rdp.widget.emptyHint")}
            </div>
          ) : null}
          {profiles.length > 0 &&
          !filteredRootProfiles.length &&
          !filteredGroups.length ? (
            <div className="rdp-empty-hint" data-ui="rdp-widget-no-match">
              {t("rdp.noMatch")}
            </div>
          ) : null}
          {errorMessage ? (
            <div className="rdp-error" data-ui="rdp-widget-error">
              {errorMessage}
            </div>
          ) : null}
        </div>
        {menu ? (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={() => setMenu(null)}
          />
        ) : null}
        {groupDialog ? (
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
            maxLength={GROUP_NAME_MAX_LENGTH}
            confirmText={t("actions.save")}
            cancelText={t("actions.cancel")}
            closeText={t("actions.close")}
            errorText={groupDialogError}
            onClose={() => {
              setGroupDialog(null);
              setGroupDialogError(null);
            }}
            onValueChange={() => setGroupDialogError(null)}
            onConfirm={(value) => {
              const errorText = validateGroupName(value);
              if (errorText) {
                setGroupDialogError(errorText);
                return;
              }
              if (groupDialog.mode === "add") {
                if (!onAddGroup(value)) {
                  setGroupDialogError(t("host.groupNameDuplicate"));
                  return;
                }
                setGroupDialog(null);
                setGroupDialogError(null);
                return;
              }
              if (
                !groupDialog.sourceGroup ||
                value === groupDialog.sourceGroup
              ) {
                setGroupDialog(null);
                setGroupDialogError(null);
                return;
              }
              void handleRenameGroup(groupDialog.sourceGroup, value);
            }}
          />
        ) : null}
        {moveDialog ? (
          <Modal
            open
            title={t("host.moveDialogTitle")}
            closeLabel={t("actions.close")}
            bodyClassName="rdp-move-modal-body"
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
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void handleMoveProfile();
                  }}
                >
                  {t("actions.save")}
                </Button>
              </>
            }
          >
            <div className="rdp-move-dialog">
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
        ) : null}
        {removeGroupDialog ? (
          <Modal
            open
            title={t("host.deleteGroupTitle")}
            closeLabel={t("actions.close")}
            bodyClassName="rdp-remove-group-modal-body"
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
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void handleRemoveGroup(removeGroupDialog.name);
                  }}
                >
                  {t("actions.remove")}
                </Button>
              </>
            }
          >
            <div className="rdp-remove-group-dialog">
              <p>
                {t("host.deleteGroupConfirm", {
                  name: removeGroupDialog.name,
                })}
              </p>
              <p>
                {t("host.deleteGroupHint", {
                  target: t("host.ungrouped"),
                  count: removeGroupDialog.profileCount,
                })}
              </p>
            </div>
          </Modal>
        ) : null}
      </div>
    </div>
  );
}
