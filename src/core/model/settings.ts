/**
 * Settings that change behaviour of `core/`. Persisted by the Electron layer
 * (`main/settings.ts`) and edited in the Settings surface (§8).
 */

export interface Thresholds {
  /** Default `T_work` — how long an unpaired tool call may run before it counts as overdue. */
  tWorkMs: number;
  /**
   * Per-tool `T_work` overrides (§6.3). Slow tools (`Bash`, `PowerShell`, `Agent`) get a
   * much longer budget than fast ones (`Read`, `Edit`, `Grep`), because the whole point of
   * the overdue states is "longer than this tool normally takes".
   *
   * This table doubles as the tool's *speed class*: anything budgeted above `tWorkMs` is a
   * tool that is expected to take a while, so an overdue one reads as `stale` rather than
   * `waiting` (§6.2). Give a tool a longer budget and it stops raising permission-prompt
   * suspicion; that is the intended knob.
   */
  perToolWorkMs: Record<string, number>;
}

export interface NotificationSettings {
  enabled: boolean;
  onDone: boolean;
  onWaiting: boolean;
  /** Per-session cooldown so flapping cannot spam (§6.6). */
  cooldownMs: number;
}

/**
 * The four choices the popover's notification quick-switch offers (§8). A *view* on the
 * three booleans above, not a new persisted field — so the switch and the Settings tab's
 * individual checkboxes can never disagree, and nothing about the shipped defaults changes.
 */
export type NotificationMode = 'off' | 'waiting' | 'done' | 'all';

/** Which mode the current booleans read as. `enabled` with nothing selected delivers
 * nothing, so it reads as `off` rather than as an invalid state. */
export function notificationMode(settings: NotificationSettings): NotificationMode {
  if (!settings.enabled) return 'off';
  if (settings.onWaiting && settings.onDone) return 'all';
  if (settings.onWaiting) return 'waiting';
  if (settings.onDone) return 'done';
  return 'off';
}

/**
 * The mode written back onto the booleans. `off` touches `enabled` only: the on/off pair
 * survives, so switching notifications back on restores what was picked before instead of
 * resetting it. `cooldownMs` is never touched by any mode.
 */
export function applyNotificationMode(
  settings: NotificationSettings,
  mode: NotificationMode,
): NotificationSettings {
  if (mode === 'off') return { ...settings, enabled: false };
  return {
    ...settings,
    enabled: true,
    onWaiting: mode === 'waiting' || mode === 'all',
    onDone: mode === 'done' || mode === 'all',
  };
}

export interface ReadingSettings {
  /** First tail window (§5.2). */
  tailWindowBytes: number;
  /** Upper bound for window doubling before giving up with `unknown` (§5.2). */
  maxTailWindowBytes: number;
  /** Trailing debounce for coalescing file events (§5.3). */
  debounceMs: number;
  /** Low-frequency timer for PID liveness and elapsed-time transitions (§5.3). */
  tickIntervalMs: number;
}

export interface UiSettings {
  /** Popover stays open on blur and keeps the position it was dragged to (§8). */
  popoverPinned: boolean;
}

export interface ListSettings {
  /**
   * Drop registry entries that have never exchanged a message (`starting`) from the live
   * surfaces. A freshly opened Claude Code window registers itself before anything happens
   * in it; it is a window, not a session to watch, and listing it makes the app look busier
   * than the work actually is. History is unaffected — this only hides them while live.
   */
  hideUnusedSessions: boolean;
  /**
   * How long a quiet session stays interesting to the *tray* surfaces (popover, tray menu).
   *
   * The tray is the glance surface: it should answer "what needs me right now", and a
   * session whose turn ended two hours ago and which has already been acknowledged answers
   * nothing. Anything running, and anything unacknowledged, is shown regardless of age —
   * this only decides when a settled session drops off. The main window still lists every
   * live session (§6.5).
   */
  trayRecentMs: number;
}

export interface AppSettings {
  /** See `SETTINGS_SCHEMA_VERSION`. Absent in files written before migrations existed. */
  schemaVersion: number;
  /** Override for `~/.claude`. Null = default location. */
  claudeDir: string | null;
  thresholds: Thresholds;
  notifications: NotificationSettings;
  reading: ReadingSettings;
  /** Which live sessions reach the surfaces at all. Read by `core/`. */
  list: ListSettings;
  /** Surface state that has to survive a restart. Nothing in `core/` reads this. */
  ui: UiSettings;
  /** Start the history index in the background after the live tier is on screen (§5.1). */
  indexHistoryOnStart: boolean;
}

