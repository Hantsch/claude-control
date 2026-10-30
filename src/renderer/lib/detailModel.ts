/**
 * Pure view model of the session detail window: header, run grouping, paging and the
 * load state machine. Kept out of the JSX because tests run without a DOM.
 */
import type { SessionDetail, SessionId, TimelineEvent, UsageTotals } from '../../core/model/types.ts';
import { clipOneLine } from '../../core/model/text.ts';
import { formatDateTime, formatDuration } from './format.ts';

const NONE = '—';
const CLIP = 120;

export interface DetailHeader {
  title: string;
  projectName: string;
  projectPath: string;
  branches: string;
  models: string;
  startedAt: string;
  endedAt: string;
  duration: string;
  /** `null` when the transcript reported no usage: never rendered as zeros. */
  tokens: (UsageTotals & { total: number }) | null;
  tokensNote: string | null;
}

export function detailHeader(detail: SessionDetail): DetailHeader {
  const { usage } = detail;
  const duration =
    detail.startedAt !== null && detail.endedAt !== null ? detail.endedAt - detail.startedAt : null;
  return {
    title: detail.title ?? detail.sessionId,
    projectName: detail.project.name,
    projectPath: detail.project.path,
    branches: detail.branches.length ? detail.branches.join(', ') : NONE,
    models: detail.models.length ? detail.models.join(', ') : NONE,
    startedAt: formatDateTime(detail.startedAt),
    endedAt: formatDateTime(detail.endedAt),
    duration: formatDuration(duration),
    tokens: usage
      ? {
          ...usage,
          total:
            usage.inputTokens +
            usage.cacheReadTokens +
            usage.cacheCreationTokens +
            usage.outputTokens,
        }
      : null,
    tokensNote: usage ? null : 'no usage reported',
  };
}

export interface TimelineRun {
  /** Set only on the leading run of events that precede the first prompt. */
  label: string | null;
  promptText: string;
  startedAt: number;
  endedAt: number;
  eventCount: number;
  toolCount: number;
  events: TimelineEvent[];
}

function makeRun(label: string | null, first: TimelineEvent): TimelineRun {
  const text = first.kind === 'prompt' ? first.text : null;
  return {
    label,
    promptText: (text && clipOneLine(text, CLIP)) || '(no text)',
    startedAt: first.at,
    endedAt: first.at,
    eventCount: 0,
    toolCount: 0,
    events: [],
  };
}

export function groupRuns(events: TimelineEvent[]): TimelineRun[] {
  const runs: TimelineRun[] = [];
  let current: TimelineRun | null = null;
  for (const event of events) {
    if (event.kind === 'prompt') current = null;
    if (!current) {
      current = makeRun(event.kind === 'prompt' ? null : 'Before the first prompt', event);
      runs.push(current);
    }
    current.events.push(event);
    current.eventCount += 1;
    if (event.tool !== null) current.toolCount += 1;
    current.endedAt = event.at;
  }
  return runs;
}

export const TIMELINE_PAGE = 200;

export function visibleEvents(
  run: TimelineRun,
  pages: number,
): { events: TimelineEvent[]; remaining: number } {
  const shown = Math.min(run.events.length, Math.max(0, pages) * TIMELINE_PAGE);
  return { events: run.events.slice(0, shown), remaining: run.events.length - shown };
}

const KIND_LABEL: Record<TimelineEvent['kind'], string> = {
  prompt: 'Prompt',
  'tool-result': 'Tool result',
  assistant: 'Assistant',
  interrupt: 'Interrupt',
};

export interface EventRow {
  time: string;
  kind: string;
  tool: string | null;
  stopReason: string | null;
  text: string;
  hasMore: boolean;
}

export function eventRow(event: TimelineEvent): EventRow {
  const full = event.text ? event.text.replace(/\s+/g, ' ').trim() : '';
  const text = clipOneLine(full, CLIP);
  return {
    time: formatDateTime(event.at),
    kind: KIND_LABEL[event.kind],
    tool: event.tool,
    stopReason: event.stopReason,
    text,
    hasMore: text !== full,
  };
}

export type DetailLoad =
  | { state: 'idle' }
  | { state: 'loading'; id: SessionId }
  | { state: 'loaded'; id: SessionId; detail: SessionDetail }
  | { state: 'failed'; id: SessionId; message: string };

export type DetailLoadAction =
  | { type: 'target'; id: SessionId }
  | { type: 'resolved'; detail: SessionDetail }
  | { type: 'rejected'; id: SessionId; message: string };

export function detailLoad(state: DetailLoad, action: DetailLoadAction): DetailLoad {
  if (action.type === 'target') {
    // The fetch effect is keyed on the id, so re-targeting the current id must not reset state.
    if (state.state !== 'idle' && state.id === action.id) return state;
    return { state: 'loading', id: action.id };
  }
  if (state.state === 'idle') return state;
  if (action.type === 'resolved') {
    if (action.detail.sessionId !== state.id) return state;
    return { state: 'loaded', id: state.id, detail: action.detail };
  }
  if (action.id !== state.id) return state;
  return { state: 'failed', id: state.id, message: action.message };
}

export function detailTruncatedNotice(detail: SessionDetail): string | null {
  return detail.truncated
    ? 'The timeline stops after the first 10 000 events; the totals above still cover the whole transcript.'
    : null;
}
