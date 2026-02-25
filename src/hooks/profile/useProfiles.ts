import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HostProfile } from "@/types";

type UseProfilesResult = {
  profiles: HostProfile[];
  activeProfileId: string | null;
  editingProfile: HostProfile;
  defaultProfile: HostProfile;
  pickProfile: (profileId: string) => void;
  saveProfile: (profile: HostProfile) => Promise<HostProfile>;
  removeProfile: (profileId: string) => Promise<void>;
};

const defaultProfile: HostProfile = {
  id: "",
  name: "",
  host: "",
  port: 22,
  username: "",
  authType: "password",
  keyPath: null,
  keyPassphraseRef: null,
  passwordRef: null,
  knownHost: null,
  tags: null,
};

/** 主机配置管理与持久化。 */
export default function useProfiles(): UseProfilesResult {
  const [profiles, setProfiles] = useState<HostProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<HostProfile>(defaultProfile);

  async function loadProfiles() {
    const list = await invoke<HostProfile[]>("profile_list");
    setProfiles(list);
    if (list.length && !activeProfileId) {
      setActiveProfileId(list[0].id);
      setEditingProfile(list[0]);
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

  useEffect(() => {
    loadProfiles().catch(() => {});
  }, []);

  return {
    profiles,
    activeProfileId,
    editingProfile,
    defaultProfile,
    pickProfile,
    saveProfile,
    removeProfile,
  };
}
