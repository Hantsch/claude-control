/**
 * Records → normalized facts (§5.2, §6.2).
 *
 * This is where Claude Code's JSONL semantics are translated once and for all: which
 * records count as content, how a tool result points back at its call, where usage and
 * branch live. Downstream code sees only `TranscriptTailFacts`.
 */

import type {
  PendingTool,
  SemanticRecordKind,
  SubagentRunResult,
  ToolCallEvent,
  TranscriptTailFacts,
  UsageTotals,
} from '../../model/types.ts';
import { buildSubagentTree } from '../../state/subagents.ts';
import { findLast } from './tail.ts';
import {
  SUBAGENT_TOOL_NAMES,
  agentTypeOf,
  aiTitleOf,
  isAssistantRecord,
  isPromptRecord,
  isSemanticRecord,
  isToolResultRecord,
  modelOf,
  recordText,
  recordTime,
  resultIsError,
  resultToolUseIds,
  stopReason,
  toolInputHint,
  toolUseBlocks,
  type TranscriptRecord,
} from './records.ts';

const MAX_TEXT_CHARS = 400;

export interface SummarizeOptions {
  /** Clock, used for durations of still-running subagents. */
  now: number;
  read: TranscriptTailFacts['read'];
}

export function summarizeRecords(
  records: readonly TranscriptRecord[],
  options: SummarizeOptions,
): TranscriptTailFacts {
  const toolCalls = collectToolCalls(records);
  const lastSemantic = findLast(records, isSemanticRecord);
  const lastAssistant = findLast(records, isAssistantRecord);
  const lastPrompt = findLast(records, isPromptRecord);
  const lastTitleRecord = findLast(records, (r) => r.type === 'ai-title');

  const pendingTools = lastSemantic && isAssistantRecord(lastSemantic)
    ? unpairedFor(lastSemantic, toolCalls)
    : [];
  const stalledTools = toolCalls
    .filter((call) => call.endedAt === null && !pendingTools.some((p) => p.toolUseId === call.id))
    .map(toPendingTool);

  return {
    last: lastSemantic ? describeLast(lastSemantic) : null,
    pendingTool: pendingTools[0] ?? null,
    pendingTools,
    stalledTools,
    queuedPrompt: hasPendingQueueEntry(records),
    branch: newestField(records, (r) => (typeof r.gitBranch === 'string' && r.gitBranch ? r.gitBranch : null)),
    model: lastAssistant ? modelOf(lastAssistant) : null,
    usage: lastAssistant ? usageOf(lastAssistant) : null,
    aiTitle: lastTitleRecord ? aiTitleOf(lastTitleRecord) : null,
    lastPromptText: lastPrompt ? clip(cleanPromptText(recordText(lastPrompt))) : null,
    runStartedAt: lastPrompt ? recordTime(lastPrompt) : null,
    lastAssistantText: clip(newestAssistantText(records)),
    subagents: buildSubagentTree(toolCalls, options.now),
    agentVersion: newestField(records, (r) => (typeof r.version === 'string' && r.version ? r.version : null)),
    read: options.read,
  };
}

function describeLast(record: TranscriptRecord): NonNullable<TranscriptTailFacts['last']> {
  return {
    kind: semanticKind(record),
    at: recordTime(record) ?? 0,
    stopReason: isAssistantRecord(record) ? stopReason(record) : null,
    uuid: typeof record.uuid === 'string' ? record.uuid : '',
  };
}

export function semanticKind(record: TranscriptRecord): SemanticRecordKind {
  if (isAssistantRecord(record)) return 'assistant';
  return isToolResultRecord(record) ? 'tool-result' : 'prompt';
}

/**
 * Normalize every tool call in the window and pair it with its result.
 *
 * Pairing prefers `tool_use_id` (exact, survives parallel calls) and falls back to
 * `sourceToolAssistantUUID`, which points at the issuing assistant *record* — enough when
 * that record issued a single call (RESEARCH.md §2).
 */
