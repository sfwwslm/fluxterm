import { useMemo, useState } from "react";
import type { HostProfile, LocalShellProfile } from "@/types";
import type { Translate } from "@/i18n";

type HostPanelProps = {
  profiles: HostProfile[];
  activeProfileId: string | null;
  onPick: (id: string) => void;
  onConnectProfile: (profile: HostProfile) => void;
  localShells: LocalShellProfile[];
  onConnectLocalShell: (shell: LocalShellProfile) => void;
  t: Translate;
};

/** 主机管理与分组列表。 */
export default function HostPanel({
  profiles,
  activeProfileId,
  onPick,
  onConnectProfile,
  localShells,
  onConnectLocalShell,
  t,
}: HostPanelProps) {
  const localShellKey = "__local_shells__";
  const localShellLabel = t("host.shellGroup");
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: HostProfile[] }>();
    profiles.forEach((profile) => {
      const raw = profile.tags?.[0] ?? "";
      const label = raw.trim();
      if (!label) return;
      const key = label.toLowerCase();
      const entry = map.get(key) ?? { label, items: [] };
      entry.items.push(profile);
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [profiles]);
  const ungrouped = useMemo(
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
    if (!queryActive) return grouped;
    return grouped
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
  }, [grouped, queryActive, normalizedQuery]);

  const filteredUngrouped = useMemo(() => {
    if (!queryActive) return ungrouped;
    return ungrouped.filter(matchesProfile);
  }, [ungrouped, queryActive, normalizedQuery]);

  function toggleGroup(group: string) {
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
        <div className="host-list-body">
          {localShells.length > 0 &&
            (!queryActive ||
              matchesGroup(localShellLabel) ||
              filteredLocalShells.length > 0) && (
              <div key={localShellKey} className="host-group">
                <button
                  className={`host-group-title ${
                    expandedGroups.has(localShellKey) ? "expanded" : ""
                  }`}
                  onClick={() => toggleGroup(localShellKey)}
                >
                  <span>{localShellLabel}</span>
                  <em>
                    {t("host.groupCount", {
                      count: filteredLocalShells.length,
                    })}
                  </em>
                </button>
                {(queryActive || expandedGroups.has(localShellKey)) && (
                  <div className="host-group-list">
                    {filteredLocalShells.map((shell) => (
                      <button
                        key={shell.id}
                        onDoubleClick={() => onConnectLocalShell(shell)}
                      >
                        <span>{shell.label}</span>
                        <em>{shell.path}</em>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          {filteredUngrouped.map((profile) => (
            <button
              key={profile.id}
              className={profile.id === activeProfileId ? "active" : ""}
              onClick={() => onPick(profile.id)}
              onDoubleClick={() => onConnectProfile(profile)}
            >
              <span>{profile.name || profile.host}</span>
              <em>
                {profile.username}@{profile.host}
              </em>
            </button>
          ))}
          {filteredGroups.map((group) => (
            <div key={group.label} className="host-group">
              <button
                className={`host-group-title ${
                  expandedGroups.has(group.label) ? "expanded" : ""
                }`}
                onClick={() => toggleGroup(group.label)}
              >
                <span>{group.label}</span>
                <em>{t("host.groupCount", { count: group.items.length })}</em>
              </button>
              {(queryActive || expandedGroups.has(group.label)) && (
                <div className="host-group-list">
                  {group.items.map((profile) => (
                    <button
                      key={profile.id}
                      className={profile.id === activeProfileId ? "active" : ""}
                      onClick={() => onPick(profile.id)}
                      onDoubleClick={() => onConnectProfile(profile)}
                    >
                      <span>{profile.name || profile.host}</span>
                      <em>
                        {profile.username}@{profile.host}
                      </em>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!profiles.length && localShells.length === 0 && (
            <div className="empty-hint">{t("host.empty")}</div>
          )}
          {(profiles.length > 0 || localShells.length > 0) &&
            !filteredUngrouped.length &&
            !filteredGroups.length &&
            !filteredLocalShells.length && (
              <div className="empty-hint">{t("host.noMatch")}</div>
            )}
        </div>
      </div>
    </div>
  );
}
