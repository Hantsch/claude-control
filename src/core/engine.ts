/**
 * `ControlEngine` — the wiring described in §3: RegistryWatcher + TranscriptWatcher feed
 * the SessionStore, the state machine derives status, and status events go out to the
 * tray, the notifier and the renderer.
 *
 * Everything here is plain Node. No Electron import may ever appear in this file or
 * anything it pulls in (§3) — that is what keeps the state machine unit-testable.
 */

import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';
import type { AgentAdapter } from './adapters/types.ts';
import type { AppSettings } from './model/settings.ts';
import type { TrayState } from './model/status.ts';
import type {
  HistoryEntry,
  HistoryQuery,
  IdeWindowRef,
  LiveSessionRef,
  ProjectRef,
  SessionDetail,
  SessionId,
  SessionRun,
  SessionSnapshot,
  SessionStatus,
  SessionView,
  StatusTransition,
  TranscriptTailFacts,
} from './model/types.ts';
import {
  attentionCount,
  compareSessions,
  distinctProjects,
  groupSessions,
  selectTraySessions,
  trayStateFor,
  type ProjectGroup,
} from './state/aggregate.ts';
import { ContextWindowEstimator } from './state/contextPressure.ts';
import { deriveStatus } from './state/machine.ts';
import { InMemorySessionStore, type SessionRepository } from './store/sessionStore.ts';
import { FileWatcher, type FileChange } from './watch/watcher.ts';
import { isTranscriptFile, sessionIdFromTranscriptPath } from './adapters/claude/paths.ts';

export type RefreshReason = 'start' | 'tick' | 'registry' | 'transcript' | 'ide' | 'settings' | 'manual';

export interface EngineSnapshot {
  sessions: SessionView[];
  /**
   * Subset of `sessions` the tray surfaces show — what is in flight, unacknowledged, or
   * recent (§6.5). The main window uses `sessions`/`groups` and stays complete.
   */
  traySessions: SessionView[];
  groups: ProjectGroup[];
  trayState: TrayState;
  attention: number;
  projects: ProjectRef[];
  at: number;
  /** Set while the background history index is still running (§5.1). */
  indexingHistory: boolean;
  historyCount: number;
}

export interface EngineEvents {
  sessions: (snapshot: EngineSnapshot) => void;
  transitions: (transitions: StatusTransition[]) => void;
  history: (info: { count: number; done: boolean }) => void;
  error: (error: Error) => void;
}

export interface ControlEngineOptions {
  adapter: AgentAdapter;
  settings: AppSettings;
  store?: SessionRepository;
  now?: () => number;
  /** Injected in tests to avoid real timers. */
  createWatcher?: (options: {
    roots: ReturnType<AgentAdapter['watchRoots']>;
    debounceMs: number;
    onChange: (changes: FileChange[]) => void;
    onError: (error: Error) => void;
  }) => { start(): Promise<void>; stop(): Promise<void> };
  /**
   * Synchronous cache read: "does this PID currently have a terminal window?" The real
   * Win32 probe (main/, out of scope for `core/`) spawns PowerShell with an 8 s timeout, so
   * it cannot run inline in `getSnapshot()`, which is synchronous and runs every tick — this
   * seam is the cached, instant answer instead. `undefined` means "not known yet" and must
   * never be treated as "no window": a slow/failed/absent probe can never hide a real session.
   */
  hasTerminalWindow?: (pid: number) => boolean | undefined;
}

interface CachedSnapshot {
  snapshot: SessionSnapshot;
  /** File identity at read time, so a tick can skip an unchanged transcript. */
  fileSize: number;
  mtimeMs: number;
}

export class ControlEngine {
  private readonly emitter = new EventEmitter();
  private readonly adapter: AgentAdapter;
  private readonly store: SessionRepository;
  private readonly context = new ContextWindowEstimator();
  private readonly now: () => number;
  private readonly hasTerminalWindow?: (pid: number) => boolean | undefined;
  private settings: AppSettings;

  private watcher: { start(): Promise<void>; stop(): Promise<void> } | null = null;
  private tick: NodeJS.Timeout | null = null;
  private historyAbort: AbortController | null = null;
  private indexingHistory = false;

