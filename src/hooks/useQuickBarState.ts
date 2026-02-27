import { useEffect, useMemo, useRef, useState } from "react";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { warn } from "@tauri-apps/plugin-log";
import type {
  QuickBarConfig,
  QuickCommandGroup,
  QuickCommandItem,
} from "@/types";
import { getFluxTermConfigDir, getQuickbarPath } from "@/shared/config/paths";
import {
  DEFAULT_QUICKBAR_GROUP_ID,
  DEFAULT_QUICKBAR_GROUP_NAME,
  LEGACY_DEFAULT_QUICKBAR_GROUP_ID,
} from "@/constants/quickbar";

const defaultGroupId = DEFAULT_QUICKBAR_GROUP_ID;

/** 快捷栏默认配置。 */
const defaultQuickBarConfig: QuickBarConfig = {
  version: 1,
  showGroupTitle: true,
  groups: [
    {
      id: defaultGroupId,
      name: DEFAULT_QUICKBAR_GROUP_NAME,
      order: 0,
      visible: true,
    },
  ],
  commands: [],
};

type UseQuickBarStateResult = {
  showGroupTitle: boolean;
  setShowGroupTitle: React.Dispatch<React.SetStateAction<boolean>>;
  groups: QuickCommandGroup[];
  commands: QuickCommandItem[];
  visibleGroupIds: string[];
  addGroup: (name: string) => string | null;
  renameGroup: (groupId: string, name: string) => void;
  removeGroup: (groupId: string) => void;
  toggleGroupVisible: (groupId: string) => void;
  addCommand: (payload: {
    label: string;
    command: string;
    groupId?: string | null;
  }) => void;
  updateCommand: (
    commandId: string,
    payload: Partial<QuickCommandItem>,
  ) => void;
  removeCommand: (commandId: string) => void;
  visibleCommands: Array<QuickCommandItem & { groupName: string }>;
};

/** 生成分组/命令 id：优先使用浏览器原生 UUID。 */
function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const r = Math.floor(Math.random() * 16);
    const v = char === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isValidGroup(value: unknown): value is QuickCommandGroup {
  if (!value || typeof value !== "object") return false;
  const item = value as QuickCommandGroup;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.order === "number" &&
    typeof item.visible === "boolean"
  );
}

function isValidCommand(value: unknown): value is QuickCommandItem {
  if (!value || typeof value !== "object") return false;
  const item = value as QuickCommandItem;
  return (
    typeof item.id === "string" &&
    typeof item.label === "string" &&
    typeof item.command === "string" &&
    typeof item.groupId === "string" &&
    (item.type === undefined || item.type === "sendText")
  );
}

/** 配置规范化：兼容历史默认分组 id，并修正无效字段。 */
function normalizeConfig(value: unknown): QuickBarConfig {
  if (!value || typeof value !== "object") {
    return defaultQuickBarConfig;
  }
  const parsed = value as Partial<QuickBarConfig>;
  const rawGroups = Array.isArray(parsed.groups)
    ? parsed.groups.filter(isValidGroup)
    : [];
  const dedupedGroups: QuickCommandGroup[] = [];
  const seenGroup = new Set<string>();
  rawGroups.forEach((group, index) => {
    const rawId = group.id.trim();
    const id =
      rawId === LEGACY_DEFAULT_QUICKBAR_GROUP_ID ? defaultGroupId : rawId;
    if (!id || seenGroup.has(id)) return;
    seenGroup.add(id);
    dedupedGroups.push({
      id,
      name:
        id === defaultGroupId
          ? DEFAULT_QUICKBAR_GROUP_NAME
          : group.name.trim() || `Group ${index + 1}`,
      order: Number.isFinite(group.order) ? group.order : index,
      visible: group.visible,
    });
  });
  if (!dedupedGroups.some((group) => group.id === defaultGroupId)) {
    dedupedGroups.unshift({
      id: defaultGroupId,
      name: DEFAULT_QUICKBAR_GROUP_NAME,
      order: -1,
      visible: true,
    });
  }
  const sortedGroups = dedupedGroups
    .sort((a, b) => a.order - b.order)
    .map((group, index) => ({ ...group, order: index }));
  const allowedGroupIds = new Set(sortedGroups.map((group) => group.id));

  const rawCommands = Array.isArray(parsed.commands)
    ? parsed.commands.filter(isValidCommand)
    : [];
  const dedupedCommands: QuickCommandItem[] = [];
  const seenCommand = new Set<string>();
  rawCommands.forEach((item) => {
    if (seenCommand.has(item.id)) return;
    seenCommand.add(item.id);
    const nextGroupId =
      item.groupId === LEGACY_DEFAULT_QUICKBAR_GROUP_ID
        ? defaultGroupId
        : item.groupId;
    dedupedCommands.push({
      ...item,
      groupId: allowedGroupIds.has(nextGroupId) ? nextGroupId : defaultGroupId,
      type: "sendText",
    });
  });
  return {
    version: 1,
    showGroupTitle:
      typeof parsed.showGroupTitle === "boolean" ? parsed.showGroupTitle : true,
    groups: sortedGroups,
    commands: dedupedCommands,
  };
}

