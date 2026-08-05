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

export interface ScanFromEndOptions {
  /** Bytes per read. Chunks are stitched, so a record on a boundary is not lost. */
  chunkBytes: number;
  /** Hard ceiling on bytes read. Reaching it means "not found within budget", not "absent". */
  maxBytes: number;
}

export interface ScanFromEndResult {
  record: TranscriptRecord | null;
  bytesScanned: number;
  /** True when the scan saw the start of the file, so a null record means "really absent". */
  reachedStart: boolean;
}

/**
 * Newest record matching `predicate`, searching backwards from the end of the file in
 * chunks and stopping at the first hit.
 *
 * The tail window is sized for "what happened recently" and a single turn can be megabytes
 * of tool traffic, so anything anchored to the *start* of a turn is regularly outside it.
 * This is the bounded way to find such an anchor without parsing the whole file: chunks are
 * read newest-first and the partial line at a chunk boundary is carried over as a Buffer and
 * joined with the next chunk, so no record is lost or mangled by the split. Unparseable
 * lines are skipped, exactly as in the forward reader.
 */
export async function scanRecordsFromEnd(
  path: string,
  predicate: (record: TranscriptRecord) => boolean,
  options: ScanFromEndOptions,
): Promise<ScanFromEndResult> {
  const info = await stat(path);
  const size = info.size;
  if (size === 0) return { record: null, bytesScanned: 0, reachedStart: true };

  const chunk = Math.max(4096, Math.floor(options.chunkBytes));
  const budget = Math.min(size, Math.max(chunk, Math.floor(options.maxBytes)));
  const floor = size - budget;

  const handle = await open(path, 'r');
  try {
    let end = size;
    // Raw bytes of a record's tail whose head lies in an earlier chunk. Kept as bytes, not
    // text: decoding a chunk that begins mid-character would replace it with U+FFFD and
    // corrupt exactly the record the stitch is meant to save.
    let carry = Buffer.alloc(0);
    while (end > floor) {
      const start = Math.max(floor, end - chunk);
      const length = end - start;
      const buffer = Buffer.allocUnsafe(length);
      if (length > 0) await handle.read(buffer, 0, length, start);
      const region = Buffer.concat([buffer, carry]);

      let body = region;
      if (start > floor) {
        const newline = region.indexOf(0x0a);
        if (newline === -1) {
          // The whole region sits inside one record — carry all of it further back.
          carry = region;
          end = start;
          continue;
        }
        carry = region.subarray(0, newline);
        body = region.subarray(newline + 1);
      } else {
        carry = Buffer.alloc(0);
      }

      const lines = body.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i]!.trim();
        if (!line) continue;
        let record: TranscriptRecord;
        try {
          record = JSON.parse(line) as TranscriptRecord;
        } catch {
          continue;
        }
        if (predicate(record)) {
          return { record, bytesScanned: size - start, reachedStart: start === 0 };
        }
      }
      end = start;
    }
    return { record: null, bytesScanned: size - floor, reachedStart: floor === 0 };
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
