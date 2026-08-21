/**
 * Agent-neutral domain types. Nothing in here knows about Claude Code's file layout —
 * that lives behind the adapter boundary (§9).
 */

import type { SessionStatus } from './status.ts';

export type { SessionStatus };

export type SessionId = string;

/** Git project a session runs in. Derived from `cwd`; no git process is invoked (§4). */
export interface ProjectRef {
  /** Absolute working directory as reported by the agent. */
  path: string;
  /** Display name — last meaningful path segment. */
  name: string;
  /** Lower-cased, separator-normalized `path`, for case-insensitive matching (§5, R5). */
  key: string;
}

/** A session the agent's own registry claims is alive right now. */
export interface LiveSessionRef {
  sessionId: SessionId;
  pid: number;
  cwd: string;
  /** Human-readable label supplied by the agent (`name`/`nameSource` in the registry). */
  name: string;
  entrypoint: string;
  kind: string;
  agentVersion: string;
  startedAt: number;
  /** Platform process-creation stamp, used to detect PID reuse. */
  procStart: string | null;
  /** Resolved transcript file, or null if none could be located. */
  transcriptPath: string | null;
  /** File the ref was read from, for diagnostics. */
  source: string;
  /**
   * Optional, agent-reported facts from the registry. Absent on all Claude Code versions
   * observed so far (RESEARCH.md §1) — kept for forward compatibility only.
   */
  reportedStatus: string | null;
  waitingFor: string | null;
  reportedAt: number | null;
}