/**
 * Upper bound for the configurable debounce. N4 allows ~2 s from change to visible status;
 * the debounce plus a tail read has to fit inside that, and the watcher's max-wait ceiling
 * cannot flush earlier than the debounce itself.
 */
export const MAX_DEBOUNCE_MS = 1_000;

export const DEFAULT_THRESHOLDS: Thresholds = {
  tWorkMs: 25_000,
  perToolWorkMs: {
    // Slow by nature — 60–120 s per §6.3.
    Bash: 120_000,
    PowerShell: 120_000,
    // A subagent that has been running for five minutes is a subagent doing its job, not a
    // session that needs you. Fan-out runs routinely go far past that, so the budget here is
    // measured in tens of minutes; the point at which it flips is `stale`, never `waiting`.
    Agent: 20 * 60_000,
    Workflow: 45 * 60_000,
    WebFetch: 60_000,
    WebSearch: 60_000,
    // Fast by nature — 10 s per §6.3.
    Read: 10_000,
    Edit: 10_000,
    Write: 10_000,
    Grep: 10_000,
    Glob: 10_000,
    TodoWrite: 10_000,
    NotebookEdit: 10_000,
  },
};

/**
 * Bumped whenever a *default* changes in a way that a persisted file would otherwise mask.
 *
 * The settings file is written in full, so every default the user never touched is still in
 * there verbatim — and a merge cannot tell "the user chose 180 s" from "180 s was the default
 * when this file was written". Without a version, changing a default would silently have no
 * effect for anyone who had ever opened Settings. See `migrate`.
 *
 * v2: `waiting` split into `waiting`/`stale`, and the subagent budgets grew from 3 min to
 * 20/45 min accordingly (§6.2).
 */
export const SETTINGS_SCHEMA_VERSION = 2;

/** Per-tool budgets that v1 shipped, kept so v2 can tell them from a deliberate choice. */
const V1_TOOL_DEFAULTS: Record<string, number> = { Agent: 180_000, Workflow: 180_000 };

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  claudeDir: null,
  thresholds: DEFAULT_THRESHOLDS,
  notifications: {
    enabled: true,
    onDone: true,
    onWaiting: true,
    cooldownMs: 60_000,
  },
  reading: {
    tailWindowBytes: 64 * 1024,
    maxTailWindowBytes: 1024 * 1024,
    debounceMs: 250,
    tickIntervalMs: 5_000,
  },
  list: {
    hideUnusedSessions: true,
    trayRecentMs: 30 * 60_000,
  },
  ui: {
    popoverPinned: false,
  },
  indexHistoryOnStart: true,
};

/** `T_work` for a specific tool, falling back to the default (§6.3). */
export function workThresholdFor(thresholds: Thresholds, toolName: string | null): number {
  if (!toolName) return thresholds.tWorkMs;
  const override = thresholds.perToolWorkMs[toolName];
  return typeof override === 'number' && override > 0 ? override : thresholds.tWorkMs;
}

/**
 * "Is this a tool that is *expected* to take a while?" — the speed class that decides
 * whether an overdue call reads as `stale` or as `waiting` (§6.2).
 *
 * Derived from the budget rather than a second hard-coded list, so the two can never
 * disagree and raising a tool's budget in Settings also stops it from claiming to be a
 * permission prompt. Tools with no entry at all (MCP servers, anything new) land on the
 * default budget and therefore in the `waiting` class — the more attention-grabbing of the
 * two, which is the right default for a tool whose normal duration is unknown.
 */
export function isSlowTool(thresholds: Thresholds, toolName: string | null): boolean {
  return workThresholdFor(thresholds, toolName) > thresholds.tWorkMs;
}

/**
 * Bring a persisted payload up to `SETTINGS_SCHEMA_VERSION` before it is merged.
 *
 * The rule is deliberately narrow: only values that are *still* at a superseded default are
 * replaced. Someone who typed 90 s for `Agent` keeps their 90 s; someone who never touched
 * it gets the new budget. Anything already at the current version is returned untouched.
 */
