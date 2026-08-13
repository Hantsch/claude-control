/**
 * The state machine (§6.2). A pure function of facts + clock + thresholds — which is what
 * makes it unit-testable against fixtures, and this is where all the subtlety lives (§3).
 *
 * Rules, verbatim from the concept:
 *
 *   R.type == "assistant" && stop_reason == "end_turn"        → done
 *   R.type == "assistant" && stop_reason == "tool_use"
 *           && no paired tool result yet
 *           && age(R) <  T_work(tool)                          → working
 *           && age(R) >= T_work(tool) && tool is fast          → waiting
 *           && age(R) >= T_work(tool) && tool is slow          → stale
 *   R.type == "user"  (a real prompt, or a tool result)        → working
 *   enqueue seen with no matching dequeue                      → queued
 *   no R at all, whole transcript seen, read ok                → starting
 *   no R at all, read failed or window too small               → unknown
 *
 * `R` is the newest *semantic* record: bookkeeping types are filtered out before this runs
 * (237 of 290 files end in a bookkeeping record — RESEARCH.md §2).
 *
 * Nothing here decays with age. The old "age(R) >= T_idle → idle" rule turned every state,
 * `done` included, into `idle` after 15 minutes — so a session that had finished cleanly
 * an hour ago was indistinguishable from one that had hung mid-turn, and the tray was mostly
 * grey dots. Age is a *list* concern now (`isTrayWorthy`), not a state.
 */

import type { Thresholds } from '../model/settings.ts';
import { isSlowTool, workThresholdFor } from '../model/settings.ts';
import type { SessionStatus } from '../model/status.ts';
import type { TranscriptTailFacts } from '../model/types.ts';

/** States that mean "a turn is in flight" — a queued prompt must not mask any of them. */
const ONGOING = new Set<SessionStatus>(['working', 'waiting', 'stale']);

export interface DeriveInput {
  /** Registry says the process is alive and is the same process (§4). */
  alive: boolean;
  facts: TranscriptTailFacts;
  now: number;
  thresholds: Thresholds;
}

export interface DeriveResult {
  status: SessionStatus;
  /** Human-readable justification, surfaced in the detail pane and useful in tests. */
  reason: string;
  /** Age of the newest semantic record in ms, or null when there is none. */
  ageMs: number | null;
  /** Threshold that was applied to an unpaired tool call, when one was. */
  appliedWorkMs: number | null;
}

export function deriveStatus(input: DeriveInput): DeriveResult {
  const { alive, facts, now, thresholds } = input;

  if (!alive) {
    return { status: 'ended', reason: 'process is no longer alive', ageMs: null, appliedWorkMs: null };
  }

  const last = facts.last;
  if (!last) {
    // No semantic record even at the maximum tail window: say so instead of guessing (§5.2).
    if (facts.queuedPrompt) {
      return {
        status: 'queued',
        reason: 'no semantic record in the tail window, but a prompt is enqueued',
        ageMs: null,
        appliedWorkMs: null,
      };
    }
    // The read succeeded and covered the whole transcript (`startOffset === 0`, which a
    // missing file also reports): the absence of any user/assistant record is then a fact
    // about the session, not about the window — it simply has not been used yet.
    if (facts.read.error === null && facts.read.startOffset === 0) {
      return {
        status: 'starting',
        reason: 'session is open but has not exchanged a message yet',
        ageMs: null,
        appliedWorkMs: null,
      };
    }
    return {
      status: 'unknown',
      reason:
        facts.read.error ??
        (facts.read.exhausted
          ? 'no user/assistant record found within the maximum tail window'
          : 'transcript contains no user/assistant record'),
      ageMs: null,
      appliedWorkMs: null,
    };
  }

  const ageMs = Math.max(0, now - last.at);
  let status: SessionStatus;
  let reason: string;
  let appliedWorkMs: number | null = null;

  if (last.kind === 'assistant' && last.stopReason === 'end_turn') {
    status = 'done';
    reason = 'assistant ended its turn (stop_reason=end_turn)';
  } else if (last.kind === 'assistant' && facts.pendingTool) {
    // Parallel calls in one record: the most permissive threshold wins, so a fast tool
    // running next to a slow one cannot cause a false overdue verdict (§6.3). The tool that
    // set that budget is also the one whose speed class decides `waiting` vs `stale` — it is
    // the call the session is really blocked on.
    const budgets = facts.pendingTools.map((tool) => ({
      name: tool.name,
      ms: workThresholdFor(thresholds, tool.name),
    }));
    const slowest = budgets.reduce((a, b) => (b.ms > a.ms ? b : a));
    appliedWorkMs = slowest.ms;
    if (ageMs < appliedWorkMs) {
      status = 'working';
      reason = `tool ${facts.pendingTool.name} running for ${Math.round(ageMs / 1000)}s`;
    } else if (isSlowTool(thresholds, slowest.name)) {
      // A tool that is *supposed* to take minutes and is taking more of them says nothing
      // about whether anything is wrong — so this is a hint, not an alarm, and it stays out
      // of the badge and the toasts.
      status = 'stale';
      reason =
        `tool ${slowest.name} has been running for ${Math.round(ageMs / 60_000)} min ` +
        `(over its ${Math.round(appliedWorkMs / 60_000)} min budget) — probably still working, ` +
        `but worth a look`;
    } else {
      status = 'waiting';
      reason =
        `tool ${facts.pendingTool.name} issued ${Math.round(ageMs / 1000)}s ago with no result ` +
        `(over ${Math.round(appliedWorkMs / 1000)}s) — a tool this fast is usually blocked on ` +
        `a permission prompt or a question`;
    }
  } else if (last.kind === 'assistant') {
    // `tool_use` without an identifiable pending call, `stop_sequence`, or a missing
    // `stop_reason`. The model produced output and nothing indicates a handover.
    status = 'working';
    reason = last.stopReason
      ? `assistant record with stop_reason=${last.stopReason}`
      : 'assistant record without stop_reason';
  } else {
    status = 'working';
    reason = last.kind === 'prompt' ? 'prompt submitted, model is starting' : 'tool result returned';
  }

  // A queued prompt means there *is* pending work, so it outranks the passive states.
  // It must not mask an actively running turn, which is the more specific information —
  // and an overdue turn is still a running one, so `waiting`/`stale` win too.
  if (!ONGOING.has(status) && facts.queuedPrompt) {
    status = 'queued';
    reason = 'a prompt is enqueued and has not started yet';
  }

  return { status, reason, ageMs, appliedWorkMs };
}

/**
 * Status a *finished* transcript ended in — "how did this session end", evaluated at the
 * moment of its last record rather than now. Used by the history index (§5.1).
 */
export function deriveHistoricalStatus(
  facts: TranscriptTailFacts,
  thresholds: Thresholds,
): SessionStatus {
  const at = facts.last?.at;
  if (at === undefined) return 'unknown';
  return deriveStatus({ alive: true, facts, now: at, thresholds }).status;
}
