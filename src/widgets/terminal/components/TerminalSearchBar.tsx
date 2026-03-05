/**
 * 终端搜索栏局部状态 Hook。
 * 负责维护搜索关键字、过滤开关和搜索栏可见性，
 * 避免这些 UI 状态继续堆积在 TerminalWidget 中。
 */
import { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiChevronUp, FiX } from "react-icons/fi";
import type { Translate } from "@/i18n";

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

type TerminalSearchBarProps = {
  activeSessionId: string | null;
  onSearchNext: (keyword: string, options?: SearchOptions) => boolean;
  onSearchPrev: (keyword: string, options?: SearchOptions) => boolean;
  onSearchClear: () => void;
  searchResultStats: { resultIndex: number; resultCount: number } | null;
  t: Translate;
};

function resolveSearchDecorations(): SearchDecorations {
  const rootStyle = getComputedStyle(document.documentElement);
  const readVar = (key: string, fallback: string) =>
    rootStyle.getPropertyValue(key).trim() || fallback;
  const borderWeak = readVar("--border-weak", readVar("--border-soft", ""));
  const textMuted = readVar("--text-muted", readVar("--text-secondary", ""));
  const accentSoft = readVar("--accent-soft", readVar("--accent-subtle", ""));
  const accent = readVar("--accent", readVar("--text-primary", ""));
  return {
    matchBackground: borderWeak,
    matchOverviewRuler: textMuted,
    activeMatchBackground: accentSoft,
    activeMatchColorOverviewRuler: accent,
  };
}

/** 终端搜索栏局部状态 Hook。 */
export default function useTerminalSearchBar({
  activeSessionId,
  onSearchNext,
  onSearchPrev,
  onSearchClear,
  searchResultStats,
  t,
}: TerminalSearchBarProps) {
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

  function closeSearch() {
    setSearchVisible(false);
    setSearchMiss(false);
    onSearchClear();
  }

  function openSearch() {
    if (!activeSessionId) return;
    setSearchVisible(true);
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
      decorations: searchHighlightAll ? resolveSearchDecorations() : undefined,
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

  return {
    openSearch,
    renderedSearchBar: searchVisible ? (
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
              closeSearch();
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
            className={`terminal-search-toggle ${searchRegex ? "active" : ""}`}
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
          onClick={closeSearch}
        >
          <FiX />
        </button>
      </div>
    ) : null,
  };
}
