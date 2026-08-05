/**
 * `SessionStore` behind a repository interface (§5.4).
 *
 * v1 keeps everything in memory: there is no SQLite index, so history is exactly as
 * complete as `~/.claude/projects/` is, and the index is rebuilt on every start. The
 * interface is the deliberate seam that lets a persistence layer be added later without
 * touching the state machine or the UI (§12 "History durability").
 */

import type { SessionStatus } from '../model/status.ts';
import type {
  HistoryEntry,
  HistoryQuery,
  SessionId,
  SessionView,
  StatusTransition,
} from '../model/types.ts';

export interface SessionRepository {
  /** Replace the live set. Returns the transitions this update caused (§6.6). */
  putLive(views: readonly SessionView[], at: number): StatusTransition[];
  listLive(): SessionView[];
  getLive(id: SessionId): SessionView | null;

  putHistory(entries: readonly HistoryEntry[]): void;
  listHistory(query?: HistoryQuery): HistoryEntry[];
  historyCount(query?: HistoryQuery): number;
  clearHistory(): void;

  /** True until the first `putLive` — used to seed states silently on startup (§6.6). */
  isSeeding(): boolean;
}

interface LiveRecord {
  view: SessionView;
  status: SessionStatus;
  statusSince: number;
}

export class InMemorySessionStore implements SessionRepository {
  private live = new Map<SessionId, LiveRecord>();
  private history = new Map<SessionId, HistoryEntry>();
  private seeded = false;

  isSeeding(): boolean {
    return !this.seeded;
  }

  putLive(views: readonly SessionView[], at: number): StatusTransition[] {
    const seeding = !this.seeded;
    const transitions: StatusTransition[] = [];
    const next = new Map<SessionId, LiveRecord>();

    for (const incoming of views) {
      const previous = this.live.get(incoming.sessionId);
      const changed = !previous || previous.status !== incoming.status;
      const statusSince = changed ? (incoming.statusSince || at) : previous.statusSince;
      const view: SessionView = { ...incoming, statusSince };
      next.set(incoming.sessionId, { view, status: incoming.status, statusSince });

      if (changed) {
        transitions.push({
          sessionId: incoming.sessionId,
          from: previous ? previous.status : null,
          to: incoming.status,
          at,
          seeded: seeding,
          view,
        });
      }
    }

    // Sessions that disappeared from the registry ended; report the transition so the tray
    // and the badge update, and so history can pick them up.
    for (const [id, record] of this.live) {
      if (next.has(id)) continue;
      if (record.status === 'ended') continue;
      transitions.push({
        sessionId: id,
        from: record.status,
        to: 'ended',
        at,
        seeded: seeding,
        view: { ...record.view, status: 'ended', statusSince: at, alive: false },
      });
    }

    this.live = next;
    this.seeded = true;
    return transitions;
  }

  listLive(): SessionView[] {
    return [...this.live.values()].map((record) => record.view);
  }

  getLive(id: SessionId): SessionView | null {
    return this.live.get(id)?.view ?? null;
  }

  putHistory(entries: readonly HistoryEntry[]): void {
    for (const entry of entries) this.history.set(entry.sessionId, entry);
  }

  clearHistory(): void {
    this.history.clear();
  }

  listHistory(query: HistoryQuery = {}): HistoryEntry[] {
    const filtered = this.filterHistory(query);
    const offset = Math.max(0, query.offset ?? 0);
    const limit = query.limit && query.limit > 0 ? query.limit : filtered.length;
    return filtered.slice(offset, offset + limit);
  }

  historyCount(query: HistoryQuery = {}): number {
    return this.filterHistory(query).length;
  }

  private filterHistory(query: HistoryQuery): HistoryEntry[] {
    const search = query.search?.trim().toLowerCase() ?? '';
    const liveIds = new Set(this.live.keys());

    const result = [...this.history.values()].filter((entry) => {
      // A session that is running right now belongs to the live list, not to history (F7).
      if (liveIds.has(entry.sessionId)) return false;
      if (query.projectKey && entry.project.key !== query.projectKey) return false;
      const at = entry.endedAt ?? entry.mtimeMs;
      if (query.from != null && at < query.from) return false;
      if (query.to != null && at > query.to) return false;
      if (search) {
        const haystack = `${entry.title ?? ''} ${entry.project.name} ${entry.sessionId} ${entry.branch ?? ''}`;
        if (!haystack.toLowerCase().includes(search)) return false;
      }
      return true;
    });

    result.sort((a, b) => (b.endedAt ?? b.mtimeMs) - (a.endedAt ?? a.mtimeMs));
    return result;
  }
}