export function collectToolCalls(records: readonly TranscriptRecord[]): ToolCallEvent[] {
  const resultsByToolUseId = new Map<string, TranscriptRecord>();
  const resultsByAssistantUuid = new Map<string, TranscriptRecord[]>();

  for (const record of records) {
    if (!isToolResultRecord(record)) continue;
    for (const id of resultToolUseIds(record)) {
      if (!resultsByToolUseId.has(id)) resultsByToolUseId.set(id, record);
    }
    const source = record.sourceToolAssistantUUID;
    if (typeof source === 'string' && source) {
      const bucket = resultsByAssistantUuid.get(source);
      if (bucket) bucket.push(record);
      else resultsByAssistantUuid.set(source, [record]);
    }
  }

  interface PendingBlock {
    call: ToolCallEvent;
    uuid: string;
    matchedById: boolean;
  }

  const blocks: PendingBlock[] = [];
  for (const record of records) {
    if (!isAssistantRecord(record)) continue;
    const issuedAt = recordTime(record);
    if (issuedAt === null) continue;
    const uuid = typeof record.uuid === 'string' ? record.uuid : '';

    toolUseBlocks(record).forEach((block, index) => {
      blocks.push({
        uuid,
        matchedById: false,
        call: {
          id: block.id ?? `${uuid}#${index}`,
          name: block.name,
          issuedBy: uuid,
          issuedAt,
          label: toolInputHint(block.input),
          isSubagent: SUBAGENT_TOOL_NAMES.has(block.name),
          agentType: agentTypeOf(block.input),
          endedAt: null,
          errored: false,
          runResult: null,
        },
      });
    });
  }

  // Pass 1: exact `tool_use_id` matches. A result consumed here cannot be reused below,
  // otherwise a single answered call would silently "complete" its parallel siblings.
  const consumed = new Set<TranscriptRecord>();
  for (const block of blocks) {
    const result = resultsByToolUseId.get(block.call.id);
    if (!result) continue;
    consumed.add(result);
    block.matchedById = true;
    finishCall(block.call, result);
  }

  // Pass 2: fall back to `sourceToolAssistantUUID`, which identifies the issuing assistant
  // *record* rather than the individual call — enough when that record issued one call.
  const cursor = new Map<string, number>();
  for (const block of blocks) {
    if (block.matchedById) continue;
    const bucket = resultsByAssistantUuid.get(block.uuid) ?? [];
    let index = cursor.get(block.uuid) ?? 0;
    while (index < bucket.length && consumed.has(bucket[index]!)) index += 1;
    cursor.set(block.uuid, index + 1);
    const result = bucket[index];
    if (!result) continue;
    consumed.add(result);
    finishCall(block.call, result);
  }

  return blocks.map((block) => block.call);
}

function finishCall(call: ToolCallEvent, result: TranscriptRecord): void {
  call.endedAt = recordTime(result);
  call.errored = resultIsError(result);
  if (call.isSubagent) call.runResult = subagentRunResultOf(result);
}

/**
 * Numbers a finished subagent reports about itself (see `SubagentRunResult`). Returns null
 * for ordinary tool results, which carry none of these fields — the presence of `agentId`,
 * `totalDurationMs` or `totalTokens` is what identifies an agent result.
 *
 * Field-by-field by design: the same object also holds the subagent's prompt and full
 * output, and §4 says neither may be retained.
 */
