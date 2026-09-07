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

  /**
   * Mark one session as seen *in its current status*. Returns true when that changed
   * anything, so the caller can skip a pointless re-render.
   */
  acknowledge(id: SessionId): boolean;
  /** Mark every live session as seen. Returns how many rows changed. */
  acknowledgeAll(): number;

  /**
   * Explicitly dismiss one session from the tray surfaces — "Mark as seen" in the popover.
   * Implies `acknowledge`, and additionally takes the row out of the popover regardless of
   * how recent it is (`isTrayWorthy`). Returns true when that changed anything.
   */
  dismiss(id: SessionId): boolean;
  /** "Mark all as seen" — dismiss every live session. Returns how many rows changed. */
  dismissAll(): number;

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
  /**
   * How new the session was when the user acknowledged it (see `newsStamp`), or null if
   * they never did. Storing a stamp rather than a flag is what makes the badge re-arm by
   * itself: anything that happens afterwards produces a higher stamp, while the 5 s tick
   * re-deriving the same state does not.
   */
  seenAt: number | null;
  /**
   * The same stamp for an *explicit* dismissal, or null. Kept apart from `seenAt` because
   * the two gestures mean different things: clicking a session (or jumping to it) only says
   * "I have read this", and the tray deliberately keeps such a row around for a while;
   * "Mark as seen" says "take it off the list now".
   */
  dismissedAt: number | null;
}

/**
 * The moment this session last produced *news* — either it changed state, or something new
 * landed in its transcript. Both matter: `done → working → done` is a new turn even though
 * the state reads the same, and a turn that finishes between two polls can look like an
 * uninterrupted `done` while it is plainly something the user has not seen.
 */
function newsStamp(view: SessionView, statusSince: number): number {
  return Math.max(statusSince, view.lastActivityAt ?? 0);
}

/**
 * `newsStamp` for a view the store has already stamped — `view.statusSince` is the store's
 * own value, so this is the same number the seen/dismissed re-arming is decided from.
 * Exported for the engine's "was already done when we started" filter (`hideDoneOnStart`).
 */
export function sessionNewsStamp(view: SessionView): number {
  return newsStamp(view, view.statusSince);
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
      const seenAt = previous?.seenAt ?? null;
      const dismissedAt = previous?.dismissedAt ?? null;
      const stamp = newsStamp(incoming, statusSince);
      const seen = seenAt !== null && seenAt >= stamp;
      // Re-armed by news exactly like `seen`: a dismissed session that produces a new turn
      // (or changes status) is news again and comes back to the tray surfaces by itself.
      const dismissed = dismissedAt !== null && dismissedAt >= stamp;
      const view: SessionView = { ...incoming, statusSince, seen, dismissed };
      next.set(incoming.sessionId, {
        view,
        status: incoming.status,
        statusSince,
        seenAt,
        dismissedAt,
      });

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

  acknowledge(id: SessionId): boolean {
    const record = this.live.get(id);
    if (!record) return false;
    const stamp = newsStamp(record.view, record.statusSince);
    if (record.seenAt !== null && record.seenAt >= stamp) return false;
    record.seenAt = stamp;
    record.view = { ...record.view, seen: true };
    return true;
  }

  acknowledgeAll(): number {
    let changed = 0;
    for (const id of this.live.keys()) {
      if (this.acknowledge(id)) changed += 1;
    }
    return changed;
  }

  dismiss(id: SessionId): boolean {
    const record = this.live.get(id);
    if (!record) return false;
    const stamp = newsStamp(record.view, record.statusSince);
    if (record.dismissedAt !== null && record.dismissedAt >= stamp) return false;
    // A dismissal is an acknowledgement too, so the badge clears with the row.
    record.seenAt = stamp;
    record.dismissedAt = stamp;
    record.view = { ...record.view, seen: true, dismissed: true };
    return true;
  }

  dismissAll(): number {
    let changed = 0;
    for (const id of this.live.keys()) {
      if (this.dismiss(id)) changed += 1;
    }
    return changed;
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