export interface UsageTotals {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

export type ContextBand = 'green' | 'yellow' | 'red' | 'critical';

/**
 * Context-pressure estimate (§6.4). `window` is a lookup-table guess, so every value
 * here is explicitly an estimate — the UI labels it as one.
 */
export interface ContextPressure {
  used: number;
  window: number;
  ratio: number;
  band: ContextBand;
  /** True when the assumed window was widened because observed usage exceeded it. */
  widened: boolean;
  model: string | null;
}

/** A tool call that has been issued but has no paired result yet. */
export interface PendingTool {
  name: string;
  /** `tool_use` block id, when the record carried one. */
  toolUseId: string | null;
  /** UUID of the record that issued the call. */
  issuedBy: string;
  issuedAt: number;
  /** Short human-readable hint from the tool input (file path, command, …). */
  hint: string | null;
}

/**
 * `launched` is the background case (`run_in_background`): the tool call returns within
 * seconds with `status: "async_launched"` while the subagent keeps working. Calling that
 * "completed" would report a two-second run for an agent that runs for an hour, so it gets
 * its own state — and no end time, because the parent transcript never sees it finish.
 */
export type SubagentStatus = 'running' | 'launched' | 'completed' | 'failed' | 'unknown';

/**
 * What a subagent's own tool result reports about its run. Measured on this Claude Code
 * version (2.1.222): an `Agent` result carries `agentId`, `agentType`, `resolvedModel`,
 * `totalDurationMs`, `totalTokens`, `totalToolUseCount`, `usage` and `toolStats`.
 *
 * All of it arrives with the *result*, so a still-running subagent has none of it — that is
 * the honest ceiling here, not an omission. `totalDurationMs` was checked against the record
 * timestamps and agrees to within a few seconds, so the two never contradict each other.
 *
 * **Privacy (§4):** the result also carries the subagent's full `prompt` and `content`.
 * Neither is read here; only these numbers are.
 */
export interface SubagentRunResult {
  status: string | null;
  agentId: string | null;
  agentType: string | null;
  /** `resolvedModel` — unlike `message.model` this one carries the `[1m]` suffix. */
  model: string | null;
  durationMs: number | null;
  /** Everything the run spent, cumulative over all its turns — not its context size. */
  totalTokens: number | null;
  toolUses: number | null;
  /** Usage of the subagent's final turn, i.e. how full its context was when it finished. */
  usage: UsageTotals | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  /**
   * A run that died gets a plain string result instead of the object above, e.g.
   * "Error: Agent terminated early due to an API error: 529 Overloaded". Clipped, because it
   * is the one case where the *reason* is the only thing the result has to offer.
   */
  errorText: string | null;
}

/** Per-run numbers of a *finished* subagent, ready for display. */
export interface SubagentMetrics {
  model: string | null;
  totalTokens: number | null;
  toolUses: number | null;
  /** Final context of the run, estimated with the same rule as a session's (§6.4). */
  context: ContextPressure | null;
  linesAdded: number | null;
  linesRemoved: number | null;
}

/**
 * A subagent invocation (§8). Derived from `Agent` tool_use blocks in the parent
 * transcript: label + start from the call, completion and metrics from the paired result.
 * The subagent's *inner* timeline is not available (see RESEARCH.md §2, `isSidechain`).
 */
export interface SubagentNode {
  id: string;
  label: string;
  agentType: string | null;
  /** Claude Code's own id for the run, from the result. */
  agentId: string | null;
  startedAt: number;
  /** Null while running and for `launched` runs, whose end is never observable. */
  endedAt: number | null;
  durationMs: number | null;
  status: SubagentStatus;
  /** Null while the subagent runs; the numbers only exist once it has finished. */
  metrics: SubagentMetrics | null;
  /** Why the run failed, when the result said so. */
  errorText: string | null;
  children: SubagentNode[];
}

export type SemanticRecordKind = 'prompt' | 'tool-result' | 'assistant';

/**
 * A tool invocation, normalized away from any agent's record format. The adapter produces
 * these; `state/subagents.ts` turns the subagent ones into a tree, so the tree builder
 * stays agent-neutral.
 */
export interface ToolCallEvent {
  /** `tool_use` id when available, otherwise a synthetic `<uuid>#<index>`. */
  id: string;
  name: string;
  /** UUID of the record that issued the call. */
  issuedBy: string;
  issuedAt: number;
  /** Short label from the tool input. */
  label: string | null;
  /** True when this tool is the agent's subagent-spawning tool (`Agent`). */
  isSubagent: boolean;
  agentType: string | null;
  endedAt: number | null;
  errored: boolean;
  /** Filled from the paired result for subagent calls only (see `SubagentRunResult`). */
  runResult: SubagentRunResult | null;
}

/**
 * One *run* of a session: a prompt and the turn it triggered. `endedAt` is null while the
 * turn is still going, so the UI can tick it. Null on the view when the transcript window
 * holds no prompt — a long turn can push its own prompt out of the tail (§5.2).
 */
export interface SessionRun {
  startedAt: number;
  endedAt: number | null;
}

/**
 * Normalized facts read from one session's transcript tail. This is the *input* to the
 * state machine; it contains no derived status on purpose, so the machine stays a pure
 * function of facts + clock (§3, §10).
 */
export interface TranscriptTailFacts {
  /** Newest semantic record (`user`/`assistant`), bookkeeping types filtered out (§5.2). */
  last: {
    kind: SemanticRecordKind;
    at: number;
    /** Present on assistant records. */
    stopReason: string | null;
    uuid: string;
  } | null;
  /**
   * Set when the newest *semantic* record is an assistant record that issued a tool call
   * with no paired result yet — exactly the condition §6.2 escalates to `waiting`.
   */
  pendingTool: PendingTool | null;
  /**
   * All unpaired calls of that record. A single assistant record can issue several tools
   * in parallel; the machine then uses the most permissive threshold of the set (§6.3).
   */
  pendingTools: PendingTool[];
  /**
   * Unpaired calls of *older* assistant records — used for the "current tool" display when
   * a partial result has already come back. Not part of the status rule.
   */
  stalledTools: PendingTool[];
  /** An `enqueue` was seen without a matching `dequeue` (§6.2). */
  queuedPrompt: boolean;
  /** Newest observed git branch. */
  branch: string | null;
  model: string | null;
  usage: UsageTotals | null;
  /** Generated session title (`ai-title` record), when present (§8). */
  aiTitle: string | null;
  /** Newest human prompt text, trimmed. Used as a fallback label. */
  lastPromptText: string | null;
  /** Time of that prompt — the start of the current or most recent run. */
  runStartedAt: number | null;
  /** Last assistant sentence, used in the `done` toast body (§6.6). */
  lastAssistantText: string | null;
  subagents: SubagentNode[];
  /** Agent version recorded on the newest record — makes schema drift detectable (§12). */
  agentVersion: string | null;
  /** Diagnostics from the tail read. */
  read: {
    fileSize: number;
    mtimeMs: number;
    windowBytes: number;
    /**
     * Byte offset the window started at. 0 means the window covered the whole file, so
     * "no semantic record" is a fact about the transcript rather than about the window —
     * which is what separates a session that has never been used from an unreadable one.
     */
    startOffset: number;
    linesParsed: number;
    linesSkipped: number;
    /** No semantic record was found even at the maximum window (§5.2). */
    exhausted: boolean;
    /** Why the transcript could not be read at all, or null when the read succeeded. */
    error: string | null;
  };
}

/**
 * Agent-neutral snapshot of one live session: registry facts + transcript facts.
 * Status is *not* part of it — `deriveStatus` produces that (§6.2).
 */
export interface SessionSnapshot {
  sessionId: SessionId;
  ref: LiveSessionRef;
  project: ProjectRef;
  alive: boolean;
  facts: TranscriptTailFacts;
  /** When this snapshot was taken. */
  readAt: number;
}

/** A session as presented to the UI and the tray. Fully derived; renderer does no work. */
export interface SessionView {
  sessionId: SessionId;
  name: string;
  title: string | null;
  status: SessionStatus;
  /** Why the machine chose this status — shown in the detail pane, useful when debugging. */
  statusReason: string;
  /** Where `status` came from: the agent's own registry report, or our own inference (§1). */
  statusSource: 'reported' | 'inferred';
  /** When the session entered `status`. */
  statusSince: number;
  /**
   * True when the user has acknowledged the session *in its current status* — clicked it,
   * jumped to it, or used "mark all as seen". A seen session no longer counts towards the
   * tray badge, and the next real status change re-arms it, so the badge only ever comes
   * back for something that actually happened since.
   */
  seen: boolean;
  project: ProjectRef;
  branch: string | null;
  /** Worktree/branch grouping key (§10 of requirements, F10). */
  groupKey: string;
  model: string | null;
  entrypoint: string;
  pid: number;
  alive: boolean;
  startedAt: number;
  lastActivityAt: number | null;
  /** Current or most recent run — how long this prompt has been / was worked on. */
  run: SessionRun | null;
  pendingTool: PendingTool | null;
  context: ContextPressure | null;
  subagents: SubagentNode[];
  lastAssistantText: string | null;
  transcriptPath: string | null;
  cwd: string;
  agentVersion: string | null;
}

/** One entry of the lazily built history index (§5.1 "History index"). */
export interface HistoryEntry {
  sessionId: SessionId;
  transcriptPath: string;
  project: ProjectRef;
  branch: string | null;
  title: string | null;
  model: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Status the transcript ended in, as far as the tail allows. */
  finalStatus: SessionStatus;
  messageCountEstimate: number;
  fileSize: number;
  mtimeMs: number;
}

export interface HistoryQuery {
  /** Match against `ProjectRef.key` (F8). */
  projectKey?: string | null;
  /** Free-text over title/name (§8). */
  search?: string | null;
  from?: number | null;
  to?: number | null;
  limit?: number;
  offset?: number;
}

export interface TimelineEvent {
  uuid: string;
  at: number;
  kind: SemanticRecordKind;
  /** Tool name for tool calls/results. */
  tool: string | null;
  text: string | null;
  stopReason: string | null;
}

/** Result of a full parse of one transcript — only done on user request (§5.1 "Detail"). */
export interface SessionDetail {
  sessionId: SessionId;
  transcriptPath: string;
  project: ProjectRef;
  title: string | null;
  branches: string[];
  models: string[];
  startedAt: number | null;
  endedAt: number | null;
  usage: UsageTotals;
  events: TimelineEvent[];
  subagents: SubagentNode[];
  truncated: boolean;
}

/** Mapping from a workspace folder to an IDE window (§7). Never carries `authToken`. */
export interface IdeWindowRef {
  pid: number;
  ideName: string;
  workspaceFolders: string[];
  /** Lock file the entry came from. */
  source: string;
}

export interface StatusTransition {
  sessionId: SessionId;
  from: SessionStatus | null;
  to: SessionStatus;
  at: number;
  /** True for the initial derivation after start — notifications stay silent (§6.6). */
  seeded: boolean;
  view: SessionView;
}
