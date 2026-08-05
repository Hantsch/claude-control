/**
 * IDE window mapping — `~/.claude/ide/<port>.lock` (RESEARCH.md §3, §7).
 *
 * **Privacy constraint (§4):** these files contain an `authToken`. Only `pid`,
 * `workspaceFolders` and `ideName` are extracted; nothing else is retained, returned or
 * logged. The parse deliberately picks fields by name instead of spreading the object, so
 * a new secret field cannot leak in by accident.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IdeWindowRef } from '../../model/types.ts';
import { IDE_LOCK_PATTERN, isPathInside, normalizePathKey } from './paths.ts';

export async function readIdeWindows(ideDir: string): Promise<IdeWindowRef[]> {
  let names: string[];
  try {
    names = await readdir(ideDir);
  } catch {
    return [];
  }

  const refs: IdeWindowRef[] = [];
  for (const name of names) {
    if (!IDE_LOCK_PATTERN.test(name)) continue;
    const file = join(ideDir, name);
    try {
      const text = await readFile(file, 'utf8');
      const ref = parseIdeLock(text, file);
      if (ref) refs.push(ref);
    } catch {
      // Locks come and go with IDE windows; a missing file is normal.
    }
  }
  return refs;
}

export function parseIdeLock(text: string, source: string): IdeWindowRef | null {
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const pid = raw.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;

  const folders = Array.isArray(raw.workspaceFolders)
    ? raw.workspaceFolders.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : [];
  const ideName = typeof raw.ideName === 'string' && raw.ideName.trim() ? raw.ideName : 'IDE';

  // Only these three fields — `authToken` and everything else is dropped here and now.
  return { pid, ideName, workspaceFolders: folders, source };
}

export interface IdeMatch {
  ref: IdeWindowRef;
  /** The workspace folder that matched. */
  folder: string;
  /** Length of the matched folder key — longest prefix wins (§7). */
  score: number;
}

/**
 * Best IDE window for a session's `cwd`: case-insensitive, normalized,
 * longest-prefix-wins (§7). A session in a subfolder of an open workspace still matches.
 */
export function matchIdeWindow(cwd: string, refs: readonly IdeWindowRef[]): IdeMatch | null {
  let best: IdeMatch | null = null;
  for (const ref of refs) {
    for (const folder of ref.workspaceFolders) {
      if (!isPathInside(cwd, folder)) continue;
      const score = normalizePathKey(folder).length;
      if (!best || score > best.score) best = { ref, folder, score };
    }
  }
  return best;
}
