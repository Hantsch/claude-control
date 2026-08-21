/**
 * `ClaudeAdapter` — the only place that knows Claude Code's file layout and JSONL schema
 * (§3, §9). It emits normalized facts; a future Codex adapter implements the same
 * interface and nothing above this file changes.
 */

import { stat } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { Thresholds } from '../../model/settings.ts';
import type {
  HistoryEntry,
  IdeWindowRef,
  LiveSessionRef,
  ProjectRef,
  SessionDetail,
  SessionId,
  SessionSnapshot,
  TimelineEvent,
  TranscriptTailFacts,
  UsageTotals,
} from '../../model/types.ts';
import type { ProcessProbe } from '../../registry/liveness.ts';
import { isAliveSync, procStartMatches } from '../../registry/liveness.ts';
import { readRegistry, type RegistryEntry } from '../../registry/registry.ts';
import { deriveHistoricalStatus } from '../../state/machine.ts';
import { buildSubagentTree } from '../../state/subagents.ts';
import type { AgentAdapter, WatchRoot } from '../types.ts';
import { readIdeWindows } from './ide.ts';
import { parseJsonlChunk } from './jsonl.ts';
import {
  projectRefForCwd,
  projectRefForSlug,
  projectSlugFromTranscriptPath,
  sessionIdFromTranscriptPath,
  slugForCwd,
  transcriptFileName,
  type ClaudePaths,
} from './paths.ts';
import {
  isAssistantRecord,
  isPromptRecord,
  isSemanticRecord,
  recordText,
  recordTime,
  stopReason,
  toolUseBlocks,
  type TranscriptRecord,
} from './records.ts';
import { cleanPromptText, collectToolCalls, semanticKind, summarizeRecords, usageOf } from './summarize.ts';
import { readHead, readTail, scanRecordsFromEnd } from './tail.ts';

const HISTORY_HEAD_BYTES = 32 * 1024;
const HISTORY_TAIL_BYTES = 64 * 1024;
/**
 * Budget for the one-off backward scan that finds the prompt a run started with. Measured on
 * the real directory: with the 64 KB tail window, 9 of 10 live sessions had their prompt
 * outside it — a single subagent-heavy turn is easily megabytes — so without this the run
 * duration would read "—" almost always.
 */
const RUN_START_SCAN_BYTES = 4 * 1024 * 1024;
const RUN_START_CHUNK_BYTES = 256 * 1024;
/** Upper bound on timeline events returned by `readDetail`, to keep the IPC payload sane. */
const DETAIL_EVENT_LIMIT = 10_000;
/** Directory listing cache TTL — project directories change rarely. */
const PROJECT_DIR_TTL_MS = 10_000;

export interface ClaudeAdapterOptions {
  paths: ClaudePaths;
  tailWindowBytes: number;
  maxTailWindowBytes: number;
  probe: ProcessProbe;
  thresholds: Thresholds;
  now?: () => number;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude-code';

  private readonly options: ClaudeAdapterOptions;
  private readonly now: () => number;
  private projectDirs: { names: string[]; at: number } | null = null;
  /**
   * Run start per session, for runs whose prompt is no longer in the tail window. Written
   * once and then left alone: a *new* prompt always shows up in the tail window while the
   * app is watching, so the scan never has to run twice for the same session. `null` means
   * "scanned, nothing found within budget" — cached too, so a hopeless case stays cheap.
   */
  private readonly runStarts = new Map<SessionId, number | null>();

