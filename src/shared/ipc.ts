/**
 * The IPC contract (§3).
 *
 * The renderer is a pure view: all derivation happens in main and the renderer receives
 * finished view models. It has no filesystem access (`contextIsolation: true`,
 * `nodeIntegration: false`), so this file is the entire surface between the two worlds.
 *
 * Only `import type` from `core/` appears here — no core code is bundled into the renderer.
 */

import type { AppSettings } from '../core/model/settings.ts';
import type { SessionStatus, TrayState } from '../core/model/status.ts';
import type { ProjectGroup } from '../core/state/aggregate.ts';
import type {
  ContextPressure,
  HistoryEntry,
  HistoryQuery,
  ProjectRef,
  SessionDetail,
  SessionId,
  SessionRun,
  SessionView,
  SubagentMetrics,
  SubagentNode,
} from '../core/model/types.ts';

export type {
  AppSettings,
  ContextPressure,
  HistoryEntry,
  HistoryQuery,
  ProjectGroup,
  ProjectRef,
  SessionDetail,
  SessionId,
  SessionRun,
  SessionStatus,
  SessionView,
  SubagentMetrics,
  SubagentNode,
  TrayState,
};

/** Everything the UI needs to render the live surfaces. Structured-clone safe. */
export interface AppState {
  sessions: SessionView[];
  /** What the tray surfaces show — in flight, unacknowledged, or recent (§6.5). */
  traySessions: SessionView[];
  groups: ProjectGroup[];
  trayState: TrayState;
  attention: number;
  projects: ProjectRef[];
  at: number;
  indexingHistory: boolean;
  historyCount: number;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  indexing: boolean;
}

/** How the window for a session was found — reported back so the UI can be honest (§7). */
export type FocusMethod = 'vscode' | 'process-chain' | 'none';

export interface FocusResult {
  ok: boolean;
  method: FocusMethod;
  /** True when foreground activation was refused and the taskbar button was flashed. */
  flashed: boolean;
  /** Window title or IDE name, when known. */
  target: string | null;
  /** Human-readable outcome, shown verbatim when `ok` is false. */
  message: string;
  /** Offered for copying when no window could be resolved (§7). */
  cwd: string;
}

/** Shape returned by `ShortcutManager.status()` (§main/shortcuts.ts). */
export interface ShortcutStatus {
  accelerator: string;
  registered: boolean;
  error: string | null;
}

/**
 * Outcome of registering `claude-control://` with `app.setAsDefaultProtocolClient` (D4/D1 of
 * story 013) — a discriminated union rather than a formatted string, so a failure can be told
 * apart from a path by callers (e.g. Settings → Diagnostics). Defined here, not in
 * `main/toast-protocol.ts`, because this file is also part of the renderer's TS project
 * (`tsconfig.web.json`), which cannot reference anything under `main/`.
 */
export type ProtocolRegistration =
  | { state: 'registered'; path: string; args: string[] }
  | { state: 'failed'; path: string; reason: string }
  | { state: 'unsupported' };

export interface DiagnosticsInfo {
  claudeDir: string;
  adapterId: string;
  appVersion: string;
  electronVersion: string;
  /** Whether native window focus is available (koffi loaded) — §7. */
  focusBackend: string;
  platform: string;
  /**
   * The exe path registered for `claude-control://` toast buttons (D4/D5) — e.g. Jump or Mute
   * this session on Windows. Lets a user tell whether it still points at a portable EXE that
   * has since moved or been deleted.
   */
  protocolTarget: ProtocolRegistration;
}

export const IPC = {
  // renderer → main (invoke)
  getState: 'cc:get-state',
  getHistory: 'cc:get-history',
  getDetail: 'cc:get-detail',
  focusSession: 'cc:focus-session',
  acknowledge: 'cc:acknowledge',
  acknowledgeAll: 'cc:acknowledge-all',
  setSessionMuted: 'cc:set-session-muted',
  getSettings: 'cc:get-settings',
  setSettings: 'cc:set-settings',
  resetSettings: 'cc:reset-settings',
  getShortcutStatus: 'cc:get-shortcut-status',
  refresh: 'cc:refresh',
  reindexHistory: 'cc:reindex-history',
  copyText: 'cc:copy-text',
  revealPath: 'cc:reveal-path',
  openMainWindow: 'cc:open-main-window',
  closePopover: 'cc:close-popover',
  diagnostics: 'cc:diagnostics',
  quit: 'cc:quit',

  // main → renderer (send)
  stateChanged: 'cc:state-changed',
  historyChanged: 'cc:history-changed',
  settingsChanged: 'cc:settings-changed',
  shortcutStatusChanged: 'cc:shortcut-status',
} as const;

/** Shape exposed on `window.claudeControl` by the preload script. */
export interface RendererApi {
  getState(): Promise<AppState>;
  getHistory(query: HistoryQuery): Promise<HistoryPage>;
  getDetail(id: SessionId): Promise<SessionDetail>;
  focusSession(id: SessionId): Promise<FocusResult>;
  /** Mark one session as seen in its current status, clearing it from the tray badge. */
  acknowledge(id: SessionId): Promise<void>;
  /** Mark every live session as seen. */
  acknowledgeAll(): Promise<void>;
  /** Mute or unmute toast notifications for one session (§6.6). */
  setSessionMuted(id: SessionId, muted: boolean): Promise<void>;
  getSettings(): Promise<AppSettings>;
  setSettings(settings: AppSettings): Promise<AppSettings>;
  resetSettings(): Promise<AppSettings>;
  getShortcutStatus(): Promise<ShortcutStatus>;
  refresh(): Promise<void>;
  reindexHistory(): Promise<void>;
  copyText(text: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  openMainWindow(tab?: 'sessions' | 'history' | 'settings'): Promise<void>;
  closePopover(): Promise<void>;
  diagnostics(): Promise<DiagnosticsInfo>;
  quit(): Promise<void>;
  onStateChanged(listener: (state: AppState) => void): () => void;
  onHistoryChanged(listener: (info: { count: number; done: boolean }) => void): () => void;
  onSettingsChanged(listener: (settings: AppSettings) => void): () => void;
  onShortcutStatusChanged(listener: (status: ShortcutStatus) => void): () => void;
}
