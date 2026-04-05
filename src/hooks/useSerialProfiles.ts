/**
 * 串口 Profile 状态管理。
 * 负责加载串口列表与分组，并封装持久化操作。
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SerialPortInfo, SerialProfile } from "@/types";
import {
  DEFAULT_TERMINAL_BELL_COOLDOWN_MS,
  DEFAULT_TERMINAL_BELL_MODE,
} from "@/constants/terminalBell";

type UseSerialProfilesResult = {
  serialProfiles: SerialProfile[];
  serialGroups: string[];
  availableSerialPorts: SerialPortInfo[];
  activeSerialProfileId: string | null;
  defaultSerialProfile: SerialProfile;
  pickSerialProfile: (profileId: string) => void;
  refreshSerialProfiles: () => Promise<SerialProfile[]>;
  refreshSerialPorts: () => Promise<SerialPortInfo[]>;
  saveSerialProfile: (profile: SerialProfile) => Promise<SerialProfile>;
  removeSerialProfile: (profileId: string) => Promise<void>;
  addSerialGroup: (groupName: string) => boolean;
  renameSerialGroup: (from: string, to: string) => Promise<boolean>;
  removeSerialGroup: (groupName: string) => Promise<boolean>;
  moveSerialProfileToGroup: (
    profileId: string,
    targetGroup: string | null,
  ) => Promise<boolean>;
};

const defaultSerialProfile: SerialProfile = {
  id: "",
  name: "",
  portPath: "",
  baudRate: 115200,
  dataBits: "eight",
  stopBits: "one",
  parity: "none",
  flowControl: "none",
  charset: "utf-8",
  wordSeparators: null,
  bellMode: DEFAULT_TERMINAL_BELL_MODE,
  bellCooldownMs: DEFAULT_TERMINAL_BELL_COOLDOWN_MS,
  localEcho: false,
  lineEnding: "lf",
  tags: null,
  description: null,
};

function normalizeGroupName(value: string) {
  return value.trim();
}

function dedupeGroups(values: string[]) {
  const seen = new Set<string>();
  const list: string[] = [];
  values.forEach((item) => {
    const normalized = normalizeGroupName(item);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(normalized);
  });
  return list.sort((a, b) => a.localeCompare(b));
}

/** 串口 Profile 管理与持久化。 */
export default function useSerialProfiles(): UseSerialProfilesResult {
  const [serialProfiles, setSerialProfiles] = useState<SerialProfile[]>([]);
  const [serialGroups, setSerialGroups] = useState<string[]>([]);
  const [availableSerialPorts, setAvailableSerialPorts] = useState<
    SerialPortInfo[]
  >([]);
  const [activeSerialProfileId, setActiveSerialProfileId] = useState<
    string | null
  >(null);

  function persistGroups(nextGroups: string[]) {
    setSerialGroups(nextGroups);
    return invoke<string[]>("serial_profile_groups_save", {
      groups: nextGroups,
    });
  }

  async function refreshSerialPorts() {
    const ports = await invoke<SerialPortInfo[]>("serial_port_list");
    setAvailableSerialPorts(ports);
    return ports;
  }

  async function refreshSerialProfiles() {
    const [profiles, persistedGroups] = await Promise.all([
      invoke<SerialProfile[]>("serial_profile_list"),
      invoke<string[]>("serial_profile_groups_list"),
    ]);
    const discoveredGroups = profiles
      .map((item) => normalizeGroupName(item.tags?.[0] ?? ""))
      .filter(Boolean);
    setSerialProfiles(profiles);
    setSerialGroups(dedupeGroups([...persistedGroups, ...discoveredGroups]));
    setActiveSerialProfileId((current) => {
      if (current && profiles.some((item) => item.id === current)) {
        return current;
      }
      return profiles[0]?.id ?? null;
    });
    return profiles;
  }

  function pickSerialProfile(profileId: string) {
    setActiveSerialProfileId(profileId);
  }

  async function saveSerialProfile(profile: SerialProfile) {
    const saved = await invoke<SerialProfile>("serial_profile_save", {
      profile,
    });
    const nextProfiles = serialProfiles
      .filter((item) => item.id !== saved.id)
      .concat(saved);
    setSerialProfiles(nextProfiles);
    setActiveSerialProfileId(saved.id);
    const groupName = normalizeGroupName(saved.tags?.[0] ?? "");
    if (groupName) {
      void persistGroups(dedupeGroups([...serialGroups, groupName])).catch(
        () => {},
      );
    }
    return saved;
  }

  async function removeSerialProfile(profileId: string) {
    await invoke("serial_profile_delete", { profileId });
    const nextProfiles = serialProfiles.filter((item) => item.id !== profileId);
    setSerialProfiles(nextProfiles);
    if (activeSerialProfileId === profileId) {
      setActiveSerialProfileId(nextProfiles[0]?.id ?? null);
    }
  }

  function addSerialGroup(groupName: string) {
    const normalized = normalizeGroupName(groupName);
    if (!normalized) return false;
    if (
      serialGroups.some(
        (item) => item.toLowerCase() === normalized.toLowerCase(),
      )
    ) {
      return false;
    }
    void persistGroups(dedupeGroups([...serialGroups, normalized])).catch(
      () => {},
    );
    return true;
  }

  async function renameSerialGroup(from: string, to: string) {
    const source = normalizeGroupName(from);
    const target = normalizeGroupName(to);
    if (!source || !target) return false;
    if (source.toLowerCase() === target.toLowerCase()) return false;
    if (
      serialGroups.some((item) => item.toLowerCase() === target.toLowerCase())
    ) {
      return false;
    }
    try {
      const affected = serialProfiles.filter(
        (item) =>
          normalizeGroupName(item.tags?.[0] ?? "").toLowerCase() ===
          source.toLowerCase(),
      );
      const saved = await Promise.all(
        affected.map((item) =>
          invoke<SerialProfile>("serial_profile_save", {
            profile: { ...item, tags: [target] },
          }),
        ),
      );
      const savedMap = new Map(saved.map((item) => [item.id, item] as const));
      setSerialProfiles((prev) =>
        prev.map((item) => savedMap.get(item.id) ?? item),
      );
      await persistGroups(
        dedupeGroups(
          serialGroups.map((item) =>
            item.toLowerCase() === source.toLowerCase() ? target : item,
          ),
        ),
      );
      return true;
    } catch {
      return false;
    }
  }

  async function removeSerialGroup(groupName: string) {
    const target = normalizeGroupName(groupName);
    if (!target) return false;
    try {
      const affected = serialProfiles.filter(
        (item) =>
          normalizeGroupName(item.tags?.[0] ?? "").toLowerCase() ===
          target.toLowerCase(),
      );
      const saved = await Promise.all(
        affected.map((item) =>
          invoke<SerialProfile>("serial_profile_save", {
            profile: { ...item, tags: null },
          }),
        ),
      );
      const savedMap = new Map(saved.map((item) => [item.id, item] as const));
      setSerialProfiles((prev) =>
        prev.map((item) => savedMap.get(item.id) ?? item),
      );
      await persistGroups(
        serialGroups.filter(
          (item) => item.toLowerCase() !== target.toLowerCase(),
        ),
      );
      return true;
    } catch {
      return false;
    }
  }

  async function moveSerialProfileToGroup(
    profileId: string,
    targetGroup: string | null,
  ) {
    const profile = serialProfiles.find((item) => item.id === profileId);
    if (!profile) return false;
    try {
      const nextGroup = normalizeGroupName(targetGroup ?? "");
      const saved = await invoke<SerialProfile>("serial_profile_save", {
        profile: { ...profile, tags: nextGroup ? [nextGroup] : null },
      });
      setSerialProfiles((prev) =>
        prev.map((item) => (item.id === saved.id ? saved : item)),
      );
      if (nextGroup) {
        await persistGroups(dedupeGroups([...serialGroups, nextGroup]));
      }
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void refreshSerialProfiles().catch(() => {});
      void refreshSerialPorts().catch(() => {});
    });
  }, []);

  return {
    serialProfiles,
    serialGroups,
    availableSerialPorts,
    activeSerialProfileId,
    defaultSerialProfile,
    pickSerialProfile,
    refreshSerialProfiles,
    refreshSerialPorts,
    saveSerialProfile,
    removeSerialProfile,
    addSerialGroup,
    renameSerialGroup,
    removeSerialGroup,
    moveSerialProfileToGroup,
  };
}
