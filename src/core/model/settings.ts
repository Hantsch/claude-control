/**
 * Settings that change behaviour of `core/`. Persisted by the Electron layer
 * (`main/settings.ts`) and edited in the Settings surface (§8).
 */

export interface Thresholds {
  /** Default `T_work` — how long an unpaired tool call may run before `waiting` (§6.2). */
  tWorkMs: number;
  /** `T_idle` — silence after which a live session is called `idle` (§6.2). */
  tIdleMs: number;
  /**
   * Per-tool `T_work` overrides (§6.3). Slow tools (`Bash`, `PowerShell`, `Agent`) get a
   * much longer budget than fast ones (`Read`, `Edit`, `Grep`), because the whole point of
   * `waiting` is "longer than this tool normally takes".
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

export interface AppSettings {
  /** Override for `~/.claude`. Null = default location. */
  claudeDir: string | null;
  thresholds: Thresholds;
  notifications: NotificationSettings;
  reading: ReadingSettings;
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
  tIdleMs: 15 * 60_000,
  perToolWorkMs: {
    // Slow by nature — 60–180 s per §6.3.
    Bash: 120_000,
    PowerShell: 120_000,
    Agent: 180_000,
    Workflow: 180_000,
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

export const DEFAULT_SETTINGS: AppSettings = {
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
  indexHistoryOnStart: true,
};

/** `T_work` for a specific tool, falling back to the default (§6.3). */
export function workThresholdFor(thresholds: Thresholds, toolName: string | null): number {
  if (!toolName) return thresholds.tWorkMs;
  const override = thresholds.perToolWorkMs[toolName];
  return typeof override === 'number' && override > 0 ? override : thresholds.tWorkMs;
}

/** Deep-merge persisted settings over the defaults, ignoring unknown/invalid values. */
export function mergeSettings(partial: unknown): AppSettings {
  const base: AppSettings = {
    ...DEFAULT_SETTINGS,
    thresholds: { ...DEFAULT_THRESHOLDS, perToolWorkMs: { ...DEFAULT_THRESHOLDS.perToolWorkMs } },
    notifications: { ...DEFAULT_SETTINGS.notifications },
    reading: { ...DEFAULT_SETTINGS.reading },
  };
  if (!partial || typeof partial !== 'object') return base;
  const p = partial as Record<string, unknown>;

  if (typeof p.claudeDir === 'string' && p.claudeDir.trim()) base.claudeDir = p.claudeDir;
  else if (p.claudeDir === null) base.claudeDir = null;

  if (typeof p.indexHistoryOnStart === 'boolean') base.indexHistoryOnStart = p.indexHistoryOnStart;

  const t = p.thresholds as Record<string, unknown> | undefined;
  if (t && typeof t === 'object') {
    if (isPositive(t.tWorkMs)) base.thresholds.tWorkMs = t.tWorkMs;
    if (isPositive(t.tIdleMs)) base.thresholds.tIdleMs = t.tIdleMs;
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
