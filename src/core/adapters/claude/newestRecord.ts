/**
 * Per-session cache for "the newest record of one kind", for facts Claude Code writes rarely
 * (the prompt a run started with, the session's titles, its last prompt) and that therefore
 * sit far behind the tail window on any session that has been running for a while.
 */

import type { SessionId } from '../../model/types.ts';
import type { TranscriptRecord } from './records.ts';
import { scanRecordsFromEnd } from './tail.ts';

/**
 * Budget for the one-off backward scan. Measured on the real directory: with the 64 KB tail
 * window, 9 of 10 live sessions had their prompt outside it — a single subagent-heavy turn is
 * easily megabytes — so without the scan the run duration would read "—" almost always.
 */
export const NEWEST_RECORD_SCAN_BYTES = 4 * 1024 * 1024;
export const NEWEST_RECORD_CHUNK_BYTES = 256 * 1024;

export interface NewestRecordSource<T> {
  matches: (record: TranscriptRecord) => boolean;
  valueOf: (record: TranscriptRecord) => T | null;
  /** A cheap source asked before the scan; an answer skips the scan. Must not throw. */
  before?: (path: string, sessionId: SessionId) => Promise<T | null>;
  /**
   * Asked only when the scan found nothing *and* gave up short of the start of the file —
   * "not within budget" rather than "absent".
   */
  beyondBudget?: (path: string) => Promise<T | null>;
}

/**
 * The tail window's value wins and refreshes the cache: a record written while the app is
 * watching always lands in the tail first, so the scan never has to run twice for a session.
 * Otherwise the cached answer — `null` included, so a hopeless case stays one scan — and only
 * then one bounded scan. A failed read is a missing fact, never a failed status read.
 */
export class NewestRecordCache<T> {
  private readonly values = new Map<SessionId, T | null>();

  constructor(private readonly source: NewestRecordSource<T>) {}

  async resolve(sessionId: SessionId, path: string, fromTail: T | null): Promise<T | null> {
    if (fromTail !== null) {
      this.values.set(sessionId, fromTail);
      return fromTail;
    }
    const cached = this.values.get(sessionId);
    if (cached !== undefined) return cached;

    const found = await this.lookUp(sessionId, path).catch(() => null);
    this.values.set(sessionId, found);
    return found;
  }

  forget(sessionId: SessionId): void {
    this.values.delete(sessionId);
  }

  private async lookUp(sessionId: SessionId, path: string): Promise<T | null> {
    const early = this.source.before ? await this.source.before(path, sessionId) : null;
    if (early !== null) return early;

    const hit = await scanRecordsFromEnd(path, this.source.matches, {
      chunkBytes: NEWEST_RECORD_CHUNK_BYTES,
      maxBytes: NEWEST_RECORD_SCAN_BYTES,
    });
    const found = hit.record ? this.source.valueOf(hit.record) : null;
    if (found !== null || hit.reachedStart || !this.source.beyondBudget) return found;
    return this.source.beyondBudget(path);
  }
}
