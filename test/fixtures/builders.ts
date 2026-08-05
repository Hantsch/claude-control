/**
 * Fixture builders (§10).
 *
 * The records are hand-written to the shapes documented in RESEARCH.md rather than copied
 * from real transcripts: the same nasty cases, none of the private prompt text. Anything
 * copied from a real session would carry conversation content into the repository, which is
 * exactly what §4 says must not leave the process.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { epochMsToFileTime } from '../../src/core/registry/liveness.ts';

export const T0 = Date.UTC(2026, 7, 5, 10, 0, 0);

export function iso(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

export interface AssistantOptions {
  uuid: string;
  at: number;
  stopReason?: string | null;
  model?: string;
  text?: string;
  tools?: { id: string; name: string; input?: Record<string, unknown> }[];
  usage?: { input?: number; cacheRead?: number; cacheCreation?: number; output?: number };
  branch?: string;
  cwd?: string;
  version?: string;
}

export function assistant(options: AssistantOptions): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  if (options.text) content.push({ type: 'text', text: options.text });
  for (const tool of options.tools ?? []) {
    content.push({ type: 'tool_use', id: tool.id, name: tool.name, input: tool.input ?? {} });
  }
  return {
    type: 'assistant',
    uuid: options.uuid,
    parentUuid: null,
    sessionId: 'fixture-session',
    timestamp: iso(options.at),
    cwd: options.cwd ?? 'c:\\development\\Hantsch\\claude-control',
    gitBranch: options.branch ?? 'main',
    version: options.version ?? '2.1.222',
    entrypoint: 'claude-vscode',
    isSidechain: false,
    userType: 'external',
    requestId: `req_${options.uuid}`,
    message: {
      role: 'assistant',
      model: options.model ?? 'claude-opus-5',
      stop_reason: options.stopReason === undefined ? 'tool_use' : options.stopReason,
      content,
      usage: {
        input_tokens: options.usage?.input ?? 2,
        cache_creation_input_tokens: options.usage?.cacheCreation ?? 10_135,
        cache_read_input_tokens: options.usage?.cacheRead ?? 22_753,
        output_tokens: options.usage?.output ?? 268,
        service_tier: 'standard',
      },
    },
  };
}

export function prompt(uuid: string, at: number, text = 'do the thing'): Record<string, unknown> {
  return {
    type: 'user',
    uuid,
    parentUuid: null,
    sessionId: 'fixture-session',
    timestamp: iso(at),
    cwd: 'c:\\development\\Hantsch\\claude-control',
    gitBranch: 'main',
    version: '2.1.222',
    entrypoint: 'claude-vscode',
    isSidechain: false,
    userType: 'external',
    message: { role: 'user', content: [{ type: 'text', text }] },
  };
}

/** Tool result: a `user` record with `toolUseResult` + `sourceToolAssistantUUID`. */
export function toolResult(
  uuid: string,
  at: number,
  options: { assistantUuid: string; toolUseId: string; isError?: boolean },
): Record<string, unknown> {
  return {
    type: 'user',
    uuid,
    parentUuid: options.assistantUuid,
    sessionId: 'fixture-session',
    timestamp: iso(at),
    cwd: 'c:\\development\\Hantsch\\claude-control',
    gitBranch: 'main',
    version: '2.1.222',
    entrypoint: 'claude-vscode',
    isSidechain: false,
    userType: 'external',
    sourceToolAssistantUUID: options.assistantUuid,
    toolUseResult: { ok: !options.isError },
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: options.toolUseId,
          is_error: options.isError ?? false,
          content: 'result',
        },
      ],
    },
  };
}

/**
 * Result of a finished subagent: an ordinary tool result whose `toolUseResult` carries the
 * run's own numbers. Shape measured on Claude Code 2.1.222 — including the `prompt` and
 * `content` fields that must never be retained (§4), so the privacy test has something real
 * to check against.
 */
