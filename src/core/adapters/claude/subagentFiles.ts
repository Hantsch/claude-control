/**
 * Subagent transcripts on disk — the evidence a running subagent leaves behind.
 *
 * RESEARCH.md §2 recorded that `isSidechain` was `true` on zero records, so a subagent's
 * inner transcript was assumed to be unobservable and the parent's `Agent` tool call was the
 * only thing to go on. That is no longer true: Claude Code 2.1.241 writes every subagent run
 * to its own file next to the session transcript
 *
 *     projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl
 *     projects/<slug>/<sessionId>/subagents/agent-<agentId>.meta.json
 *
 * and the meta file names the `toolUseId` of the call that spawned it, plus `parentAgentId`
 * for a run that was itself spawned by another subagent. That is the exact link the parent
 * transcript could not provide, and it is what turns "this `Agent` call is 42 minutes old"
 * into "…and its subagent wrote to disk four seconds ago" (§6.2).
 *
 * Only file *metadata* is read here — the meta sidecar and `mtime`. No subagent transcript is
 * ever opened, so none of its prompt or response text is read (§4).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { SUBAGENT_LIVENESS_MS } from '../../model/settings.ts';

/** `agent-<agentId>.meta.json` — the sidecar written when a subagent starts. */
const META_PATTERN = /^(agent-[0-9a-z_-]+)\.meta\.json$/i;

/** `agent-<agentId>.jsonl` — a run's own transcript; only ever `stat`ed, never opened. */
const TRANSCRIPT_PATTERN = /^agent-[0-9a-z_-]+\.jsonl$/i;

/**
 * Longest a session-wide answer may rest on the cached file list without a full re-scan.
 * A run that went quiet past the liveness window and then resumes appends to its file
 * without moving the directory mtime, so only a full pass (or a parent-stamp change) sees it.
 */
const COLD_RECHECK_MS = 60_000;

/** Guard against a malformed `parentAgentId` cycle turning the walk into a hang. */
const MAX_SUBTREE_NODES = 512;

export interface SubagentFileEntry {
  /** Claude Code's id for the run — the `agent-<id>` part of both file names. */
  agentId: string;
  /** `tool_use` id of the `Agent` call that spawned it, when the sidecar named one. */
  toolUseId: string | null;
  /** Set when this run was spawned by another subagent rather than by the session. */
  parentAgentId: string | null;
  /** Absolute path of the run's own transcript. */
  transcript: string;
}

/** The filesystem calls this module makes — injectable so tests can count them. */
export interface SubagentFs {
  stat(path: string): Promise<{ mtimeMs: number }>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

const nodeFs: SubagentFs = {
  stat: (path) => stat(path),
  readdir: (path) => readdir(path),
  readFile: (path, encoding) => readFile(path, encoding),
};

/**
 * Where a session's subagent transcripts live, derived from the session transcript path
 * (`<dir>/<sessionId>.jsonl` → `<dir>/<sessionId>/subagents`). Taking it from the transcript
 * path rather than recomposing it from the slug keeps the case-insensitive project-directory
 * resolution `adapter.ts` already did from having to be repeated here.
 */
export function subagentDirForTranscript(transcriptPath: string): string {
  const file = basename(transcriptPath);
  const sessionId = file.replace(/\.jsonl$/i, '');
  return join(dirname(transcriptPath), sessionId, 'subagents');
}

/** Every sidecar in one session's subagent directory. Absent/unreadable ⇒ empty list. */
export async function readSubagentIndex(
  dir: string,
  fs: SubagentFs = nodeFs,
): Promise<SubagentFileEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    // No directory at all is the normal case for an agent version that does not write one.
    return [];
  }

  const entries: SubagentFileEntry[] = [];
  for (const name of names) {
    const match = META_PATTERN.exec(name);
    if (!match) continue;
    const stem = match[1]!;
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(await fs.readFile(join(dir, name), 'utf8')) as Record<string, unknown>;
    } catch {
      // A half-written sidecar is a missing fact, not an error — the run is simply not
      // linkable this pass, and the next one will pick it up.
      continue;
    }
    entries.push({
      agentId: stem.replace(/^agent-/i, ''),
      toolUseId: str(meta.toolUseId),
      parentAgentId: str(meta.parentAgentId),
      transcript: join(dir, `${stem}.jsonl`),
    });
  }
  return entries;
}

