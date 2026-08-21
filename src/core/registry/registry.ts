/**
 * The live session registry — `~/.claude/sessions/<pid>.json` (RESEARCH.md §1).
 *
 * This is the authoritative answer to "which sessions exist right now". Transcript
 * activity cannot distinguish "thinking" from "killed mid-turn"; the registry can (§4).
 *
 * Treated as a *candidate list*: the file may survive a crash, so every entry is
 * cross-checked against the live process (see `liveness.ts`).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { REGISTRY_FILE_PATTERN } from '../adapters/claude/paths.ts';

export interface RegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  nameSource: string | null;
  entrypoint: string;
  kind: string;
  version: string;
  startedAt: number;
  procStart: string | null;
  /** File the entry was read from. */
  file: string;
  mtimeMs: number;
  /**
   * Optional, agent-reported facts. Absent on all Claude Code versions observed so far
   * (RESEARCH.md §1) — kept for forward compatibility only.
   */
  reportedStatus: string | null;
  waitingFor: string | null;
  reportedAt: number | null;
}

export interface RegistryReadResult {
  entries: RegistryEntry[];
  /** Files that existed but could not be used, with a reason. Never thrown at the caller. */
  problems: { file: string; reason: string }[];
}

export async function readRegistry(sessionsDir: string): Promise<RegistryReadResult> {
  const problems: RegistryReadResult['problems'] = [];
  let names: string[];
  try {
    names = await readdir(sessionsDir);
  } catch (error) {
    return { entries: [], problems: [{ file: sessionsDir, reason: describe(error) }] };
  }

  const entries: RegistryEntry[] = [];
  for (const name of names) {
    const match = REGISTRY_FILE_PATTERN.exec(name);
    if (!match) continue;
    const file = join(sessionsDir, name);
    try {
      const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      const entry = parseRegistryEntry(text, file, Number(match[1]), info.mtimeMs);
      if (entry) entries.push(entry);
      else problems.push({ file, reason: 'missing sessionId or cwd' });
    } catch (error) {
      // A session can exit between readdir and readFile; that is not an error worth surfacing.
      problems.push({ file, reason: describe(error) });
    }
  }

  entries.sort((a, b) => a.startedAt - b.startedAt);
  return { entries, problems };
}

export function parseRegistryEntry(
  text: string,
  file: string,
  pidFromFileName: number,
  mtimeMs: number,
): RegistryEntry | null {
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const sessionId = str(raw.sessionId);
  const cwd = str(raw.cwd);
  if (!sessionId || !cwd) return null;

  const pid = num(raw.pid) ?? pidFromFileName;
  if (!Number.isInteger(pid) || pid <= 0) return null;

  return {
    pid,
    sessionId,
    cwd,
    name: str(raw.name) ?? sessionId.slice(0, 8),
    nameSource: str(raw.nameSource),
    entrypoint: str(raw.entrypoint) ?? 'unknown',
    kind: str(raw.kind) ?? 'unknown',
    version: str(raw.version) ?? 'unknown',
    startedAt: num(raw.startedAt) ?? mtimeMs,
    // `procStart` is a platform process-creation stamp; kept as a string because it is a
    // 64-bit value that must not lose precision (RESEARCH.md §1).
    procStart: str(raw.procStart),
    file,
    mtimeMs,
    // Raw key is `status`, not `reportedStatus` — that is our internal field name, chosen to
    // avoid colliding with the derived `SessionStatus` elsewhere in the model.
    reportedStatus: str(raw.status)?.trim().toLowerCase() ?? null,
    waitingFor: str(raw.waitingFor),
    reportedAt: dateMs(raw.updatedAt),
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Accepts an epoch-ms number or an ISO-8601 string; `null` for anything else, never throws. */
function dateMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
