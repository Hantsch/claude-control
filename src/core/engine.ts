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
  SessionSnapshot,
  SessionView,
  StatusTransition,
} from './model/types.ts';
import {
  attentionCount,
  compareSessions,
  distinctProjects,
  groupSessions,
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
  private settings: AppSettings;

  private watcher: { start(): Promise<void>; stop(): Promise<void> } | null = null;
  private tick: NodeJS.Timeout | null = null;
  private historyAbort: AbortController | null = null;
  private indexingHistory = false;

  private snapshots = new Map<SessionId, CachedSnapshot>();
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
    const sessions = this.store.listLive().sort(compareSessions);
    return {
      sessions,
      groups: groupSessions(sessions),
      trayState: trayStateFor(sessions),
      attention: attentionCount(sessions),
      projects: distinctProjects([...sessions, ...this.store.listHistory()]),
      at: this.now(),
      indexingHistory: this.indexingHistory,
      historyCount: this.store.historyCount(),
    };
  }

  getSession(id: SessionId): SessionView | null {
    return this.store.getLive(id);
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

  restartHistoryIndex(): void {
    this.historyAbort?.abort();
    this.store.clearHistory();
    this.startHistoryIndex();
  }

  // ---------------------------------------------------------------- internals

  private startTick(): void {
    if (this.tick) clearInterval(this.tick);
    // The 5 s timer carries what file events cannot express: PID liveness re-checks and
    // elapsed-time transitions (working → waiting, working → idle). Those happen *because
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
        if (transition.to === 'ended') this.indexOne(transition.view.transcriptPath);
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
    });

    return {
      sessionId: snapshot.sessionId,
      name: ref.name,
      title: facts.aiTitle ?? facts.lastPromptText ?? null,
      status: derived.status,
      statusReason: derived.reason,
      // 0 lets the store stamp the moment the status actually changed.
      statusSince: 0,
      project: snapshot.project,
      branch: facts.branch,
      groupKey: `${snapshot.project.key}::${facts.branch ?? ''}`,
      model: facts.model,
      entrypoint: ref.entrypoint,
      pid: ref.pid,
      alive: snapshot.alive,
      startedAt: ref.startedAt,
      lastActivityAt: facts.last?.at ?? null,
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