/**
 * "When did this subagent last write anything?", answered per `tool_use` id.
 *
 * Cached per session and invalidated by the *directory's* mtime, which changes whenever a
 * sidecar is added or removed: a steady-state poll is then one `stat` of the directory plus
 * one `stat` per running subagent, never a re-read of every sidecar. A wanted id that the
 * cached index does not know forces one re-read as well, so a run whose sidecar landed
 * without moving the directory mtime is still picked up on the next pass.
 */
export class SubagentActivityReader {
  private readonly cache = new Map<string, { dir: string; dirMtimeMs: number; entries: SubagentFileEntry[] }>();
  private readonly sessionCache = new Map<string, SessionScan>();
  private readonly fs: SubagentFs;

  constructor(options: { fs?: SubagentFs } = {}) {
    this.fs = options.fs ?? nodeFs;
  }

  /**
   * Newest write across each wanted run *and its descendants*. A subagent that spawned one of
   * its own sits idle while the child works — its transcript gets nothing until the child
   * reports back — so the descendants' writes are the ancestor's liveness too.
   *
   * Ids with no sidecar, no transcript, or an unreadable directory are simply absent from the
   * result: "no evidence" must stay distinguishable from "evidence of silence" (§5.2).
   */
  async newestActivity(
    sessionId: string,
    dir: string,
    toolUseIds: readonly string[],
  ): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    const wanted = [...new Set(toolUseIds.filter((id) => typeof id === 'string' && id))];
    if (wanted.length === 0) return found;

    let entries = await this.index(sessionId, dir);
    const byToolUseId = new Map(entries.filter((e) => e.toolUseId).map((e) => [e.toolUseId!, e]));
    if (wanted.some((id) => !byToolUseId.has(id))) {
      entries = await this.index(sessionId, dir, true);
      byToolUseId.clear();
      for (const entry of entries) if (entry.toolUseId) byToolUseId.set(entry.toolUseId, entry);
    }
    if (entries.length === 0) return found;

    const childrenOf = new Map<string, SubagentFileEntry[]>();
    for (const entry of entries) {
      if (!entry.parentAgentId) continue;
      const bucket = childrenOf.get(entry.parentAgentId);
      if (bucket) bucket.push(entry);
      else childrenOf.set(entry.parentAgentId, [entry]);
    }