  constructor(options: ClaudeAdapterOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  get paths(): ClaudePaths {
    return this.options.paths;
  }

  watchRoots(): WatchRoot[] {
    return [
      { kind: 'registry', path: this.paths.sessionsDir, depth: 0 },
      // projects/<slug>/<sessionId>.jsonl — one level of directories below the root.
      { kind: 'transcripts', path: this.paths.projectsDir, depth: 1 },
      { kind: 'ide', path: this.paths.ideDir, depth: 0 },
    ];
  }

  /**
   * Registry entries, minus anything whose PID is dead or belongs to a different process
   * (§4, §12 "Registry staleness on crash").
   */
  async discoverLiveSessions(): Promise<LiveSessionRef[]> {
    const { entries } = await readRegistry(this.paths.sessionsDir);
    if (entries.length === 0) return [];

    const pids = entries.map((entry) => entry.pid);
    const alive = await this.options.probe.alive(pids);
    const candidates = entries.filter((entry) => alive.has(entry.pid));
    if (candidates.length === 0) return [];

    const stamps = await this.options.probe.creationStamps(candidates.map((entry) => entry.pid));
    const fresh = candidates.filter((entry) => procStartMatches(entry.procStart, stamps.get(entry.pid)));

    const refs: LiveSessionRef[] = [];
    for (const entry of fresh) {
      refs.push({
        sessionId: entry.sessionId,
        pid: entry.pid,
        cwd: entry.cwd,
        name: entry.name,
        entrypoint: entry.entrypoint,
        kind: entry.kind,
        agentVersion: entry.version,
        startedAt: entry.startedAt,
        procStart: entry.procStart,
        transcriptPath: await this.resolveTranscriptPath(entry),
        source: entry.file,
        reportedStatus: entry.reportedStatus,
        waitingFor: entry.waitingFor,
        reportedAt: entry.reportedAt,
      });
    }
    return refs;
  }

  /** Tail-read one session (§5.2). Never throws: a failed read becomes `unknown`. */
  async readStatus(ref: LiveSessionRef): Promise<SessionSnapshot> {
    const readAt = this.now();
    const project = projectRefForCwd(ref.cwd);
    const alive = isAliveSync(ref.pid);

    const path = ref.transcriptPath ?? (await this.resolveTranscriptPath(ref));
    if (!path) {
      return {
        sessionId: ref.sessionId,
        ref,
        project,
        alive,
        // Not an error: Claude Code creates the transcript with the first message, so a
        // session that was just opened legitimately has no file yet (→ `starting`).
        facts: emptyFacts('no transcript file yet — this session has not been used', null),
        readAt,
      };
    }

    try {
      const tail = await readTail(path, {
        initialWindowBytes: this.options.tailWindowBytes,
        maxWindowBytes: this.options.maxTailWindowBytes,
        predicate: isSemanticRecord,
      });
      const facts = summarizeRecords(tail.records, {
        now: readAt,
        read: {
          fileSize: tail.fileSize,
          mtimeMs: tail.mtimeMs,
          windowBytes: tail.windowBytes,
          startOffset: tail.startOffset,
          linesParsed: tail.linesParsed,
          linesSkipped: tail.linesSkipped,
          exhausted: tail.exhausted,
          error: null,
        },
      });
      facts.runStartedAt = await this.resolveRunStart(ref.sessionId, path, facts.runStartedAt);
      return { sessionId: ref.sessionId, ref: { ...ref, transcriptPath: path }, project, alive, facts, readAt };
    } catch (error) {
      const message = describe(error);
      return {
        sessionId: ref.sessionId,
        ref: { ...ref, transcriptPath: path },
        project,
        alive,
        facts: emptyFacts(`transcript could not be read: ${message}`, message),
        readAt,
      };
    }
  }

  /**
   * When the tail window contained the prompt, that is the answer (and it refreshes the
   * cache). Otherwise fall back to the cache, scanning backwards once per session to fill it.
   */
  private async resolveRunStart(
    sessionId: SessionId,
    path: string,
    fromTail: number | null,
  ): Promise<number | null> {
    if (fromTail !== null) {
      this.runStarts.set(sessionId, fromTail);
      return fromTail;
    }
    const cached = this.runStarts.get(sessionId);
    if (cached !== undefined) return cached;

    let found: number | null = null;
    try {
      const hit = await scanRecordsFromEnd(path, isPromptRecord, {
        chunkBytes: RUN_START_CHUNK_BYTES,
        maxBytes: RUN_START_SCAN_BYTES,
      });
      found = hit.record ? recordTime(hit.record) : null;
    } catch {
      // Same rule as the tail read: a failed read is a missing fact, not an error.
    }
    this.runStarts.set(sessionId, found);
    return found;
  }

  /** Drop the cached run start of a session that is gone, so the map cannot grow forever. */
  forgetSession(sessionId: SessionId): void {
    this.runStarts.delete(sessionId);
  }

  /**
   * Background history index (§5.1). Cheap per file: one `stat`, a head chunk for the
   * start, a tail chunk for the end. Cancellable, and it yields between files so the live
   * tier keeps priority.
   */
  async *indexHistory(signal: AbortSignal): AsyncIterable<HistoryEntry> {
    let slugs: string[];
    try {
      slugs = await readdir(this.paths.projectsDir);
    } catch {
      return;
    }

    for (const slug of slugs) {
      if (signal.aborted) return;
      const dir = join(this.paths.projectsDir, slug);
      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.jsonl'));
      } catch {
        continue;
      }

      for (const file of files) {
        if (signal.aborted) return;
        const path = join(dir, file);
        const entry = await this.readHistoryEntry(path).catch(() => null);
        if (entry) yield entry;
        // Give the event loop a turn so status reads are never starved by indexing.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  /** One history entry: `stat` + head chunk + tail chunk. No full parse (§5.1). */
  async readHistoryEntry(path: string): Promise<HistoryEntry | null> {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return null;

    const head = await readHead(path, HISTORY_HEAD_BYTES);
    const tail = await readTail(path, {
      initialWindowBytes: HISTORY_TAIL_BYTES,
      maxWindowBytes: Math.max(HISTORY_TAIL_BYTES, this.options.maxTailWindowBytes),
      predicate: isSemanticRecord,
    });

    const facts = summarizeRecords(tail.records, {
      now: this.now(),
      read: {
        fileSize: tail.fileSize,
        mtimeMs: tail.mtimeMs,
        windowBytes: tail.windowBytes,
        startOffset: tail.startOffset,
        linesParsed: tail.linesParsed,
        linesSkipped: tail.linesSkipped,
        exhausted: tail.exhausted,
        error: null,
      },
    });

    const firstSemantic = head.records.find(isSemanticRecord) ?? null;
    const startedAt = firstSemantic ? recordTime(firstSemantic) : null;
    const endedAt = facts.last?.at ?? info.mtimeMs;

    // `aiTitle` is preferred as the label — it saves inventing our own summarizer (§8).
    const title = facts.aiTitle
      ?? headTitle(head.records)
      ?? facts.lastPromptText
      ?? null;

    return {
      sessionId: sessionIdFromTranscriptPath(path),
      transcriptPath: path,
      project: projectForHistory(path, head.records, tail.records),
      branch: facts.branch,
      title,
      model: facts.model ?? headModel(head.records),
      startedAt,
      endedAt,
      finalStatus: deriveHistoricalStatus(facts, this.options.thresholds),
      messageCountEstimate: estimateRecordCount(info.size, head),
      fileSize: info.size,
      mtimeMs: info.mtimeMs,
    };
  }

  /** Full streaming parse of one transcript — only on user request (§5.1 "Detail"). */
  async readDetail(id: SessionId, transcriptPath?: string | null): Promise<SessionDetail> {
    const path = transcriptPath ?? (await this.findTranscriptBySessionId(id));
    if (!path) {
      throw new Error(`no transcript found for session ${id}`);
    }

    const records: TranscriptRecord[] = [];
    const events: TimelineEvent[] = [];
    const branches = new Set<string>();
    const models = new Set<string>();
    const usage: UsageTotals = {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
    };
    let title: string | null = null;
    let startedAt: number | null = null;
    let endedAt: number | null = null;
    let truncated = false;

    const stream = createReadStream(path, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const parsed = parseJsonlChunk(line, { dropFirstPartial: false });
        const record = parsed.records[0];
        if (!record) continue;

        if (typeof record.gitBranch === 'string' && record.gitBranch) branches.add(record.gitBranch);
        if (record.type === 'ai-title') {
          const value = typeof record.title === 'string' ? record.title : null;
          if (value) title = value;
        }
        if (!isSemanticRecord(record)) continue;

        records.push(record);
        const at = recordTime(record);
        if (at !== null) {
          startedAt = startedAt === null ? at : Math.min(startedAt, at);
          endedAt = endedAt === null ? at : Math.max(endedAt, at);
        }
        if (isAssistantRecord(record)) {
          const model = record.message?.model;
          if (typeof model === 'string' && model) models.add(model);
          const recordUsage = usageOf(record);
          if (recordUsage) {
            usage.inputTokens += recordUsage.inputTokens;
            usage.cacheReadTokens += recordUsage.cacheReadTokens;
            usage.cacheCreationTokens += recordUsage.cacheCreationTokens;
            usage.outputTokens += recordUsage.outputTokens;
          }
        }

        if (events.length < DETAIL_EVENT_LIMIT) {
          const tools = toolUseBlocks(record);
          events.push({
            uuid: typeof record.uuid === 'string' ? record.uuid : '',
            at: at ?? 0,
            kind: semanticKind(record),
            tool: tools[0]?.name ?? null,
            text: recordText(record),
            stopReason: isAssistantRecord(record) ? stopReason(record) : null,
          });
        } else {
          truncated = true;
        }
      }
    } finally {
      lines.close();
      stream.close();
    }

    const project = projectForHistory(path, records, records);
    return {
      sessionId: id,
      transcriptPath: path,
      project,
      title,
      branches: [...branches],
      models: [...models],
      startedAt,
      endedAt,
      usage,
      events,
      subagents: buildSubagentTree(collectToolCalls(records), this.now()),
      truncated,
    };
  }

  async listIdeWindows(): Promise<IdeWindowRef[]> {
    return readIdeWindows(this.paths.ideDir);
  }

  /**
   * `projects/<slug>/<sessionId>.jsonl`. The slug is derived from `cwd`, but its casing on
   * disk is inconsistent (RESEARCH.md §2), so the directory is resolved case-insensitively
   * and, failing that, all project directories are probed for the session's file.
   */
  private async resolveTranscriptPath(entry: RegistryEntry | LiveSessionRef): Promise<string | null> {
    const fileName = transcriptFileName(entry.sessionId);
    const wanted = slugForCwd(entry.cwd).toLowerCase();
    const dirs = await this.listProjectDirs();

    const exact = dirs.find((name) => name.toLowerCase() === wanted);
    if (exact) {
      const candidate = join(this.paths.projectsDir, exact, fileName);
      if (await exists(candidate)) return candidate;
    }

    return this.findTranscriptBySessionId(entry.sessionId, dirs);
  }

  private async findTranscriptBySessionId(
    sessionId: SessionId,
    knownDirs?: string[],
  ): Promise<string | null> {
    const dirs = knownDirs ?? (await this.listProjectDirs());
    const fileName = transcriptFileName(sessionId);
    for (const dir of dirs) {
      const candidate = join(this.paths.projectsDir, dir, fileName);
      if (await exists(candidate)) return candidate;
    }
    return null;
  }

  private async listProjectDirs(): Promise<string[]> {
    const now = this.now();
    if (this.projectDirs && now - this.projectDirs.at < PROJECT_DIR_TTL_MS) {
      return this.projectDirs.names;
    }
    try {
      const names = await readdir(this.paths.projectsDir, { withFileTypes: true });
      const dirs = names.filter((e) => e.isDirectory()).map((e) => e.name);
      this.projectDirs = { names: dirs, at: now };
      return dirs;
    } catch {
      this.projectDirs = { names: [], at: now };
      return [];
    }
  }
}

/**
 * Facts for a session whose transcript yielded nothing. `error` is what separates the two
 * reasons that can happen for: null means "there was nothing to read", a message means "the
 * read failed" — and the state machine maps those to `starting` and `unknown` respectively.
 */
function emptyFacts(note: string, error: string | null): TranscriptTailFacts {
  return {
    last: null,
    pendingTool: null,
    pendingTools: [],
    stalledTools: [],
    queuedPrompt: false,
    branch: null,
    model: null,
    usage: null,
    aiTitle: null,
    lastPromptText: null,
    runStartedAt: null,
    lastAssistantText: note,
    subagents: [],
    agentVersion: null,
    read: {
      fileSize: 0,
      mtimeMs: 0,
      windowBytes: 0,
      startOffset: 0,
      linesParsed: 0,
      linesSkipped: 0,
      exhausted: true,
      error,
    },
  };
}

/**
 * `cwd` from any record beats the slug, because the slug is lossy — the original
 * separators are gone (see `projectRefForSlug`).
 */
function projectForHistory(
  path: string,
  head: readonly TranscriptRecord[],
  tail: readonly TranscriptRecord[],
): ProjectRef {
  for (const records of [tail, head]) {
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const cwd = records[i]!.cwd;
      if (typeof cwd === 'string' && cwd) return projectRefForCwd(cwd);
    }
  }
  return projectRefForSlug(projectSlugFromTranscriptPath(path));
}

function headTitle(records: readonly TranscriptRecord[]): string | null {
  for (const record of records) {
    if (record.type === 'ai-title' && typeof record.title === 'string' && record.title.trim()) {
      return record.title.trim();
    }
  }
  for (const record of records) {
    if (record.type !== 'user') continue;
    const text = cleanPromptText(recordText(record));
    if (text) return text.slice(0, 120);
  }
  return null;
}

function headModel(records: readonly TranscriptRecord[]): string | null {
  for (const record of records) {
    const model = record.message?.model;
    if (typeof model === 'string' && model && model !== '<synthetic>') return model;
  }
  return null;
}

/** Records ≈ file size / average record size in the head chunk. Explicitly an estimate. */
function estimateRecordCount(
  fileSize: number,
  head: { records: readonly TranscriptRecord[]; fileSize: number },
): number {
  if (head.records.length === 0) return 0;
  const sampled = Math.min(HISTORY_HEAD_BYTES, head.fileSize);
  if (sampled <= 0) return head.records.length;
  const perRecord = sampled / head.records.length;
  return Math.max(head.records.length, Math.round(fileSize / perRecord));
}

async function exists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
