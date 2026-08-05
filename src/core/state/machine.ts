/**
 * The state machine (§6.2). A pure function of facts + clock + thresholds — which is what
 * makes it unit-testable against fixtures, and this is where all the subtlety lives (§3).
 *
 * Rules, verbatim from the concept:
 *
 *   R.type == "assistant" && stop_reason == "end_turn"        → done
 *   R.type == "assistant" && stop_reason == "tool_use"
 *           && no paired tool result yet
 *           && age(R) <  T_work                               → working
 *           && age(R) >= T_work                               → waiting
 *   R.type == "user"  (a real prompt, or a tool result)        → working
 *   any of the above && age(R) >= T_idle                       → idle
 *   enqueue seen with no matching dequeue                      → queued
 *
 * `R` is the newest *semantic* record: bookkeeping types are filtered out before this runs
 * (237 of 290 files end in a bookkeeping record — RESEARCH.md §2).
 */

import type { Thresholds } from '../model/settings.ts';
import { workThresholdFor } from '../model/settings.ts';
import type { SessionStatus } from '../model/status.ts';
import type { TranscriptTailFacts } from '../model/types.ts';

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
    return {
      status: 'unknown',
      reason: facts.read.exhausted
        ? 'no user/assistant record found within the maximum tail window'
        : 'transcript contains no user/assistant record',
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
    // running next to a slow one cannot cause a false `waiting` (§6.3).
    appliedWorkMs = Math.max(
      ...facts.pendingTools.map((tool) => workThresholdFor(thresholds, tool.name)),
    );
    if (ageMs < appliedWorkMs) {
      status = 'working';
      reason = `tool ${facts.pendingTool.name} running for ${Math.round(ageMs / 1000)}s`;
    } else {
      status = 'waiting';
      reason =
        `tool ${facts.pendingTool.name} issued ${Math.round(ageMs / 1000)}s ago with no result ` +
        `(over ${Math.round(appliedWorkMs / 1000)}s) — probably waiting for input`;
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

  // "any of the above && age(R) >= T_idle → idle". Applies to `done` too: a turn that
  // finished an hour ago is a forgotten session, not a fresh notification (§6.1 `idle`).
  if (ageMs >= thresholds.tIdleMs) {
    status = 'idle';
    reason = `no activity for ${Math.round(ageMs / 60_000)} min`;
  }

  // A queued prompt means there *is* pending work, so it outranks the passive states.
  // It must not mask an actively running turn, which is the more specific information.
  if (facts.queuedPrompt && status !== 'working' && status !== 'waiting') {
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