function migrate(payload: Record<string, unknown>): Record<string, unknown> {
  const version = typeof payload.schemaVersion === 'number' ? payload.schemaVersion : 1;
  if (version >= SETTINGS_SCHEMA_VERSION) return payload;

  const thresholds = payload.thresholds as Record<string, unknown> | undefined;
  const perTool = thresholds?.perToolWorkMs as Record<string, unknown> | undefined;
  if (!perTool || typeof perTool !== 'object') return { ...payload, schemaVersion: SETTINGS_SCHEMA_VERSION };

  const migrated: Record<string, unknown> = { ...perTool };
  for (const [tool, v1Default] of Object.entries(V1_TOOL_DEFAULTS)) {
    if (migrated[tool] === v1Default) delete migrated[tool];
  }
  return {
    ...payload,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    thresholds: { ...thresholds, perToolWorkMs: migrated },
  };
}

/** Deep-merge persisted settings over the defaults, ignoring unknown/invalid values. */
export function mergeSettings(partial: unknown): AppSettings {
  const base: AppSettings = {
    ...DEFAULT_SETTINGS,
    thresholds: { ...DEFAULT_THRESHOLDS, perToolWorkMs: { ...DEFAULT_THRESHOLDS.perToolWorkMs } },
    notifications: { ...DEFAULT_SETTINGS.notifications },
    reading: { ...DEFAULT_SETTINGS.reading },
    list: { ...DEFAULT_SETTINGS.list },
    ui: { ...DEFAULT_SETTINGS.ui },
  };
  if (!partial || typeof partial !== 'object') return base;
  const p = migrate(partial as Record<string, unknown>);

  if (typeof p.claudeDir === 'string' && p.claudeDir.trim()) base.claudeDir = p.claudeDir;
  else if (p.claudeDir === null) base.claudeDir = null;

  if (typeof p.indexHistoryOnStart === 'boolean') base.indexHistoryOnStart = p.indexHistoryOnStart;

  const t = p.thresholds as Record<string, unknown> | undefined;
  if (t && typeof t === 'object') {
    if (isPositive(t.tWorkMs)) base.thresholds.tWorkMs = t.tWorkMs;
    if (t.perToolWorkMs && typeof t.perToolWorkMs === 'object') {
      for (const [tool, ms] of Object.entries(t.perToolWorkMs as Record<string, unknown>)) {
        if (isPositive(ms)) base.thresholds.perToolWorkMs[tool] = ms;
      }
    }
  }

  const n = p.notifications as Record<string, unknown> | undefined;
  if (n && typeof n === 'object') {
    if (typeof n.enabled === 'boolean') base.notifications.enabled = n.enabled;
    if (typeof n.onDone === 'boolean') base.notifications.onDone = n.onDone;
    if (typeof n.onWaiting === 'boolean') base.notifications.onWaiting = n.onWaiting;
    if (isNonNegative(n.cooldownMs)) base.notifications.cooldownMs = n.cooldownMs;
  }

  const r = p.reading as Record<string, unknown> | undefined;
  if (r && typeof r === 'object') {
    if (isPositive(r.tailWindowBytes)) base.reading.tailWindowBytes = r.tailWindowBytes;
    if (isPositive(r.maxTailWindowBytes)) base.reading.maxTailWindowBytes = r.maxTailWindowBytes;
    // Capped, because the watcher's max-wait ceiling can never flush sooner than the
    // debounce: a debounce above this would silently put detection outside N4's 2 s budget.
    if (isNonNegative(r.debounceMs)) base.reading.debounceMs = Math.min(r.debounceMs, MAX_DEBOUNCE_MS);
    if (isPositive(r.tickIntervalMs)) base.reading.tickIntervalMs = r.tickIntervalMs;
  }

  const l = p.list as Record<string, unknown> | undefined;
  if (l && typeof l === 'object') {
    if (typeof l.hideUnusedSessions === 'boolean') base.list.hideUnusedSessions = l.hideUnusedSessions;
    if (isPositive(l.trayRecentMs)) base.list.trayRecentMs = l.trayRecentMs;
  }

  const u = p.ui as Record<string, unknown> | undefined;
  if (u && typeof u === 'object') {
    if (typeof u.popoverPinned === 'boolean') base.ui.popoverPinned = u.popoverPinned;
  }

  if (base.reading.maxTailWindowBytes < base.reading.tailWindowBytes) {
    base.reading.maxTailWindowBytes = base.reading.tailWindowBytes;
  }
  return base;
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
