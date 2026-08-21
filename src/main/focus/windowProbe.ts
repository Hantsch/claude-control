/**
 * Cached, synchronous answer to "does this pid currently have a terminal window?" (D2 of
 * story 004). `ControlEngineOptions.hasTerminalWindow` needs an instant read on every tick,
 * but the real answer comes from a PowerShell probe that can take up to 8 s — so the probe
 * runs out-of-band, on its own pass, and only ever updates a cache that `get()` reads.
 *
 * Cost control: a session that is the only one in its folder can never be dropped by the
 * orphan filter (there is nothing to prefer over it), so it is never a *candidate* and is
 * never probed. Only folders (grouped by `cwd`) with ≥2 live sessions spend any PowerShell
 * time at all — the common case (one session per folder) costs zero.
 */

import { findWindowsUpChain } from './processChain.ts';

export interface LiveSessionRef {
  pid: number;
  cwd: string;
}

export interface WindowProbeOptions {
  /** How long a cached answer is trusted before it is re-probed. */
  ttlMs?: number;
  now?: () => number;
  /** Injected in tests to avoid a real PowerShell/child_process call. */
  probe?: (pids: readonly number[]) => Promise<Map<number, boolean>>;
}

interface CacheEntry {
  value: boolean;
  probedAt: number;
}

const DEFAULT_TTL_MS = 30_000;

export class WindowProbe {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly probeFn: (pids: readonly number[]) => Promise<Map<number, boolean>>;
  private readonly cache = new Map<number, CacheEntry>();
  /** Guards against overlapping probe passes when a caller triggers them faster than they resolve. */
  private inFlight: Promise<void> | null = null;

  constructor(options: WindowProbeOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.probeFn = options.probe ?? findWindowsUpChain;
  }

  /** Synchronous read for `ControlEngineOptions.hasTerminalWindow`. `undefined` = not known yet. */
  get(pid: number): boolean | undefined {
    return this.cache.get(pid)?.value;
  }

  /**
   * Pids belonging to a `cwd` that currently holds ≥2 live sessions — the only ones the
   * orphan filter can ever act on, and so the only ones worth spending a PowerShell call on.
   */
  static candidatePids(sessions: readonly LiveSessionRef[]): number[] {
    const byCwd = new Map<string, LiveSessionRef[]>();
    for (const session of sessions) {
      const group = byCwd.get(session.cwd);
      if (group) group.push(session);
      else byCwd.set(session.cwd, [session]);
    }
    const pids: number[] = [];
    for (const group of byCwd.values()) {
      if (group.length < 2) continue;
      for (const session of group) pids.push(session.pid);
    }
    return pids;
  }

  /**
   * One probe pass: figures out which candidate pids are missing from the cache or past
   * their TTL, and — only if that set is non-empty — makes one batched call for all of them.
   * A single session in a folder never reaches this call at all (D2 acceptance).
   */
  async refresh(sessions: readonly LiveSessionRef[]): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    const run = this.runOnce(sessions).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    await run;
  }

  private async runOnce(sessions: readonly LiveSessionRef[]): Promise<void> {
    // Pids that fell out of every folder (session ended, or its folder is back to one)
    // are dropped so the cache does not grow unboundedly across the app's lifetime.
    const live = new Set(sessions.map((s) => s.pid));
    for (const pid of this.cache.keys()) {
      if (!live.has(pid)) this.cache.delete(pid);
    }

    const candidates = WindowProbe.candidatePids(sessions);
    const at = this.now();
    const stale = candidates.filter((pid) => {
      const entry = this.cache.get(pid);
      return !entry || at - entry.probedAt >= this.ttlMs;
    });
    if (stale.length === 0) return;

    const results = await this.probeFn(stale);
    const probedAt = this.now();
    for (const pid of stale) {
      const value = results.get(pid) ?? false;
      this.cache.set(pid, { value, probedAt });
    }
  }
}

export function createWindowProbe(options?: WindowProbeOptions): WindowProbe {
  return new WindowProbe(options);
}
