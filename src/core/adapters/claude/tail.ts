/**
 * Tail reading (§5.2).
 *
 * Open the file, seek to `max(0, size - window)`, read forward, discard the first partial
 * line, parse the rest. If the window contains no record matching `predicate` (i.e. no
 * semantic record), double the window — bounded — and retry. The caller decides what to do
 * when even the largest window yields nothing; the adapter maps that to `unknown`.
 *
 * Read-only by construction: files are opened `'r'` and never written, and `mtime` is not
 * touched because we never `utimes` (N2).
 */

import { open, stat } from 'node:fs/promises';
import { parseJsonlChunk } from './jsonl.ts';
import type { TranscriptRecord } from './records.ts';

export interface TailReadOptions {
  initialWindowBytes: number;
  maxWindowBytes: number;
  /** Stop growing the window once this returns true for any record in it. */
  predicate?: (record: TranscriptRecord) => boolean;
}

export interface TailReadResult {
  records: TranscriptRecord[];
  fileSize: number;
  mtimeMs: number;
  /** Window actually used for the successful (or final) read. */
  windowBytes: number;
  /** Byte offset the chunk started at. 0 means the whole file was read. */
  startOffset: number;
  linesParsed: number;
  linesSkipped: number;
  tornTail: boolean;
  /** True when the predicate never matched, even at `maxWindowBytes`. */
  exhausted: boolean;
}

export async function readTail(path: string, options: TailReadOptions): Promise<TailReadResult> {
  const info = await stat(path);
  const fileSize = info.size;
  const mtimeMs = info.mtimeMs;

  const initial = Math.max(1024, Math.floor(options.initialWindowBytes));
  const max = Math.max(initial, Math.floor(options.maxWindowBytes));

  let window = initial;
  let last: TailReadResult | null = null;

  const handle = await open(path, 'r');
  try {
    for (;;) {
      const effective = Math.min(window, Math.max(fileSize, 1));
      const startOffset = Math.max(0, fileSize - effective);
      const length = fileSize - startOffset;
      const buffer = Buffer.allocUnsafe(length);
      if (length > 0) {
        await handle.read(buffer, 0, length, startOffset);
      }
      const parsed = parseJsonlChunk(buffer.toString('utf8'), {
        dropFirstPartial: startOffset > 0,
      });

      const matched = options.predicate ? parsed.records.some(options.predicate) : true;
      last = {
        records: parsed.records,
        fileSize,
        mtimeMs,
        windowBytes: effective,
        startOffset,
        linesParsed: parsed.linesParsed,
        linesSkipped: parsed.linesSkipped,
        tornTail: parsed.tornTail,
        exhausted: !matched,
      };

      // Either we found what we needed, or the window already covers the whole file, or we
      // hit the ceiling — in all three cases growing further is pointless.
      if (matched || startOffset === 0 || effective >= max) return last;
      window = Math.min(window * 2, max);
    }
  } finally {
    await handle.close();
  }
}

/** Newest record satisfying `predicate`, scanning backwards (§5.2). */
export function findLast<T>(records: readonly T[], predicate: (record: T) => boolean): T | null {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i]!;
    if (predicate(record)) return record;
  }
  return null;
}

/**
 * Read the first `bytes` of a file. Used by the history index to recover a session's start
 * time and title cheaply (§5.1).
 */
export async function readHead(
  path: string,
  bytes: number,
): Promise<{ records: TranscriptRecord[]; fileSize: number; mtimeMs: number }> {
  const info = await stat(path);
  const length = Math.min(Math.max(0, bytes), info.size);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    if (length > 0) await handle.read(buffer, 0, length, 0);
    // A head read always ends mid-line unless it covered the whole file; parseJsonlChunk
    // treats the trailing broken line as a torn tail and drops it.
    const parsed = parseJsonlChunk(buffer.toString('utf8'), { dropFirstPartial: false });
    return { records: parsed.records, fileSize: info.size, mtimeMs: info.mtimeMs };
  } finally {
    await handle.close();
  }
}
