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

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'unknown';

/**
 * A subagent invocation (§8). Derived from `Agent` tool_use blocks in the parent
 * transcript: label + start from the call, completion from the paired result. The
 * subagent's *inner* timeline is not available (see RESEARCH.md §2, `isSidechain`).
 */
export interface SubagentNode {
  id: string;
  label: string;
  agentType: string | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  status: SubagentStatus;
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
    linesParsed: number;
    linesSkipped: number;
    /** No semantic record was found even at the maximum window (§5.2). */
    exhausted: boolean;
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
  /** When the session entered `status`. */
  statusSince: number;
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