export function agentResult(
  uuid: string,
  at: number,
  options: {
    assistantUuid: string;
    toolUseId: string;
    status?: string;
    agentId?: string;
    agentType?: string;
    model?: string;
    durationMs?: number;
    totalTokens?: number;
    toolUses?: number;
    usage?: { input?: number; cacheRead?: number; cacheCreation?: number; output?: number };
    linesAdded?: number;
    linesRemoved?: number;
  },
): Record<string, unknown> {
  const record = toolResult(uuid, at, {
    assistantUuid: options.assistantUuid,
    toolUseId: options.toolUseId,
    isError: options.status === 'failed',
  });
  record.toolUseResult = {
    status: options.status ?? 'completed',
    prompt: 'PRIVATE PROMPT — must not be retained',
    agentId: options.agentId ?? 'agent-1',
    agentType: options.agentType ?? 'general-purpose',
    content: [{ type: 'text', text: 'PRIVATE OUTPUT — must not be retained' }],
    resolvedModel: options.model ?? 'claude-opus-5[1m]',
    totalDurationMs: options.durationMs ?? 900_106,
    totalTokens: options.totalTokens ?? 67_430,
    totalToolUseCount: options.toolUses ?? 10,
    usage: {
      input_tokens: options.usage?.input ?? 2,
      cache_creation_input_tokens: options.usage?.cacheCreation ?? 318,
      cache_read_input_tokens: options.usage?.cacheRead ?? 64_400,
      output_tokens: options.usage?.output ?? 2_710,
      service_tier: 'standard',
      iterations: [{ input_tokens: 2, output_tokens: 2_710 }],
    },
    toolStats: {
      readCount: 6,
      searchCount: 0,
      bashCount: 2,
      editFileCount: 1,
      linesAdded: options.linesAdded ?? 122,
      linesRemoved: options.linesRemoved ?? 26,
      otherToolCount: 0,
    },
  };
  return record;
}

/**
 * Result of a subagent started with `run_in_background`: it comes back within seconds and
 * says only that the run was launched — no duration, no tokens.
 */
export function agentLaunchedResult(
  uuid: string,
  at: number,
  options: { assistantUuid: string; toolUseId: string; agentId?: string; model?: string },
): Record<string, unknown> {
  const record = toolResult(uuid, at, {
    assistantUuid: options.assistantUuid,
    toolUseId: options.toolUseId,
  });
  record.toolUseResult = {
    isAsync: true,
    status: 'async_launched',
    agentId: options.agentId ?? 'agent-bg',
    description: 'background work',
    resolvedModel: options.model ?? 'claude-opus-5[1m]',
    prompt: 'PRIVATE PROMPT — must not be retained',
    outputFile: 'C:\\temp\\agent-bg.jsonl',
    canReadOutputFile: true,
  };
  return record;
}

/** A run that died: the result is a plain string, not the metrics object. */
export function agentErrorResult(
  uuid: string,
  at: number,
  options: { assistantUuid: string; toolUseId: string; text?: string },
): Record<string, unknown> {
  const record = toolResult(uuid, at, {
    assistantUuid: options.assistantUuid,
    toolUseId: options.toolUseId,
    isError: true,
  });
  record.toolUseResult =
    options.text ?? 'Error: Agent terminated early due to an API error: API Error: 529 Overloaded.';
  return record;
}

/** Bookkeeping tail — the last line of 237 of 290 real files (RESEARCH.md §2). */
export function lastPrompt(leafUuid: string): Record<string, unknown> {
  return { type: 'last-prompt', leafUuid, timestamp: iso(0) };
}

export function aiTitle(title: string, at = 0): Record<string, unknown> {
  return { type: 'ai-title', title, timestamp: iso(at) };
}

/**
 * `queue-operation` record. `remove` is a withdrawn queued prompt — measured 218 times
 * across the real transcripts, alongside 997 `enqueue` and 775 `dequeue`.
 */
export function queueOperation(
  operation: 'enqueue' | 'dequeue' | 'remove' | string,
  at = 0,
): Record<string, unknown> {
  return { type: 'queue-operation', operation, timestamp: iso(at) };
}

export function fileHistorySnapshot(at = 0): Record<string, unknown> {
  return { type: 'file-history-snapshot', snapshot: { files: [] }, timestamp: iso(at) };
}