  private snapshots = new Map<SessionId, CachedSnapshot>();
  /**
   * Sessions the user has silenced toasts for (§6.6, story 004 D4). In-memory only, by
   * design (Decisions (Sprint)): a restart always comes back with nothing muted, and a
   * reappearing session id (same folder, new process) starts unmuted too, since it is
   * cleared the moment the old one transitions to `ended`.
   */
  private mutedSessions = new Set<SessionId>();
  private ideWindows: IdeWindowRef[] = [];
  private refreshChain: Promise<void> = Promise.resolve();
  private started = false;
  /** Kept for diagnostics: why the most recent refresh ran. */
  private lastRefreshReason: RefreshReason = 'start';

  constructor(options: ControlEngineOptions) {
    this.adapter = options.adapter;
    this.settings = options.settings;
    this.store = options.store ?? new InMemorySessionStore();
    this.now = options.now ?? (() => Date.now());
    this.hasTerminalWindow = options.hasTerminalWindow;
    if (options.createWatcher) this.createWatcher = options.createWatcher;
  }

  private createWatcher: NonNullable<ControlEngineOptions['createWatcher']> = (options) =>
    new FileWatcher(options);

  on<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Cold start (N5): the live tier only — ~6 files × 64 KB. The history index is started
   * afterwards, in the background, so it can never delay the first populated list.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.ideWindows = await this.adapter.listIdeWindows().catch(() => []);
    await this.refresh('start');

    this.watcher = this.createWatcher({
      roots: this.adapter.watchRoots(),
      debounceMs: this.settings.reading.debounceMs,
      onChange: (changes) => this.handleChanges(changes),
      onError: (error) => this.emitter.emit('error', error),
    });
    await this.watcher.start();

