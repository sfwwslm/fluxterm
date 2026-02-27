import { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiChevronUp, FiX } from "react-icons/fi";
import type { Translate } from "@/i18n";
import type {
  DisconnectReason,
  HostProfile,
  Session,
  SessionStateUi,
} from "@/types";
import ContextMenu from "@/components/terminal/menu/ContextMenu";
import "@/components/terminal/sessions/TerminalPanel.css";

type LocalSessionMeta = Record<
  string,
  { shellId: string | null; label: string }
>;

type SearchDecorations = {
  matchBackground?: string;
  matchBorder?: string;
  matchOverviewRuler: string;
  activeMatchBackground?: string;
  activeMatchBorder?: string;
  activeMatchColorOverviewRuler: string;
};

type SearchOptions = {
  regex?: boolean;
  wholeWord?: boolean;
  caseSensitive?: boolean;
  incremental?: boolean;
  decorations?: SearchDecorations;
};

/** 搜索高亮的视觉配置。 */
const searchDecorations: SearchDecorations = {
  matchBackground: "#314154",
  matchOverviewRuler: "#4b5563",
  activeMatchBackground: "#f2c94c",
  activeMatchColorOverviewRuler: "#f59e0b",
};

type TerminalPanelProps = {
  sessions: Session[];
  profiles: HostProfile[];
  editingProfile: HostProfile;
  localSessionMeta: LocalSessionMeta;
  activeSessionId: string | null;
  activeSession: Session | null;
  activeSessionState: SessionStateUi | null;
  activeSessionReason: DisconnectReason | null;
  sessionStates: Record<string, SessionStateUi>;
  registerTerminalContainer: (
    sessionId: string,
    element: HTMLDivElement | null,
  ) => void;
  isTerminalReady: (sessionId: string) => boolean;
  hasActiveSelection: () => boolean;
  onCopySelection: () => Promise<boolean>;
  onPaste: () => Promise<boolean>;
  onClear: () => boolean;
  onSearchNext: (keyword: string, options?: SearchOptions) => boolean;
  onSearchPrev: (keyword: string, options?: SearchOptions) => boolean;
  onSearchClear: () => void;
  searchResultStats: { resultIndex: number; resultCount: number } | null;
  isLocalSession: (sessionId: string | null) => boolean;
  onSwitchSession: (sessionId: string) => void;
  onDisconnectSession: (sessionId: string) => void;
  t: Translate;
};