export function subagentRunResultOf(record: TranscriptRecord): SubagentRunResult | null {
  const raw = record.toolUseResult;
  // A run that died reports a plain string instead of the object; the reason is all there is.
  if (typeof raw === 'string' && raw.trim()) {
    return { ...EMPTY_RUN_RESULT, status: 'failed', errorText: clipError(raw) };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = raw as Record<string, unknown>;
  const identifying =
    typeof result.agentId === 'string' ||
    typeof result.totalDurationMs === 'number' ||
    typeof result.totalTokens === 'number';
  if (!identifying) return null;

  const stats = (result.toolStats && typeof result.toolStats === 'object'
    ? result.toolStats
    : {}) as Record<string, unknown>;

  return {
    status: stringOrNull(result.status),
    agentId: stringOrNull(result.agentId),
    agentType: stringOrNull(result.agentType),
    model: stringOrNull(result.resolvedModel),
    durationMs: numberOrNull(result.totalDurationMs),
    totalTokens: numberOrNull(result.totalTokens),
    toolUses: numberOrNull(result.totalToolUseCount),
    usage: agentUsageOf(result.usage),
    linesAdded: numberOrNull(stats.linesAdded),
    linesRemoved: numberOrNull(stats.linesRemoved),
    errorText: null,
  };
}

const EMPTY_RUN_RESULT: SubagentRunResult = {
  status: null,
  agentId: null,
  agentType: null,
  model: null,
  durationMs: null,
  totalTokens: null,
  toolUses: null,
  usage: null,
  linesAdded: null,
  linesRemoved: null,
  errorText: null,
};

/** One line, short enough for a tree row. */
function clipError(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 159)}…` : oneLine;
}

/**
 * The `usage` block of an agent result uses the same field names as `message.usage`, plus
 * extras (`iterations`, `server_tool_use`, …) that are deliberately ignored.
 */
function agentUsageOf(raw: unknown): UsageTotals | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const usage = raw as Record<string, unknown>;
  return {
    inputTokens: numberOr(usage.input_tokens, 0),
    cacheReadTokens: numberOr(usage.cache_read_input_tokens, 0),
    cacheCreationTokens: numberOr(usage.cache_creation_input_tokens, 0),
    outputTokens: numberOr(usage.output_tokens, 0),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unpairedFor(record: TranscriptRecord, calls: readonly ToolCallEvent[]): PendingTool[] {
  const uuid = typeof record.uuid === 'string' ? record.uuid : '';
  return calls
    .filter((call) => call.issuedBy === uuid && call.endedAt === null)
    .map(toPendingTool);
}

function toPendingTool(call: ToolCallEvent): PendingTool {
  return {
    name: call.name,
    toolUseId: call.id,
    issuedBy: call.issuedBy,
    issuedAt: call.issuedAt,
    hint: call.label,
  };
}

/**
 * `enqueue` seen with no matching dequeue (§6.2) — i.e. **the newest `queue-operation` in
 * the tail window is an `enqueue`**.
 *
 * The concept names only `enqueue`/`dequeue`, but a census over all 290 real transcripts
 * found a third value: `enqueue` 997, `dequeue` 775, **`remove` 218** — a queued prompt the
 * user withdrew. Counting `remove` as "still queued" pinned real sessions to `queued`
 * permanently, and `queued` is deliberately invisible to the tray, the badge and the toasts,
 * so those sessions could never announce that they had finished.
 *
 * Hence: anything that is not an `enqueue` clears, including operations this version has
 * never seen. The format is internal to Claude Code and can gain values again; a false
 * `queued` silences the app, a missed one costs a single toast, so the rule is deliberately
 * biased towards "not queued".
 *
 * The trade-off: `enqueue A, enqueue B, dequeue A` reports "not queued" even though B is
 * still pending. At that instant A has just started, so the session derives as `working`
 * anyway and `queued` would have been suppressed regardless (§6.2 ordering in `machine.ts`).
 */
export function hasPendingQueueEntry(records: readonly TranscriptRecord[]): boolean {
  let newestIsEnqueue = false;
  for (const record of records) {
    if (record.type !== 'queue-operation') continue;
    newestIsEnqueue = record.operation === 'enqueue';
  }
  return newestIsEnqueue;
}

export function usageOf(record: TranscriptRecord): UsageTotals | null {
  const usage = record.message?.usage;
  if (!usage || typeof usage !== 'object') return null;
  return {
    inputTokens: numberOr(usage.input_tokens, 0),
    cacheReadTokens: numberOr(usage.cache_read_input_tokens, 0),
    cacheCreationTokens: numberOr(usage.cache_creation_input_tokens, 0),
    outputTokens: numberOr(usage.output_tokens, 0),
  };
}

function newestAssistantText(records: readonly TranscriptRecord[]): string | null {
  const record = findLast(records, (r) => isAssistantRecord(r) && recordText(r) !== null);
  return record ? recordText(record) : null;
}

function newestField<T>(
  records: readonly TranscriptRecord[],
  pick: (record: TranscriptRecord) => T | null,
): T | null {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const value = pick(records[i]!);
    if (value !== null) return value;
  }
  return null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A prompt is only a *fallback* label, and prompts carry machinery the user never typed:
 * slash-command wrappers (`<command-name>/goal</command-name>`), system reminders, IDE
 * selection blocks. Strip that so a session's label reads like a session's label.
 */
export function cleanPromptText(text: string | null): string | null {
  if (!text) return null;
  const stripped = text
    // Claude Code prefixes local-command output with a fixed caveat paragraph.
    .replace(/^Caveat:[\s\S]*?asks you to\.\s*/i, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, ' ')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1 ')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, ' ')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, '$1 ')
    .replace(/<\/?[a-z][\w-]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || null;
}

function clip(text: string | null): string | null {
  if (!text) return null;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  return oneLine.length > MAX_TEXT_CHARS ? `${oneLine.slice(0, MAX_TEXT_CHARS - 1)}…` : oneLine;
}
