/**
 * Claude Code JSONL record shapes (RESEARCH.md §2).
 *
 * Everything is optional and every accessor is defensive: the format is internal to
 * Claude Code and can change without notice, so the parser must degrade rather than
 * crash (§12 "Transcript schema drift").
 */

/** Record types that carry conversation content. Everything else is bookkeeping (§5.2). */
export const SEMANTIC_TYPES = new Set(['user', 'assistant']);

/**
 * Observed bookkeeping types. Kept as a documented list rather than used as a filter —
 * the filter is the allow-list above, so unknown future types are treated as bookkeeping
 * instead of being mistaken for content.
 */
export const KNOWN_BOOKKEEPING_TYPES = [
  'queue-operation',
  'ai-title',
  'last-prompt',
  'file-history-snapshot',
  'attachment',
  'mode',
  'system',
] as const;

export interface ContentBlock {
  type?: string;
  text?: string;
  /** `tool_use` blocks. */
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  /** `tool_result` blocks. */
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

export interface MessageBody {
  role?: string;
  model?: string;
  stop_reason?: string | null;
  content?: string | ContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    service_tier?: string;
  };
}

export interface TranscriptRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  entrypoint?: string;
  isSidechain?: boolean;
  userType?: string;
  isMeta?: boolean;
  message?: MessageBody;
  /** Tool results arrive as `user` records carrying these two (RESEARCH.md §2). */
  toolUseResult?: unknown;
  sourceToolAssistantUUID?: string;
  /** `queue-operation` records. */
  operation?: string;
  /** `ai-title` records. */
  title?: string;
  aiTitle?: string;
  /** `last-prompt` records. */
  leafUuid?: string;
  [key: string]: unknown;
}

export function isSemanticRecord(record: TranscriptRecord): boolean {
  return typeof record.type === 'string' && SEMANTIC_TYPES.has(record.type);
}

export function isAssistantRecord(record: TranscriptRecord): boolean {
  return record.type === 'assistant';
}

export function isUserRecord(record: TranscriptRecord): boolean {
  return record.type === 'user';
}

/** A `user` record that is a tool result rather than a human prompt (RESEARCH.md §2). */
export function isToolResultRecord(record: TranscriptRecord): boolean {
  if (!isUserRecord(record)) return false;
  if (record.toolUseResult !== undefined) return true;
  if (typeof record.sourceToolAssistantUUID === 'string') return true;
  return contentBlocks(record).some((b) => b.type === 'tool_result');
}

/** A `user` record that is an actual human prompt. */
export function isPromptRecord(record: TranscriptRecord): boolean {
  return isUserRecord(record) && !isToolResultRecord(record);
}

/** ISO timestamp → epoch ms. Returns null for missing/garbage values. */
export function recordTime(record: TranscriptRecord): number | null {
  if (typeof record.timestamp !== 'string') return null;
  const ms = Date.parse(record.timestamp);
  return Number.isFinite(ms) ? ms : null;
}

export function contentBlocks(record: TranscriptRecord): ContentBlock[] {
  const content = record.message?.content;
  if (Array.isArray(content)) return content.filter((b): b is ContentBlock => !!b && typeof b === 'object');
  return [];
}

/** Concatenated text of all `text` blocks (or a plain string content). */
export function recordText(record: TranscriptRecord): string | null {
  const content = record.message?.content;
  if (typeof content === 'string') return content.trim() || null;
  const text = contentBlocks(record)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || null;
}

export interface ToolUseBlock {
  id: string | null;
  name: string;
  input: Record<string, unknown>;
}

export function toolUseBlocks(record: TranscriptRecord): ToolUseBlock[] {
  return contentBlocks(record)
    .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
    .map((b) => ({
      id: typeof b.id === 'string' ? b.id : null,
      name: b.name!,
      input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>,
    }));
}

/** `tool_use_id`s a tool-result record answers, if the record spells them out. */
export function resultToolUseIds(record: TranscriptRecord): string[] {
  const ids = contentBlocks(record)
    .filter((b) => b.type === 'tool_result' && typeof b.tool_use_id === 'string')
    .map((b) => b.tool_use_id!);
  return ids;
}

export function resultIsError(record: TranscriptRecord): boolean {
  if (contentBlocks(record).some((b) => b.type === 'tool_result' && b.is_error === true)) return true;
  const r = record.toolUseResult;
  if (r && typeof r === 'object' && 'is_error' in r && (r as { is_error?: unknown }).is_error === true) {
    return true;
  }
  return false;
}

export function stopReason(record: TranscriptRecord): string | null {
  const reason = record.message?.stop_reason;
  return typeof reason === 'string' ? reason : null;
}

/**
 * `message.model`. `<synthetic>` occurs 36 times in the sample history and must not be
 * treated as a real model (RESEARCH.md §2).
 */
export function modelOf(record: TranscriptRecord): string | null {
  const model = record.message?.model;
  if (typeof model !== 'string' || !model || model === '<synthetic>') return null;
  return model;
}

export function isSyntheticModel(record: TranscriptRecord): boolean {
  return record.message?.model === '<synthetic>';
}

/** Title carried by an `ai-title` record; the field name is not guaranteed, so try both. */
export function aiTitleOf(record: TranscriptRecord): string | null {
  for (const key of ['title', 'aiTitle', 'content', 'text'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Short hint from a tool input: the most identifying field we can find. */
export function toolInputHint(input: Record<string, unknown>): string | null {
  const candidates = [
    'description',
    'command',
    'file_path',
    'path',
    'pattern',
    'prompt',
    'query',
    'url',
    'skill',
  ];
  for (const key of candidates) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      const oneLine = value.replace(/\s+/g, ' ').trim();
      return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
    }
  }
  return null;
}

/** `subagent_type` on an `Agent` call, when present. */
export function agentTypeOf(input: Record<string, unknown>): string | null {
  const value = input.subagent_type ?? input.agentType ?? input.agent_type;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The tool name used for subagents in this Claude Code version (RESEARCH.md §2). */
export const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);