/** 终端主区域（头部标签 + 终端画布）。 */
export default function TerminalPanel({
  sessions,
  profiles,
  editingProfile,
  localSessionMeta,
  activeSessionId,
  activeSession,
  activeSessionState,
  activeSessionReason,
  sessionStates,
  registerTerminalContainer,
  isTerminalReady,
  hasActiveSelection,
  onCopySelection,
  onPaste,
  onClear,
  onSearchNext,
  onSearchPrev,
  onSearchClear,
  searchResultStats,
  isLocalSession,
  onSwitchSession,
  onDisconnectSession,
  t,
}: TerminalPanelProps) {
  const containerRefs = useRef<
    Record<string, (element: HTMLDivElement | null) => void>
  >({});
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchMiss, setSearchMiss] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchHighlightAll, setSearchHighlightAll] = useState(true);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!searchVisible) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchVisible]);

  function closeMenu() {
    setMenu(null);
  }

  function search(direction: "next" | "prev") {
    const keyword = searchKeyword.trim();
    if (!keyword) {
      setSearchMiss(false);
      return;
    }
    const options: SearchOptions = {
      caseSensitive: searchCaseSensitive,
      regex: searchRegex,
      wholeWord: searchWholeWord,
      decorations: searchHighlightAll ? searchDecorations : undefined,
    };
    const found =
      direction === "next"
        ? onSearchNext(keyword, options)
        : onSearchPrev(keyword, options);
    setSearchMiss(!found);
  }

  const searchResultText = (() => {
    if (!searchHighlightAll) return "--";
    const total = searchResultStats?.resultCount ?? 0;
    if (total <= 0) return "0/0";
    const index = searchResultStats?.resultIndex ?? -1;
    const current = index >= 0 ? index + 1 : 0;
    return `${current}/${total}`;
  })();

  return (
    <main className="terminal-panel">
      <div className="terminal-header">
        <div className="session-tabs">
          {sessions.map((item) => {
            const localSession = isLocalSession(item.sessionId);
            const profile =
              profiles.find((entry) => entry.id === item.profileId) ??
              editingProfile;
            const localLabel =
              localSessionMeta[item.sessionId]?.label ?? t("session.local");
            const label = localSession
              ? localLabel
              : profile.name || profile.host || t("session.defaultName");
            const active = item.sessionId === activeSessionId;
            const state = sessionStates[item.sessionId];
            return (
              <div
                key={item.sessionId}
                className={`session-tab ${active ? "active" : ""} ${
                  state === "disconnected" ? "disconnected" : ""
                }`}
              >
                <button onClick={() => onSwitchSession(item.sessionId)}>
                  {label}
                </button>
                <button
                  className="close"
                  onClick={() => onDisconnectSession(item.sessionId)}
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="terminal-body">
        {sessions.map((item) => {
          const active = item.sessionId === activeSessionId;
          const ready = isTerminalReady(item.sessionId);
          const refCallback =
            containerRefs.current[item.sessionId] ??
            ((element) => {
              registerTerminalContainer(item.sessionId, element);
            });
          containerRefs.current[item.sessionId] = refCallback;
          return (
            <div
              key={item.sessionId}
              className={`terminal-container ${active ? "active" : ""} ${
                ready ? "ready" : ""
              }`}
              ref={refCallback}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!active) return;
                setMenu({ x: event.clientX, y: event.clientY });
              }}
            />
          );
        })}
        {activeSessionState === "disconnected" &&
          activeSessionReason === "exit" && (
            <div className="terminal-banner">{t("terminal.exitHint")}</div>
          )}
        {!activeSession && (
          <div className="terminal-empty">{t("terminal.empty")}</div>
        )}
        {activeSessionState === "disconnected" &&
          activeSessionReason !== "exit" && (
            <div className="terminal-empty">{t("terminal.empty")}</div>
          )}
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              {
                label: t("terminal.menu.copy"),
                disabled: !hasActiveSelection(),
                onClick: () => {
                  onCopySelection().catch(() => {});
                  closeMenu();
                },
              },
              {
                label: t("terminal.menu.paste"),
                disabled: !activeSessionId,
                onClick: () => {
                  onPaste().catch(() => {});
                  closeMenu();
                },
              },
              {
                label: t("terminal.menu.clear"),
                disabled: !activeSessionId,
                onClick: () => {
                  onClear();
                  closeMenu();
                },
              },
              {
                label: t("terminal.menu.search"),
                disabled: !activeSessionId,
                onClick: () => {
                  closeMenu();
                  setSearchVisible(true);
                },
              },
            ]}
            onClose={closeMenu}
          />
        )}
        {searchVisible && (
          <div className="terminal-search-bar">
            <input
              ref={searchInputRef}
              className={`terminal-search-input ${searchMiss ? "miss" : ""}`}
              value={searchKeyword}
              placeholder={t("terminal.search.placeholder")}
              onChange={(event) => {
                setSearchKeyword(event.target.value);
                setSearchMiss(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  search(event.shiftKey ? "prev" : "next");
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSearchVisible(false);
                  setSearchMiss(false);
                  onSearchClear();
                }
              }}
            />
            <div className="terminal-search-options">
              <button
                className={`terminal-search-toggle ${
                  searchCaseSensitive ? "active" : ""
                }`}
                type="button"
                aria-pressed={searchCaseSensitive}
                aria-label={t("terminal.search.caseSensitive")}
                title={t("terminal.search.caseSensitive")}
                onClick={() => {
                  setSearchCaseSensitive((prev) => !prev);
                  setSearchMiss(false);
                }}
              >
                Aa
              </button>
              <button
                className={`terminal-search-toggle ${
                  searchRegex ? "active" : ""
                }`}
                type="button"
                aria-pressed={searchRegex}
                aria-label={t("terminal.search.regex")}
                title={t("terminal.search.regex")}
                onClick={() => {
                  setSearchRegex((prev) => !prev);
                  setSearchMiss(false);
                }}
              >
                .*
              </button>
              <button
                className={`terminal-search-toggle ${
                  searchWholeWord ? "active" : ""
                }`}
                type="button"
                aria-pressed={searchWholeWord}
                aria-label={t("terminal.search.wholeWord")}
                title={t("terminal.search.wholeWord")}
                onClick={() => {
                  setSearchWholeWord((prev) => !prev);
                  setSearchMiss(false);
                }}
              >
                W
              </button>
              <button
                className={`terminal-search-toggle ${
                  searchHighlightAll ? "active" : ""
                }`}
                type="button"
                aria-pressed={searchHighlightAll}
                aria-label={t("terminal.search.highlightAll")}
                title={t("terminal.search.highlightAll")}
                onClick={() => {
                  setSearchHighlightAll((prev) => {
                    const next = !prev;
                    if (!next) onSearchClear();
                    return next;
                  });
                  setSearchMiss(false);
                }}
              >
                HL
              </button>
            </div>
            <div
              className="terminal-search-results"
              aria-label={t("terminal.search.results")}
            >
              {searchResultText}
            </div>
            <button
              className="terminal-search-icon-button"
              aria-label="search-prev"
              onClick={() => search("prev")}
            >
              <FiChevronUp />
            </button>
            <button
              className="terminal-search-icon-button"
              aria-label="search-next"
              onClick={() => search("next")}
            >
              <FiChevronDown />
            </button>
            <button
              className="terminal-search-icon-button"
              aria-label={t("actions.close")}
              onClick={() => {
                setSearchVisible(false);
                setSearchMiss(false);
                onSearchClear();
              }}
            >
              <FiX />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