    this.startTick();
    if (this.settings.indexHistoryOnStart) this.startHistoryIndex();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.tick) {
      clearInterval(this.tick);
      this.tick = null;
    }
    this.historyAbort?.abort();
    this.historyAbort = null;
    await this.watcher?.stop();
    this.watcher = null;
  }

  getSnapshot(): EngineSnapshot {
    // Urgency first: the popover and the tray menu are the fast path, so the session that
    // needs attention must be the one at the top (§6.5 order). `groups` carries the
    // project/branch structure for the main window (F10).
    const all = this.store.listLive();
    // A registry entry that has never exchanged a message is an open window, not a session
    // worth watching, so by default it does not reach any surface. The store still knows
    // about it — this is a presentation filter, not a hole in the state machine, and the
    // moment its first prompt lands it leaves `starting` and shows up.
    const unstarting = this.settings.list.hideUnusedSessions ? all.filter((s) => s.status !== 'starting') : all;
    // A windowless session in the same folder as one that still has a window open is that
    // session's orphan, not a second thing to watch (§4) — but only once the probe actually
    // tells the two apart. `undefined`, from a missing probe or one that has not answered
    // yet, is "not known" and must never read as "no window": that would hide a real session.
    const sessions = (
      this.settings.list.hideOrphanSessions ? unstarting.filter((s) => !this.isOrphan(s, unstarting)) : unstarting
    )
      .sort(compareSessions)
      // Mute is presentation only (§6.6 D4): decorated last, after status/sort/grouping have
      // already been decided from the real, unmuted facts, so a mute can never move a
      // session, change its status or hide it from anything but toasts.
      .map((session) => ({ ...session, muted: this.mutedSessions.has(session.sessionId) }));
    const at = this.now();
    // The tray is the glance surface and gets the narrower list; the icon and the badge
    // follow it, so what the icon claims is always something the popover can show.
    const traySessions = selectTraySessions(sessions, at, this.settings.list.trayRecentMs);
    return {
      sessions,
      traySessions,
      groups: groupSessions(sessions),
      trayState: trayStateFor(traySessions),
      attention: attentionCount(traySessions),
      projects: distinctProjects([...sessions, ...this.store.listHistory()]),
      at,
      indexingHistory: this.indexingHistory,
      historyCount: this.store.historyCount(),
    };
  }

  getSession(id: SessionId): SessionView | null {
    return this.store.getLive(id);
  }

  /**
   * Unfiltered live sessions (before the `hideUnusedSessions`/`hideOrphanSessions` presentation
   * filters) — what the main-process window probe needs to pick its candidates, since a
   * session hidden as an orphan is still a live process whose folder mate still needs its
   * window checked (D2 of story 004).
   */
  getLiveSessions(): SessionView[] {
    return this.store.listLive();
  }

  /**
   * `session` is an orphan iff the probe says it has no window (`false`, not `undefined`)
   * and some other live session in the same folder (`cwd`) does have one (`true`). Absent a
   * probe, or an `undefined` answer for either side, nothing is ever dropped.
   */
  private isOrphan(session: SessionView, all: SessionView[]): boolean {
    if (!this.hasTerminalWindow) return false;
    if (this.hasTerminalWindow(session.pid) !== false) return false;
    return all.some(
      (other) => other !== session && other.cwd === session.cwd && this.hasTerminalWindow!(other.pid) === true,
    );
  }

  /** Why the most recent refresh ran — surfaced in the CLI's verbose output. */
  getLastRefreshReason(): RefreshReason {
    return this.lastRefreshReason;
  }

  listHistory(query: HistoryQuery = {}): { entries: HistoryEntry[]; total: number; indexing: boolean } {
    return {
      entries: this.store.listHistory(query),
      total: this.store.historyCount(query),
      indexing: this.indexingHistory,
    };
  }

  async getDetail(id: SessionId): Promise<SessionDetail> {
    const live = this.store.getLive(id);
    const fromHistory = this.store.listHistory().find((entry) => entry.sessionId === id);
    const path = live?.transcriptPath ?? fromHistory?.transcriptPath ?? null;
    return this.adapter.readDetail(id, path);
  }

  /** IDE windows for the focus feature (§7). Refreshed on lock-file changes. */
  getIdeWindows(): IdeWindowRef[] {
    return this.ideWindows;
  }

  async updateSettings(settings: AppSettings): Promise<void> {
    const watchRelevant =
      settings.reading.debounceMs !== this.settings.reading.debounceMs ||
      settings.claudeDir !== this.settings.claudeDir;
    const tickChanged = settings.reading.tickIntervalMs !== this.settings.reading.tickIntervalMs;
    this.settings = settings;

    if (tickChanged) this.startTick();
    if (watchRelevant && this.watcher) {
      await this.watcher.stop();
      this.watcher = this.createWatcher({
        roots: this.adapter.watchRoots(),
        debounceMs: settings.reading.debounceMs,
        onChange: (changes) => this.handleChanges(changes),
        onError: (error) => this.emitter.emit('error', error),
      });
      await this.watcher.start();
    }
    // Thresholds changed → re-derive from cached facts, no file reads needed.
    await this.refresh('settings');
  }

  /** Force a full re-read. Exposed for the CLI and for the "refresh" affordance in the UI. */
  async refreshNow(): Promise<void> {
    await this.refresh('manual', { force: true });
  }

  /**
   * Mark a session as seen in its current status — clicking it, jumping to it or opening
   * its detail counts. Nothing is re-read; only the badge and the tray colour change, so
   * this is deliberately synchronous.
   */
  acknowledge(id: SessionId): void {
    if (this.store.acknowledge(id)) this.emitter.emit('sessions', this.getSnapshot());
  }

  /** "Mark all as seen" — the way out when several sessions piled up while you were away. */
  acknowledgeAll(): void {
    if (this.store.acknowledgeAll() > 0) this.emitter.emit('sessions', this.getSnapshot());
  }

  /**
   * Silence (or restore) toasts for one session — "Mute this session" (§6.6 D4). Nothing is
   * re-read; only future notification decisions are affected, so this is deliberately
   * synchronous and re-emits immediately, mirroring `acknowledge()`.
   */
  setMuted(id: SessionId, muted: boolean): void {
    const already = this.mutedSessions.has(id);
    if (muted === already) return;
    if (muted) this.mutedSessions.add(id);
    else this.mutedSessions.delete(id);
    this.emitter.emit('sessions', this.getSnapshot());
  }

  isMuted(id: SessionId): boolean {
    return this.mutedSessions.has(id);
  }

  restartHistoryIndex(): void {
    this.historyAbort?.abort();
    this.store.clearHistory();
    this.startHistoryIndex();
  }

  // ---------------------------------------------------------------- internals

  private startTick(): void {
    if (this.tick) clearInterval(this.tick);
    // The 5 s timer carries what file events cannot express: PID liveness re-checks and
    // elapsed-time transitions (working → waiting, working → stale). Those happen *because
    // nothing happened*, so no event can deliver them (§5.3).
    this.tick = setInterval(() => {
      void this.refresh('tick');
    }, Math.max(500, this.settings.reading.tickIntervalMs));
    this.tick.unref?.();
  }

  private handleChanges(changes: readonly FileChange[]): void {
    const kinds = new Set(changes.map((change) => change.kind));

    if (kinds.has('ide')) {
      void this.adapter
        .listIdeWindows()
        .then((windows) => {
          this.ideWindows = windows;
        })
        .catch(() => {
          /* locks vanish with IDE windows; ignore */
        });
    }

    if (kinds.has('registry')) {
      void this.refresh('registry');
      return;
    }

    if (changes.some((change) => change.kind === 'transcripts' && isTranscriptFile(change.path))) {
      void this.refresh('transcript');
    }
  }

  /** Serialized so overlapping events cannot interleave two reads of the same session. */
  private refresh(reason: RefreshReason, options: { force?: boolean } = {}): Promise<void> {
    this.refreshChain = this.refreshChain
      .then(() => this.doRefresh(reason, options))
      .catch((error: unknown) => {
        this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
      });
    return this.refreshChain;
  }

  private async doRefresh(reason: RefreshReason, options: { force?: boolean }): Promise<void> {
    const at = this.now();
    this.lastRefreshReason = reason;
    const refs = await this.adapter.discoverLiveSessions();
    const liveIds = new Set(refs.map((ref) => ref.sessionId));

    for (const id of [...this.snapshots.keys()]) {
      if (!liveIds.has(id)) this.snapshots.delete(id);
    }

    // Live tier: ~6 files × 64 KB, read in parallel (§5.1).
    const snapshots = await Promise.all(
      refs.map((ref) => this.snapshotFor(ref, options.force === true)),
    );
    const views = snapshots.map((snapshot) => this.toView(snapshot, at));

    const transitions = this.store.putLive(views, at);
    if (transitions.length > 0) {
      this.emitter.emit('transitions', transitions);
      // A session that just ended should show up in history without waiting for a restart.
      for (const transition of transitions) {
        if (transition.to !== 'ended') continue;
        this.indexOne(transition.view.transcriptPath);
        // Nothing will ask about this session again, so drop its per-session caches.
        this.context.forget(transition.sessionId);
        this.adapter.forgetSession?.(transition.sessionId);
        // A reappearing session id (same folder, new process) must not inherit a stale mute —
        // mirrors the gate's own cooldown reset on `ended`.
        this.mutedSessions.delete(transition.sessionId);
      }
    }
    this.emitter.emit('sessions', this.getSnapshot());
  }

  /**
   * Re-read a transcript only when it actually changed: a `stat` that finds identical size
   * and mtime lets us re-derive the status from cached facts, which is what makes the 5 s
   * tick nearly free while still catching elapsed-time transitions.
   */
  private async snapshotFor(ref: LiveSessionRef, force: boolean): Promise<SessionSnapshot> {
    const cached = this.snapshots.get(ref.sessionId);
    if (cached && !force) {
      const path = ref.transcriptPath ?? cached.snapshot.ref.transcriptPath;
      if (path && (await this.isUnchanged(path, cached))) {
        // `ref` comes from `discoverLiveSessions`, which already PID-verified the session,
        // so it is alive by construction and only the registry facts can have changed.
        return { ...cached.snapshot, ref, alive: true, readAt: this.now() };
      }
    }

    const snapshot = await this.adapter.readStatus(ref);
    this.snapshots.set(ref.sessionId, {
      snapshot,
      fileSize: snapshot.facts.read.fileSize,
      mtimeMs: snapshot.facts.read.mtimeMs,
    });
    return snapshot;
  }

  private async isUnchanged(path: string, cached: CachedSnapshot): Promise<boolean> {
    try {
      const info = await stat(path);
      return info.size === cached.fileSize && info.mtimeMs === cached.mtimeMs;
    } catch {
      return false;
    }
  }

  private toView(snapshot: SessionSnapshot, at: number): SessionView {
    const { facts, ref } = snapshot;
    const derived = deriveStatus({
      alive: snapshot.alive,
      facts,
      now: at,
      thresholds: this.settings.thresholds,
      reported: {
        status: ref.reportedStatus,
        waitingFor: ref.waitingFor,
        at: ref.reportedAt,
      },
    });

    return {
      sessionId: snapshot.sessionId,
      name: ref.name,
      title: facts.aiTitle ?? facts.lastPromptText ?? null,
      status: derived.status,
      statusReason: derived.reason,
      statusSource: derived.statusSource,
      // 0 lets the store stamp the moment the status actually changed.
      statusSince: 0,
      // The store owns acknowledgement — it is the only thing that survives a re-read.
      seen: false,
      // Placeholder: the engine's mute registry, not the store, owns this — `getSnapshot()`
      // decorates the real value onto every view on the way out.
      muted: false,
      project: snapshot.project,
      branch: facts.branch,
      groupKey: `${snapshot.project.key}::${facts.branch ?? ''}`,
      model: facts.model,
      entrypoint: ref.entrypoint,
      pid: ref.pid,
      alive: snapshot.alive,
      startedAt: ref.startedAt,
      lastActivityAt: facts.last?.at ?? null,
      run: describeRun(facts, derived.status),
      pendingTool: facts.pendingTool ?? facts.stalledTools[0] ?? null,
      context: this.context.estimate(snapshot.sessionId, facts.model, facts.usage),
      subagents: facts.subagents,
      lastAssistantText: facts.lastAssistantText,
      transcriptPath: ref.transcriptPath,
      cwd: ref.cwd,
      agentVersion: facts.agentVersion ?? ref.agentVersion,
    };
  }

  /** Background history index (§5.1, §5.4: rebuilt on every start). */
  private startHistoryIndex(): void {
    const controller = new AbortController();
    this.historyAbort = controller;
    this.indexingHistory = true;

    void (async () => {
      const batch: HistoryEntry[] = [];
      try {
        for await (const entry of this.adapter.indexHistory(controller.signal)) {
          batch.push(entry);
          if (batch.length >= 25) {
            this.store.putHistory(batch.splice(0, batch.length));
            this.emitter.emit('history', { count: this.store.historyCount(), done: false });
          }
        }
        if (batch.length > 0) this.store.putHistory(batch);
      } catch (error) {
        this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
      } finally {
        if (this.historyAbort === controller) {
          this.indexingHistory = false;
          this.historyAbort = null;
        }
        this.emitter.emit('history', { count: this.store.historyCount(), done: true });
        this.emitter.emit('sessions', this.getSnapshot());
      }
    })();
  }

  /** Re-index a single transcript, e.g. right after its session ended. */
  private indexOne(path: string | null): void {
    if (!path) return;
    void this.adapter
      .readHistoryEntry(path)
      .then((entry) => {
        if (!entry) return;
        this.store.putHistory([entry]);
        this.emitter.emit('history', { count: this.store.historyCount(), done: !this.indexingHistory });
      })
      .catch(() => {
        /* best effort: the transcript may already be gone */
      });
  }
}

/** Statuses in which the current run is still going, so its duration keeps ticking. */
const ONGOING_STATUSES = new Set<SessionStatus>(['working', 'waiting', 'stale', 'queued']);

/**
 * The run the session is in, or the last one it finished: from the newest prompt to the end
 * of that turn. `endedAt` stays null while the turn is ongoing; for a finished one the newest
 * semantic record is the end. Null when the tail window holds no prompt at all — a very long
 * turn can push its own prompt out of the window, and guessing then would be a lie (§5.2).
 */
function describeRun(facts: TranscriptTailFacts, status: SessionStatus): SessionRun | null {
  const startedAt = facts.runStartedAt;
  if (startedAt === null) return null;
  if (ONGOING_STATUSES.has(status)) return { startedAt, endedAt: null };
  // The prompt is itself a semantic record, so `last` is normally at or after it; the
  // fallback keeps a finished run from rendering as one that is still ticking.
  const last = facts.last?.at ?? null;
  return { startedAt, endedAt: last !== null && last >= startedAt ? last : startedAt };
}