    for (const id of wanted) {
      const root = byToolUseId.get(id);
      if (!root) continue;
      const newest = await newestMtime(subtree(root, childrenOf), this.fs);
      if (newest !== null) found.set(id, newest);
    }
    return found;
  }

  /**
   * Newest write across *every* `agent-*.jsonl` of the session — linked to a known `Agent`
   * call or not; descendants sit flat in the same directory. `null` when the directory is
   * missing, unreadable or holds no transcript.
   *
   * A full pass (`readdir` + one `stat` per transcript) runs when there is no cache, the
   * directory mtime moved (a file was added or removed), `parentStamp` changed, or the last
   * full pass is older than `COLD_RECHECK_MS`. Otherwise only the directory and the *hot*
   * files — written within `SUBAGENT_LIVENESS_MS` of `now` — are re-`stat`ed: appending to an
   * existing file does not move the directory mtime, so the directory alone would freeze the
   * evidence of exactly the runs that are still working.
   */
  async sessionActivity(
    sessionId: string,
    dir: string,
    parentStamp: string,
    now: number,
  ): Promise<number | null> {
    let dirMtimeMs: number;
    try {
      dirMtimeMs = (await this.fs.stat(dir)).mtimeMs;
    } catch {
      this.sessionCache.delete(sessionId);
      return null;
    }

    const cached = this.sessionCache.get(sessionId);
    let files: Map<string, number>;
    if (
      !cached ||
      cached.dir !== dir ||
      cached.dirMtimeMs !== dirMtimeMs ||
      cached.parentStamp !== parentStamp ||
      now - cached.lastFullAt > COLD_RECHECK_MS
    ) {
      let names: string[];
      try {
        names = await this.fs.readdir(dir);
      } catch {
        this.sessionCache.delete(sessionId);
        return null;
      }
      const paths = names.filter((name) => TRANSCRIPT_PATTERN.test(name)).map((name) => join(dir, name));
      files = await this.statAll(paths);
      this.sessionCache.set(sessionId, { dir, dirMtimeMs, parentStamp, lastFullAt: now, files });
    } else {
      files = cached.files;
      const hot = [...files].filter(([, mtimeMs]) => now - mtimeMs <= SUBAGENT_LIVENESS_MS).map(([path]) => path);
      const fresh = await this.statAll(hot);
      for (const path of hot) {
        const mtimeMs = fresh.get(path);
        // Gone between passes: removal moves the directory mtime, so the next call re-scans.
        if (mtimeMs === undefined) files.delete(path);
        else files.set(path, mtimeMs);
      }
    }

    let newest: number | null = null;
    for (const mtimeMs of files.values()) if (newest === null || mtimeMs > newest) newest = mtimeMs;
    return newest;
  }

  /** Drop a session's cached state — called when the session is gone (§ adapter). */
  forget(sessionId: string): void {
    this.cache.delete(sessionId);
    this.sessionCache.delete(sessionId);
  }

  private async statAll(paths: readonly string[]): Promise<Map<string, number>> {
    const stats = await Promise.all(
      paths.map((path) => this.fs.stat(path).then((info) => info.mtimeMs).catch(() => null)),
    );
    const out = new Map<string, number>();
    paths.forEach((path, i) => {
      const mtimeMs = stats[i];
      if (mtimeMs !== null && mtimeMs !== undefined) out.set(path, mtimeMs);
    });
    return out;
  }

  private async index(sessionId: string, dir: string, force = false): Promise<SubagentFileEntry[]> {
    let dirMtimeMs: number;
    try {
      dirMtimeMs = (await this.fs.stat(dir)).mtimeMs;
    } catch {
      this.cache.delete(sessionId);
      return [];
    }
    const cached = this.cache.get(sessionId);
    if (!force && cached && cached.dir === dir && cached.dirMtimeMs === dirMtimeMs) return cached.entries;

    const entries = await readSubagentIndex(dir, this.fs);
    this.cache.set(sessionId, { dir, dirMtimeMs, entries });
    return entries;
  }
}

function subtree(
  root: SubagentFileEntry,
  childrenOf: Map<string, SubagentFileEntry[]>,
): SubagentFileEntry[] {
  const out: SubagentFileEntry[] = [];
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0 && out.length < MAX_SUBTREE_NODES) {
    const entry = queue.shift()!;
    if (seen.has(entry.agentId)) continue;
    seen.add(entry.agentId);
    out.push(entry);
    queue.push(...(childrenOf.get(entry.agentId) ?? []));
  }
  return out;
}

async function newestMtime(
  entries: readonly SubagentFileEntry[],
  fs: SubagentFs,
): Promise<number | null> {
  const stats = await Promise.all(
    entries.map((entry) => fs.stat(entry.transcript).then((info) => info.mtimeMs).catch(() => null)),
  );
  let newest: number | null = null;
  for (const value of stats) {
    if (value !== null && (newest === null || value > newest)) newest = value;
  }
  return newest;
}

interface SessionScan {
  dir: string;
  dirMtimeMs: number;
  /** Caller's stamp of the parent transcript at the last full pass. */
  parentStamp: string;
  lastFullAt: number;
  /** Every `agent-*.jsonl` seen in the last full pass, by path, with its last known mtime. */
  files: Map<string, number>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
