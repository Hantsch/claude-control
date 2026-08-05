/**
 * Change detection (§5.3).
 *
 * `chokidar` watches the registry, the transcript tree and the IDE lock directory.
 * Events are coalesced **per file** with a 250 ms trailing debounce, so a burst of appends
 * during an active turn causes one re-read rather than fifty. Target latency (N4) is
 * debounce + tail read.
 *
 * `chokidar` is used rather than raw `fs.watch` because Windows both misses and duplicates
 * events; `chokidar` normalizes that.
 */

import { watch, type FSWatcher } from 'chokidar';
import type { WatchRoot, WatchRootKind } from '../adapters/types.ts';

export interface FileChange {
  kind: WatchRootKind;
  path: string;
  event: 'add' | 'change' | 'unlink';
  at: number;
}

export type ChangeListener = (changes: FileChange[]) => void;

export interface WatcherOptions {
  roots: readonly WatchRoot[];
  debounceMs: number;
  /**
   * Hard ceiling on how long an event may sit in the buffer. Without it, a stream of
   * appends with gaps shorter than the debounce would keep resetting the timer and never
   * flush, pushing detection past N4's 2 s budget.
   */
  maxWaitMs?: number;
  onChange: ChangeListener;
  onError?: (error: Error) => void;
  now?: () => number;
}

/** Default ceiling: comfortably inside N4 once the tail read is added on top. */
export const DEFAULT_MAX_WAIT_MS = 1_000;

export class FileWatcher {
  private readonly options: WatcherOptions;
  private readonly now: () => number;
  private watchers: FSWatcher[] = [];
  /** Coalescing buffer: one entry per path, newest event wins. */
  private pending = new Map<string, FileChange>();
  private timer: NodeJS.Timeout | null = null;
  /** When the oldest un-flushed event arrived, for the max-wait ceiling. */
  private oldestPendingAt: number | null = null;
  private stopped = false;

  constructor(options: WatcherOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Resolves once every root has finished its initial scan. Waiting matters for N4: a
   * change that lands while chokidar is still scanning is folded into the initial pass and
   * would otherwise be dropped, leaving the status stale until the next 5 s tick.
   */
  async start(): Promise<void> {
    const ready: Promise<void>[] = [];
    for (const root of this.options.roots) {
      const watcher = watch(root.path, {
        depth: root.depth,
        ignoreInitial: true,
        // We do our own coalescing; awaitWriteFinish would add latency on top (N4).
        awaitWriteFinish: false,
        followSymlinks: false,
        // Read-only: chokidar never writes, and polling is avoided to keep CPU near zero.
        usePolling: false,
      });

      watcher.on('add', (path) => this.enqueue(root.kind, path, 'add'));
      watcher.on('change', (path) => this.enqueue(root.kind, path, 'change'));
      watcher.on('unlink', (path) => this.enqueue(root.kind, path, 'unlink'));
      watcher.on('error', (error) => this.options.onError?.(toError(error)));

      ready.push(
        new Promise<void>((resolve) => {
          // A root that never becomes ready (missing directory, permission problem) must
          // not block startup — the low-frequency tick still covers those sessions.
          const timer = setTimeout(resolve, 5_000);
          timer.unref?.();
          watcher.once('ready', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
      );

      this.watchers.push(watcher);
    }
    await Promise.all(ready);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.oldestPendingAt = null;
    await Promise.all(this.watchers.map((watcher) => watcher.close()));
    this.watchers = [];
  }

  private enqueue(kind: WatchRootKind, path: string, event: FileChange['event']): void {
    if (this.stopped) return;
    const at = this.now();
    if (this.oldestPendingAt === null) this.oldestPendingAt = at;
    this.pending.set(path, { kind, path, event, at });
    this.schedule(at);
  }

  private schedule(at: number): void {
    if (this.timer) clearTimeout(this.timer);
    const debounce = Math.max(0, this.options.debounceMs);
    const maxWait = Math.max(debounce, this.options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
    // Trailing debounce, but never later than `maxWait` after the first pending event.
    const deadline = (this.oldestPendingAt ?? at) + maxWait;
    const delay = Math.max(0, Math.min(debounce, deadline - at));
    this.timer = setTimeout(() => this.flush(), delay);
    // A pending debounce must not hold the process open on shutdown.
    this.timer.unref?.();
  }

  private flush(): void {
    this.timer = null;
    this.oldestPendingAt = null;
    if (this.pending.size === 0) return;
    const changes = [...this.pending.values()];
    this.pending.clear();
    try {
      this.options.onChange(changes);
    } catch (error) {
      this.options.onError?.(toError(error));
    }
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
