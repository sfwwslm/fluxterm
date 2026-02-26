import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HostProfile } from "@/types";

type UseProfilesResult = {
  profiles: HostProfile[];
  sshGroups: string[];
  activeProfileId: string | null;
  editingProfile: HostProfile;
  defaultProfile: HostProfile;
  pickProfile: (profileId: string) => void;
  saveProfile: (profile: HostProfile) => Promise<HostProfile>;
  removeProfile: (profileId: string) => Promise<void>;
  addGroup: (groupName: string) => boolean;
  renameGroup: (from: string, to: string) => Promise<boolean>;
  removeGroup: (groupName: string) => Promise<boolean>;
  moveProfileToGroup: (
    profileId: string,
    targetGroup: string | null,
  ) => Promise<boolean>;
};

const defaultProfile: HostProfile = {
  id: "",
  name: "",
  host: "",
  port: 22,
  username: "",
  authType: "password",
  privateKeyPath: null,
  privateKeyPassphraseRef: null,
  passwordRef: null,
  knownHost: null,
  tags: null,
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

/** 主机配置管理与持久化。 */
export default function useProfiles(): UseProfilesResult {
  const [profiles, setProfiles] = useState<HostProfile[]>([]);
  const [sshGroups, setSshGroups] = useState<string[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<HostProfile>(defaultProfile);

  function persistGroups(nextGroups: string[]) {
    setSshGroups(nextGroups);
    return invoke<string[]>("profile_groups_save", { groups: nextGroups });
  }

  async function loadProfiles() {
    const [list, persistedGroups] = await Promise.all([
      invoke<HostProfile[]>("profile_list"),
      invoke<string[]>("profile_groups_list"),
    ]);
    const normalized = list.map((profile) => {
      const rawAuth = profile.authType as string;
      if (
        rawAuth === "key" ||
        rawAuth === "public_key" ||
        rawAuth === "publicKey"
      ) {
        return {
          ...profile,
          authType: "privateKey" as HostProfile["authType"],
        };
      }
      if (rawAuth === "agent") {
        return {
          ...profile,
          authType: "privateKey" as HostProfile["authType"],
        };
      }
      return profile;
    });
    const discoveredGroups = normalized
      .map((item) => normalizeGroupName(item.tags?.[0] ?? ""))
      .filter(Boolean);
    setSshGroups(dedupeGroups([...persistedGroups, ...discoveredGroups]));
    setProfiles(normalized);
    if (normalized.length && !activeProfileId) {
      setActiveProfileId(normalized[0].id);
      setEditingProfile(normalized[0]);
    }
  }

  function pickProfile(profileId: string) {
    setActiveProfileId(profileId);
    const profile = profiles.find((item) => item.id === profileId);
    if (profile) {
      setEditingProfile(profile);
    }
  }

  async function saveProfile(profile: HostProfile) {
    const saved = await invoke<HostProfile>("profile_save", { profile });
    const groupName = normalizeGroupName(saved.tags?.[0] ?? "");
    if (groupName) {
      const nextGroups = dedupeGroups([...sshGroups, groupName]);
      await persistGroups(nextGroups).catch(() => {});
    }
    const nextProfiles = profiles
      .filter((item) => item.id !== saved.id)
      .concat(saved);
    setProfiles(nextProfiles);
    setActiveProfileId(saved.id);
    setEditingProfile(saved);
    return saved;
  }

  async function removeProfile(profileId: string) {
    await invoke("profile_remove", { profileId });
    const next = profiles.filter((item) => item.id !== profileId);
    setProfiles(next);
    if (activeProfileId === profileId) {
      setActiveProfileId(next[0]?.id ?? null);
      setEditingProfile(next[0] ?? defaultProfile);
    }
  }

  function addGroup(groupName: string) {
    const normalized = normalizeGroupName(groupName);
    if (!normalized) return false;
    if (
      sshGroups.some((item) => item.toLowerCase() === normalized.toLowerCase())
    ) {
      return false;
    }
    const nextGroups = dedupeGroups([...sshGroups, normalized]);
    persistGroups(nextGroups).catch(() => {});
    return true;
  }

  async function renameGroup(from: string, to: string) {
    const source = normalizeGroupName(from);
    const target = normalizeGroupName(to);
    if (!source || !target) return false;
    if (source.toLowerCase() === target.toLowerCase()) return false;
    if (sshGroups.some((item) => item.toLowerCase() === target.toLowerCase())) {
      return false;
    }

    const affected = profiles.filter(
      (item) =>
        normalizeGroupName(item.tags?.[0] ?? "").toLowerCase() ===
        source.toLowerCase(),
    );
    if (!affected.length) {
      const nextGroups = dedupeGroups(
        sshGroups.map((item) =>
          item.toLowerCase() === source.toLowerCase() ? target : item,
        ),
      );
      await persistGroups(nextGroups);
      return true;
    }
    try {
      const savedProfiles = await Promise.all(
        affected.map((item) =>
          invoke<HostProfile>("profile_save", {
            profile: { ...item, tags: [target] },
          }),
        ),
      );
      const map = new Map(
        savedProfiles.map((item) => [item.id, item] as const),
      );
      const nextGroups = dedupeGroups(
        sshGroups.map((item) =>
          item.toLowerCase() === source.toLowerCase() ? target : item,
        ),
      );
      await persistGroups(nextGroups);
      setProfiles((prev) => prev.map((item) => map.get(item.id) ?? item));
      setEditingProfile((prev) => map.get(prev.id) ?? prev);
      return true;
    } catch {
      return false;
    }
  }

  async function removeGroup(groupName: string) {
    const target = normalizeGroupName(groupName);
    if (!target) return false;
    const targetKey = target.toLowerCase();
    const exists = sshGroups.some((item) => item.toLowerCase() === targetKey);
    if (!exists) return false;

    const affected = profiles.filter(
      (item) =>
        normalizeGroupName(item.tags?.[0] ?? "").toLowerCase() === targetKey,
    );
    if (!affected.length) {
      const nextGroups = sshGroups.filter(
        (item) => item.toLowerCase() !== targetKey,
      );
      await persistGroups(nextGroups);
      return true;
    }

    try {
      const savedProfiles = await Promise.all(
        affected.map((item) =>
          invoke<HostProfile>("profile_save", {
            profile: { ...item, tags: null },
          }),
        ),
      );
      const map = new Map(
        savedProfiles.map((item) => [item.id, item] as const),
      );
      const nextGroups = sshGroups.filter(
        (item) => item.toLowerCase() !== targetKey,
      );
      await persistGroups(nextGroups);
      setProfiles((prev) => prev.map((item) => map.get(item.id) ?? item));
      setEditingProfile((prev) => map.get(prev.id) ?? prev);
      return true;
    } catch {
      return false;
    }
  }

  async function moveProfileToGroup(
    profileId: string,
    targetGroup: string | null,
  ) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return false;
    const nextGroup = normalizeGroupName(targetGroup ?? "");
    const payload: HostProfile = {
      ...profile,
      tags: nextGroup ? [nextGroup] : null,
    };
    try {
      const saved = await invoke<HostProfile>("profile_save", {
        profile: payload,
      });
      if (nextGroup) {
        const nextGroups = dedupeGroups([...sshGroups, nextGroup]);
        await persistGroups(nextGroups);
      }
      setProfiles((prev) =>
        prev.map((item) => (item.id === saved.id ? saved : item)),
      );
      setEditingProfile((prev) => (prev.id === saved.id ? saved : prev));
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    loadProfiles().catch(() => {});
  }, []);

  return {
    profiles,
    sshGroups,
    activeProfileId,
    editingProfile,
    defaultProfile,
    pickProfile,
    saveProfile,
    removeProfile,
    addGroup,
    renameGroup,
    removeGroup,
    moveProfileToGroup,
  };
}
