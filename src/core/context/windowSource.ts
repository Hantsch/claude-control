/**
 * The opt-in model→context-window source (story 005, D3).
 *
 * This is the only module in the app that opens an outbound connection, and the only one
 * under `core/` that writes a file — both renegotiated by name in
 * `test/unit/boundaries.test.ts` rather than by widening the rules. Two hard limits keep
 * that exception honest: nothing is fetched while `enabled` is false, and the only path ever
 * written is `<dataDir>/model-windows.json`, where `dataDir` comes from the caller (the main
 * process passes Electron's `userData`, the CLI resolves it itself). No Claude-Code-owned
 * path is nameable from here at all — the read-only promise stays absolute.
 *
 * Time policy, all three checks in `refresh()`:
 *   - **ceiling** — a cache older than 7 days is due for a refresh. Being past the ceiling
 *     does *not* invalidate it: a context window does not rot the way a price does, so a
 *     stale table is still served (and still counts as exact); its age is surfaced in
 *     `status()` for Diagnostics.
 *   - **cadence** — the due-check itself is evaluated at most every 6 h, so a caller that
 *     ticks every few seconds cannot turn a fresh cache into a busy loop.
 *   - **backoff** — after a failed attempt nothing is retried for 1 h, so being offline
 *     costs one attempt, not one per tick.
 *
 * `{ force: true }` (the Settings toggle) bypasses cadence and backoff. Nothing here throws
 * and nothing can hang: the fetch is bounded by a 10 s abort, and every failure path ends in
 * `status()` reporting `lastOutcome: 'failed'`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lookupWindow, parseModelWindows, type ModelWindowTable } from './modelWindows.ts';

/** The community-maintained table both reference tools use. Named in Settings, not hidden. */
export const MODEL_WINDOWS_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** Cache file name inside the caller-supplied data dir. */
export const MODEL_WINDOWS_FILE = 'model-windows.json';

/** Bumped only when the cached shape changes; an unknown version is ignored, not migrated. */
export const MODEL_WINDOWS_CACHE_VERSION = 1;

const FETCH_TIMEOUT_MS = 10_000;
/** A cache older than this is due for a refresh — but is still used until one succeeds. */
export const REFRESH_CEILING_MS = 7 * 24 * 60 * 60 * 1000;
/** The due-check itself does not run more often than this. */
export const REFRESH_CADENCE_MS = 6 * 60 * 60 * 1000;
/** A failed attempt is not repeated inside this window. */
export const REFRESH_BACKOFF_MS = 60 * 60 * 1000;

/** On-disk shape of `<dataDir>/model-windows.json`. */
export interface ModelWindowCache {
  version: number;
  /** Epoch ms of the fetch that produced `windows`. */
  fetchedAt: number;
  /** The URL it came from, so a cache file explains itself. */
  source: string;
  windows: ModelWindowTable;
}

/** What the last refresh attempt in this process did. `'never'` = none attempted yet. */
export type RefreshOutcome = 'ok' | 'failed' | 'never';

/**
 * Everything Settings and Diagnostics need to render
 * "Exact context windows: on/off · N models · fetched 3 d ago · last refresh ok/failed".
 */
export interface ModelWindowStatus {
  /** The opt-in setting. While false, no request is made and no window is resolved. */
  enabled: boolean;
  /** Models in the table currently held in memory; 0 when there is no cache. */
  entryCount: number;
  /** Epoch ms the cached table was fetched, or null when there is no cache. */
  fetchedAt: number | null;
  /** Age of the cached table in ms, or null when there is no cache. */
  ageMs: number | null;
  /** True once past the 7-day ceiling. Stale data is still used — a label, not a gate. */
  stale: boolean;
  /** Outcome of the last attempt in this process. */
  lastOutcome: RefreshOutcome;
  /** Epoch ms of that attempt, or null when none was made. */
  lastAttemptAt: number | null;
  /** Short reason for the last failure; absent while the last attempt succeeded. */
  lastError?: string;
  /** The URL that would be fetched — Settings names it explicitly. */
  source: string;
}

