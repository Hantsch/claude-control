/**
 * Tolerant JSONL parsing (§5.2).
 *
 * Two failure modes are expected, not exceptional:
 *  - **Torn write** — the last line can be incomplete while Claude is writing. Skipped
 *    silently, never reported as corruption.
 *  - **Partial first line** — a tail read starts mid-line by construction. Dropped.
 */

import type { TranscriptRecord } from './records.ts';

export interface JsonlParseResult {
  records: TranscriptRecord[];
  linesParsed: number;
  /** Lines that failed `JSON.parse` and were skipped. */
  linesSkipped: number;
  /** True when the final line was incomplete (torn write). */
  tornTail: boolean;
}

export interface JsonlParseOptions {
  /**
   * Drop everything before the first newline. Set when the chunk starts mid-file, i.e.
   * whenever the read did not start at offset 0.
   */
  dropFirstPartial: boolean;
}

export function parseJsonlChunk(chunk: string, options: JsonlParseOptions): JsonlParseResult {
  let text = chunk;
  if (options.dropFirstPartial) {
    const firstBreak = text.indexOf('\n');
    text = firstBreak === -1 ? '' : text.slice(firstBreak + 1);
  }

  const lines = text.split('\n');
  const records: TranscriptRecord[] = [];
  let linesParsed = 0;
  let linesSkipped = 0;
  let tornTail = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line.trim()) continue;
    linesParsed += 1;
    const parsed = tryParse(line);
    if (parsed === undefined) {
      // A failure on the very last line of the chunk is a torn write, not corruption.
      if (i === lines.length - 1) tornTail = true;
      else linesSkipped += 1;
      continue;
    }
    records.push(parsed);
  }

  return { records, linesParsed, linesSkipped, tornTail };
}

function tryParse(line: string): TranscriptRecord | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as TranscriptRecord;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Parse a whole file's text. Used by the detail reader, never on the startup path. */
export function parseJsonlFile(text: string): JsonlParseResult {
  return parseJsonlChunk(text, { dropFirstPartial: false });
}
