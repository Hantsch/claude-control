/**
 * The state machine (§6.2). A pure function of facts + clock + thresholds — which is what
 * makes it unit-testable against fixtures, and this is where all the subtlety lives (§3).
 *
 * Rules, verbatim from the concept:
 *
 *   R.type == "assistant" && stop_reason == "end_turn"        → done
 *   R.type == "assistant" && stop_reason == "tool_use"
 *           && no paired tool result yet
 *           && quiet <  T_work(tool)                           → working
 *           && quiet >= T_work(tool) && tool is fast           → waiting
 *           && quiet >= T_work(tool) && tool is slow           → stale
 *   R.type == "user"  (a real prompt, or a tool result)        → working
 *   R.type == "user"  && R is an interrupt marker              → interrupted
 *   enqueue seen with no matching dequeue                      → queued
 *   no R at all, whole transcript seen, read ok                → starting
 *   no R at all, read failed or window too small               → unknown
 *
 * The interrupt rule is the one addition to the concept's list. `[Request interrupted by
 * user]` is a `user` record, so the plain rule above read an aborted turn as one that had
 * just started and left the session at `working` for good — see `model/status.ts`.
 *
 * `R` is the newest *semantic* record: bookkeeping types are filtered out before this runs
 * (237 of 290 files end in a bookkeeping record — RESEARCH.md §2).
 *
 * `quiet` is how long *nothing at all* has happened, which is age(R) except when the call is
 * an `Agent` whose subagent has its own transcript on disk: a subagent writing away in its own
 * file is the session working, even though the parent transcript gets nothing until the run
 * reports back. Without that, a fan-out run went `stale` after 20 minutes while every one of
 * its subagents was demonstrably busy — the state was a statement about the parent file, not
 * about the session. `facts.subagentActivityAt` carries the evidence; absent, nothing changes.
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
  /**
   * Registry-reported status, when the agent published one (§1, D3). Absent on every
   * Claude Code version observed so far, so every rule below still has to stand on its own.
   */
  reported?: {
    status: string | null;
    waitingFor: string | null;
    at: number | null;
  } | null;
}

export interface DeriveResult {
  status: SessionStatus;
  /** Human-readable justification, surfaced in the detail pane and useful in tests. */
  reason: string;
  /** Age of the newest semantic record in ms, or null when there is none. */
  ageMs: number | null;
  /** Threshold that was applied to an unpaired tool call, when one was. */
  appliedWorkMs: number | null;
  /** Whether the agent told us this status or we inferred it from the transcript. */
  statusSource: 'reported' | 'inferred';
}

export function deriveStatus(input: DeriveInput): DeriveResult {
  const { alive, facts, now, thresholds } = input;

  if (!alive) {
    return {
      status: 'ended',
      reason: 'process is no longer alive',
      ageMs: null,
      appliedWorkMs: null,
      statusSource: 'inferred',
    };
  }

  // The agent's own word outranks everything we could infer from the transcript — but only
  // for `waiting`, the one state the tail cannot see reliably (a permission prompt leaves no
  // record). No staleness check: a reported `waiting` stands until the agent says otherwise,
  // however old `reported.at` is. Anything else reported is carried, never acted on.
  if (input.reported?.status === 'waiting') {
    return {
      status: 'waiting',
      reason: `Claude Code reported waiting for ${input.reported.waitingFor ?? 'a permission prompt or a question'}`,
      ageMs: facts.last ? Math.max(0, now - facts.last.at) : null,
      appliedWorkMs: null,
      statusSource: 'reported',
    };
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
        statusSource: 'inferred',
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
        statusSource: 'inferred',
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
      statusSource: 'inferred',
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
    // A subagent of this very call writing to its own transcript restarts the clock: the work
    // is observably going on, so the call is not overdue no matter how old the parent record
    // is. `subagentActivityAt` is only ever set for a *pending* call's subagent (adapter), and
    // is `null` whenever there is no evidence — then this is plain `ageMs`, exactly as before.
    const quietMs =
      facts.subagentActivityAt !== null
        ? Math.min(ageMs, Math.max(0, now - facts.subagentActivityAt))
        : ageMs;
    if (quietMs < appliedWorkMs) {
      status = 'working';
      reason =
        quietMs === ageMs
          ? `tool ${facts.pendingTool.name} running for ${Math.round(ageMs / 1000)}s`
          : `tool ${facts.pendingTool.name} running for ${Math.round(ageMs / 60_000)} min — ` +
            `its subagent wrote ${Math.round(quietMs / 1000)}s ago, so the run is progressing`;
    } else if (isSlowTool(thresholds, slowest.name)) {
      // A tool that is *supposed* to take minutes and is taking more of them says nothing
      // about whether anything is wrong — so this is a hint, not an alarm, and it stays out
      // of the badge and the toasts.
      status = 'stale';
      reason =
        `tool ${slowest.name} has been running for ${Math.round(ageMs / 60_000)} min ` +
        `(over its ${Math.round(appliedWorkMs / 60_000)} min budget) with nothing written ` +
        `since — probably still working, but worth a look`;
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
  } else if (last.kind === 'interrupt') {
    // The turn was aborted (Esc). Nothing is running, nothing finished, and the user already
    // knows — so this is neither `working` (which would pin the row to the popover forever,
    // undismissible) nor `done` (which would claim a result and fire a toast).
    status = 'interrupted';
    reason = 'the turn was interrupted — the session is idle at its prompt';
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

  return { status, reason, ageMs, appliedWorkMs, statusSource: 'inferred' };
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