/** 快捷栏分组与命令状态管理（含本地配置持久化）。 */
export default function useQuickBarState(): UseQuickBarStateResult {
  const [showGroupTitle, setShowGroupTitle] = useState(
    defaultQuickBarConfig.showGroupTitle ?? true,
  );
  const [groups, setGroups] = useState<QuickCommandGroup[]>(
    defaultQuickBarConfig.groups,
  );
  const [commands, setCommands] = useState<QuickCommandItem[]>(
    defaultQuickBarConfig.commands,
  );
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  async function loadConfig() {
    try {
      const path = await getQuickbarPath();
      const existsFile = await exists(path);
      if (!existsFile) {
        loadedRef.current = true;
        return;
      }
      const raw = await readTextFile(path);
      if (!raw) {
        loadedRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeConfig(parsed);
      setShowGroupTitle(normalized.showGroupTitle ?? true);
      setGroups(normalized.groups);
      setCommands(normalized.commands);
    } catch (error) {
      warn(
        JSON.stringify({
          event: "quickbar:load-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      loadedRef.current = true;
    }
  }

  async function saveConfig(payload: QuickBarConfig) {
    const dir = await getFluxTermConfigDir();
    await mkdir(dir, { recursive: true });
    const path = await getQuickbarPath();
    await writeTextFile(path, JSON.stringify(payload, null, 2));
  }

  useEffect(() => {
    loadConfig().catch(() => {});
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveConfig({
        version: 1,
        showGroupTitle,
        groups,
        commands,
      }).catch((error) => {
        warn(
          JSON.stringify({
            event: "quickbar:save-failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    }, 300);
    return () => {
      if (!saveTimerRef.current) return;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [showGroupTitle, groups, commands]);

  const visibleGroupIds = useMemo(
    () =>
      groups
        .filter((group) => group.visible)
        .sort((a, b) => a.order - b.order)
        .map((group) => group.id),
    [groups],
  );

  const visibleCommands = useMemo(() => {
    const groupNameById = new Map(
      groups.map((group) => [group.id, group.name]),
    );
    const visibleSet = new Set(visibleGroupIds);
    return commands
      .filter((item) => visibleSet.has(item.groupId))
      .map((item) => ({
        ...item,
        groupName:
          groupNameById.get(item.groupId) ??
          defaultQuickBarConfig.groups[0].name,
      }));
  }, [commands, groups, visibleGroupIds]);

  function addGroup(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const id = createId();
    setGroups((prev) => [
      ...prev,
      {
        id,
        name: trimmed,
        order: prev.length,
        visible: false,
      },
    ]);
    return id;
  }

  function renameGroup(groupId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setGroups((prev) =>
      prev.map((group) =>
        group.id === groupId ? { ...group, name: trimmed } : group,
      ),
    );
  }

  function removeGroup(groupId: string) {
    if (groupId === defaultGroupId) return;
    setGroups((prev) =>
      prev
        .filter((group) => group.id !== groupId)
        .map((group, index) => ({ ...group, order: index })),
    );
    setCommands((prev) =>
      prev.map((item) =>
        item.groupId === groupId ? { ...item, groupId: defaultGroupId } : item,
      ),
    );
  }

  function toggleGroupVisible(groupId: string) {
    setGroups((prev) =>
      prev.map((group) =>
        group.id === groupId ? { ...group, visible: !group.visible } : group,
      ),
    );
  }

  function addCommand(payload: {
    label: string;
    command: string;
    groupId?: string | null;
  }) {
    const label = payload.label.trim();
    const command = payload.command;
    if (!label) return;
    const groupIds = new Set(groups.map((group) => group.id));
    const groupId =
      payload.groupId && groupIds.has(payload.groupId)
        ? payload.groupId
        : defaultGroupId;
    setCommands((prev) => [
      ...prev,
      {
        id: createId(),
        label,
        command,
        groupId,
        type: "sendText",
      },
    ]);
  }

  function updateCommand(
    commandId: string,
    payload: Partial<QuickCommandItem>,
  ) {
    setCommands((prev) =>
      prev.map((item) => {
        if (item.id !== commandId) return item;
        const groupIds = new Set(groups.map((group) => group.id));
        const nextGroupId =
          payload.groupId && groupIds.has(payload.groupId)
            ? payload.groupId
            : item.groupId;
        return {
          ...item,
          label: payload.label !== undefined ? payload.label : item.label,
          command: payload.command ?? item.command,
          groupId: nextGroupId,
          type: "sendText",
        };
      }),
    );
  }

  function removeCommand(commandId: string) {
    setCommands((prev) => prev.filter((item) => item.id !== commandId));
  }

  return {
    showGroupTitle,
    setShowGroupTitle,
    groups,
    commands,
    visibleGroupIds,
    addGroup,
    renameGroup,
    removeGroup,
    toggleGroupVisible,
    addCommand,
    updateCommand,
    removeCommand,
    visibleCommands,
  };
}
