import type React from "react";
import type { Translate } from "@/i18n";
import type {
  DisconnectReason,
  HostProfile,
  Session,
  SessionStateUi,
} from "@/types";

type LocalSessionMeta = Record<
  string,
  { shellId: string | null; label: string }
>;

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
  terminalReady: boolean;
  terminalRef: React.RefObject<HTMLDivElement | null>;
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
  terminalReady,
  terminalRef,
  isLocalSession,
  onSwitchSession,
  onDisconnectSession,
  t,
}: TerminalPanelProps) {
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
        <div
          className={`terminal-container ${terminalReady ? "ready" : ""}`}
          ref={terminalRef}
        />
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
      </div>
    </main>
  );
}
