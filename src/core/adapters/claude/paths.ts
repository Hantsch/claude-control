/**
 * Claude Code's on-disk layout (RESEARCH.md §1–§3).
 *
 * The only place that knows these paths, besides `adapter.ts` which composes them.
 */

import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { ProjectRef } from '../../model/types.ts';

export interface ClaudePaths {
  root: string;
  sessionsDir: string;
  projectsDir: string;
  ideDir: string;
}

/**
 * `~/.claude`, unless overridden. `CLAUDE_CONFIG_DIR` is honoured because Claude Code
 * itself honours it, so a machine that moved its state stays observable.
 */
export function resolveClaudePaths(override?: string | null): ClaudePaths {
  const root = override?.trim()
    ? resolve(override)
    : (process.env.CLAUDE_CONFIG_DIR?.trim()
      ? resolve(process.env.CLAUDE_CONFIG_DIR)
      : join(homedir(), '.claude'));
  return {
    root,
    sessionsDir: join(root, 'sessions'),
    projectsDir: join(root, 'projects'),
    ideDir: join(root, 'ide'),
  };
}

/**
 * Project directory slug for a working directory: separators, the drive colon and dots
 * are replaced by `-` (RESEARCH.md §2, verified for
 * `c:\development\Hantsch\claude-control` → `c--development-Hantsch-claude-control`).
 *
 * Slug casing is inconsistent on disk, so callers must resolve the directory
 * case-insensitively — see `findProjectDir`.
 */
export function slugForCwd(cwd: string): string {
  return cwd.replace(/[\\/:.]/g, '-');
}

/** Lower-cased, forward-slashed, trailing-separator-free path for comparisons (R5). */
export function normalizePathKey(p: string): string {
  const unified = p.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  return unified.toLowerCase();
}

/** True when `child` is `parent` or lives underneath it, case-insensitively. */
export function isPathInside(child: string, parent: string): boolean {
  const c = normalizePathKey(child);
  const p = normalizePathKey(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** Display name + comparison key for a working directory. */
export function projectRefForCwd(cwd: string): ProjectRef {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  const name = basename(trimmed) || trimmed.replace(/[:\\/]/g, '') || trimmed;
  return { path: trimmed, name, key: normalizePathKey(trimmed) };
}

/**
 * Reverse the slug back into a display project name. Lossy by construction (the original
 * separators are gone), so it is only used for history entries whose transcripts do not
 * carry a `cwd`. Records normally do carry `cwd`, which is preferred.
 */
export function projectRefForSlug(slug: string): ProjectRef {
  const parts = slug.split('-').filter((p) => p.length > 0);
  const name = parts.length > 0 ? parts[parts.length - 1]! : slug;
  return { path: slug, name, key: slug.toLowerCase() };
}

export function transcriptFileName(sessionId: string): string {
  return `${sessionId}.jsonl`;
}

/** Path of a session's transcript inside a resolved project directory. */
export function transcriptPath(projectDir: string, sessionId: string): string {
  return join(projectDir, transcriptFileName(sessionId));
}

/** `sessions/<pid>.json` — the registry file name pattern (RESEARCH.md §1). */
export const REGISTRY_FILE_PATTERN = /^(\d+)\.json$/;

/** `ide/<port>.lock` (RESEARCH.md §3). */
export const IDE_LOCK_PATTERN = /^(\d+)\.lock$/;

export function isTranscriptFile(p: string): boolean {
  return p.toLowerCase().endsWith('.jsonl');
}

export function sessionIdFromTranscriptPath(p: string): string {
  const name = p.split(/[\\/]/).pop() ?? p;
  return name.replace(/\.jsonl$/i, '');
}

/** Directory part of a transcript path — the project slug directory. */
export function projectSlugFromTranscriptPath(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts.length >= 2 ? parts[parts.length - 2]! : '';
}