export function syntheticAssistant(uuid: string, at: number): Record<string, unknown> {
  const record = assistant({ uuid, at, stopReason: null }) as Record<string, unknown>;
  (record.message as Record<string, unknown>).model = '<synthetic>';
  return record;
}

export function toJsonl(records: readonly Record<string, unknown>[]): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

/** JSONL whose final line is cut off mid-write — the torn-write case (§5.2). */
export function toJsonlWithTornTail(records: readonly Record<string, unknown>[]): string {
  const complete = toJsonl(records);
  return `${complete}{"type":"assistant","uuid":"torn","message":{"stop_re`;
}

export interface FixtureTree {
  root: string;
  sessionsDir: string;
  projectsDir: string;
  ideDir: string;
  /** Write a transcript and return its absolute path. */
  writeTranscript(slug: string, sessionId: string, content: string): Promise<string>;
  writeRegistry(pid: number, entry: Record<string, unknown>): Promise<string>;
  writeIdeLock(port: number, entry: Record<string, unknown>): Promise<string>;
}

/**
 * Every tree handed out by `makeFixtureTree`, so `test/setup.ts` can delete them after each
 * file. The cold-start tree alone is ~250 MB — leaking one per run fills a disk quickly.
 */
const createdTrees: string[] = [];

/** Delete every fixture tree created by this process. Called from the vitest setup file. */
export async function cleanupFixtureTrees(): Promise<void> {
  const trees = createdTrees.splice(0, createdTrees.length);
  await Promise.all(trees.map((root) => rm(root, { recursive: true, force: true }).catch(() => {})));
}

/** A throwaway `~/.claude`-shaped directory tree. */
export async function makeFixtureTree(prefix = 'cc-fixture-'): Promise<FixtureTree> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  createdTrees.push(root);
  const sessionsDir = join(root, 'sessions');
  const projectsDir = join(root, 'projects');
  const ideDir = join(root, 'ide');
  await Promise.all([
    mkdir(sessionsDir, { recursive: true }),
    mkdir(projectsDir, { recursive: true }),
    mkdir(ideDir, { recursive: true }),
  ]);

  return {
    root,
    sessionsDir,
    projectsDir,
    ideDir,
    async writeTranscript(slug, sessionId, content) {
      const dir = join(projectsDir, slug);
      await mkdir(dir, { recursive: true });
      const path = join(dir, `${sessionId}.jsonl`);
      await writeFile(path, content, 'utf8');
      return path;
    },
    async writeRegistry(pid, entry) {
      const path = join(sessionsDir, `${pid}.json`);
      await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
      return path;
    },
    async writeIdeLock(port, entry) {
      const path = join(ideDir, `${port}.lock`);
      await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
      return path;
    },
  };
}

/** Registry entry in the shape of RESEARCH.md §1. */
export function registryEntry(options: {
  pid: number;
  sessionId: string;
  cwd?: string;
  name?: string;
  startedAt?: number;
  procStartMs?: number;
}): Record<string, unknown> {
  return {
    pid: options.pid,
    sessionId: options.sessionId,
    cwd: options.cwd ?? 'c:\\development\\Hantsch\\claude-control',
    startedAt: options.startedAt ?? T0 - 60_000,
    procStart: epochMsToFileTime(options.procStartMs ?? T0 - 60_000),
    version: '2.1.222',
    peerProtocol: 1,
    kind: 'interactive',
    entrypoint: 'claude-vscode',
    name: options.name ?? `claude-control-${options.pid}`,
    nameSource: 'derived',
  };
}

/** IDE lock in the shape of RESEARCH.md §3, including the `authToken` that must not leak. */
export function ideLock(options: {
  pid: number;
  folders: string[];
  ideName?: string;
}): Record<string, unknown> {
  return {
    pid: options.pid,
    workspaceFolders: options.folders,
    ideName: options.ideName ?? 'Visual Studio Code',
    transport: 'ws',
    runningInWindows: true,
    authToken: 'fixture-secret-must-not-leak',
  };
}