export interface WindowSourceOptions {
  /** Mirrors `settings.contextWindows.useOnlineTable`. Defaults to false: off until asked. */
  enabled?: boolean;
  /** Injectable clock, mirroring `Engine`'s. */
  now?: () => number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return `request timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
    }
    return error.message || error.name;
  }
  return String(error);
}

/** Accepts a persisted `windows` map, dropping anything that is not a positive window. */
function sanitizeWindows(value: unknown): ModelWindowTable | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const windows: ModelWindowTable = {};
  for (const [model, window] of Object.entries(value as Record<string, unknown>)) {
    if (typeof window !== 'number' || !Number.isFinite(window) || window <= 0) continue;
    windows[model] = window;
  }
  return Object.keys(windows).length > 0 ? windows : null;
}

/** Validates a parsed cache file. Anything unexpected yields null, i.e. "no cache". */
function readCacheShape(raw: unknown): ModelWindowCache | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ModelWindowCache>;
  if (candidate.version !== MODEL_WINDOWS_CACHE_VERSION) return null;
  const fetchedAt = candidate.fetchedAt;
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
  const windows = sanitizeWindows(candidate.windows);
  if (!windows) return null;
  return {
    version: MODEL_WINDOWS_CACHE_VERSION,
    fetchedAt,
    source: typeof candidate.source === 'string' ? candidate.source : MODEL_WINDOWS_URL,
    windows,
  };
}

export class WindowSource {
  private readonly file: string;
  private readonly now: () => number;
  private enabled: boolean;
  private cache: ModelWindowCache | null;
  private lastOutcome: RefreshOutcome = 'never';
  private lastAttemptAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastCheckAt: number | null = null;
  private lastError: string | undefined;
  private inflight: Promise<void> | null = null;

  constructor(dataDir: string, options: WindowSourceOptions = {}) {
    this.file = join(dataDir, MODEL_WINDOWS_FILE);
    this.now = options.now ?? (() => Date.now());
    this.enabled = options.enabled ?? false;
    this.cache = this.read();
  }

  /** Absolute path of the cache file — the single path this class ever writes. */
  get path(): string {
    return this.file;
  }

  /** Follows the setting. Turning it off does not discard the cache, only its use. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** The cached table, or null when there is none — and always null while the setting is off. */
  table(): ModelWindowTable | null {
    if (!this.enabled) return null;
    return this.cache?.windows ?? null;
  }

  /**
   * `lookupWindow` against whatever is currently cached in memory — the entry point D4 hands
   * to the estimator. Null means "no exact number", i.e. keep the estimate.
   */
  lookupWindow(model: string | null): number | null {
    const table = this.table();
    if (!table) return null;
    return lookupWindow(table, model);
  }

  status(): ModelWindowStatus {
    const fetchedAt = this.cache?.fetchedAt ?? null;
    const ageMs = fetchedAt === null ? null : Math.max(0, this.now() - fetchedAt);
    const status: ModelWindowStatus = {
      enabled: this.enabled,
      entryCount: this.cache ? Object.keys(this.cache.windows).length : 0,
      fetchedAt,
      ageMs,
      stale: ageMs !== null && ageMs >= REFRESH_CEILING_MS,
      lastOutcome: this.lastOutcome,
      lastAttemptAt: this.lastAttemptAt,
      source: MODEL_WINDOWS_URL,
    };
    if (this.lastError !== undefined) status.lastError = this.lastError;
    return status;
  }

  /**
   * Evaluates the policy and, if a fetch is due, performs it. Resolves with the resulting
   * status; never rejects. Awaiting it is optional — startup schedules it and walks away.
   */
  async refresh(options: { force?: boolean } = {}): Promise<ModelWindowStatus> {
    const force = options.force === true;
    if (!this.enabled) return this.status();

    // A second caller joins the attempt already running rather than starting a parallel one.
    if (this.inflight) {
      await this.inflight;
      return this.status();
    }

    const at = this.now();
    if (!force) {
      // The cadence gates the *due-check*, so a forced refresh (the Settings toggle) neither
      // consumes it nor postpones the next one — the backoff is what keeps a background tick
      // from re-attempting straight after a forced failure.
      if (this.lastCheckAt !== null && at - this.lastCheckAt < REFRESH_CADENCE_MS) return this.status();
      this.lastCheckAt = at;
      if (this.lastFailureAt !== null && at - this.lastFailureAt < REFRESH_BACKOFF_MS) return this.status();
      if (this.cache !== null && at - this.cache.fetchedAt < REFRESH_CEILING_MS) return this.status();
    }

    this.inflight = this.attempt();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
    return this.status();
  }

  /** One bounded attempt. Swallows everything into `lastOutcome`/`lastError`. */
  private async attempt(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(MODEL_WINDOWS_URL, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
      }
      const payload = (await response.json()) as unknown;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('unexpected payload shape');
      }
      const windows = parseModelWindows(payload as Record<string, unknown>);
      if (Object.keys(windows).length === 0) throw new Error('payload contained no context windows');

      const cache: ModelWindowCache = {
        version: MODEL_WINDOWS_CACHE_VERSION,
        fetchedAt: this.now(),
        source: MODEL_WINDOWS_URL,
        windows,
      };
      this.cache = cache;
      this.lastOutcome = 'ok';
      this.lastError = undefined;
      this.lastFailureAt = null;
      this.write(cache);
    } catch (error) {
      // A failed refresh keeps the previous cache: stale beats nothing, and it is labelled.
      this.lastOutcome = 'failed';
      this.lastError = errorMessage(error);
      this.lastFailureAt = this.now();
    } finally {
      clearTimeout(timer);
      this.lastAttemptAt = this.now();
    }
  }

  /** A missing or unreadable cache is simply "no cache" — never a reason to fail construction. */
  private read(): ModelWindowCache | null {
    try {
      if (!existsSync(this.file)) return null;
      return readCacheShape(JSON.parse(readFileSync(this.file, 'utf8')) as unknown);
    } catch {
      return null;
    }
  }

  /** Atomic temp + rename, mirroring `main/settings.ts`. */
  private write(cache: ModelWindowCache): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
      renameSync(temp, this.file);
    } catch {
      // The cache is a convenience; a failed write must not fail the refresh.
    }
  }
}
