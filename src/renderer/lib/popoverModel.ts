/**
 * Pure view-model helpers for the tray popover (story 010).
 *
 * The popover's rules live here rather than inside the JSX because vitest runs without jsdom
 * in this project — there is no render harness, so anything worth a test has to be a pure
 * function over `SessionView` data (see the story's Sprint decisions). `popover.tsx` renders
 * what these return and adds no rules of its own.
 */

import type { SubagentMetrics, SubagentNode } from '../../shared/ipc.ts';
import { SUBAGENT_NO_INTERIM_STATE } from './subagentParts.ts';

export type SubagentStatus = SubagentNode['status'];

/**
 * The pip a single subagent gets, mirroring the design prototype's `.sub .pip` classes:
 * `on` = finished, `run` = still going (running or launched), `fail` = died, and the empty
 * string for `unknown` — a state we cannot colour honestly, so it stays the neutral base pip.
 */
export type SubagentPipClass = 'on' | 'run' | 'fail' | '';

export interface SubagentSummary {
  /** Subagents that reached `completed`. Nothing else counts as done. */
  done: number;
  total: number;
  /** One entry per subagent, in `session.subagents` order. */
  pipClasses: SubagentPipClass[];
  /** Tooltip wording — kept here so it is testable without a DOM. */
  title: string;
}

function pipClass(status: SubagentNode['status']): SubagentPipClass {
  switch (status) {
    case 'completed':
      return 'on';
    case 'failed':
      return 'fail';
    case 'running':
    case 'launched':
      return 'run';
    case 'unknown':
      return '';
  }
}

/**
 * "How many subagents are there, and how many are done" — the one subagent fact the glance
 * surface owes you without a click (story 010 D1). Returns `null` for a session with no
 * subagents so the caller can render nothing at all instead of a `0/0` that looks like a
 * failure.
 */
export function subagentSummary(subagents: SubagentNode[]): SubagentSummary | null {
  if (subagents.length === 0) return null;

  const pipClasses = subagents.map((node) => pipClass(node.status));
  const done = pipClasses.filter((pip) => pip === 'on').length;
  const failed = pipClasses.filter((pip) => pip === 'fail').length;
  const total = subagents.length;

  const title =
    `${done} of ${total} subagent${total === 1 ? '' : 's'} finished` +
    (failed > 0 ? `, ${failed} failed` : '');

  return { done, total, pipClasses, title };
}

/**
 * The exact wording for "this subagent is running/launched and has not reported anything
 * yet" (story 010 D6, reconciled with story 011 D4 so the popover and `SubagentTree.tsx`
 * cannot drift back apart). Defined once in `subagentParts.ts` — the module already shared
 * between the two rendering surfaces — and re-exported here so existing importers of this
 * module keep working.
 */
export { SUBAGENT_NO_INTERIM_STATE };

/**
 * The disclaimer that belongs once below a session's flat subagent list, not on any one row
 * (story 010 D6): `buildSubagentTree` sets `children: []` unconditionally, so a subagent that
 * itself spawned subagents is indistinguishable from one that did not. Exported as a constant
 * so the UI and its unit test assert on the same string instead of two hand-typed copies.
 */
export const SUBAGENT_FLAT_LIST_NOTE =
  'flat list — a subagent that itself spawned subagents would not be recognisable as a parent here.';

export type SubagentMessageKind = 'error' | 'absent' | 'none';

export interface SubagentMessage {
  kind: SubagentMessageKind;
  /** The text to render, or `null` when there is nothing to say (`kind === 'none'`). */
  text: string | null;
}

/**
 * What, if anything, a subagent row's message slot should say — the single decision point
 * behind D6's three absent-data cases, kept pure so the failure case (which cannot be
 * provoked on demand in the running app) still has standing unit coverage.
 *
 * - `failed` with `errorText` set → `'error'`, the error text itself (band-red on the row).
 * - `running`/`launched` → `'absent'`, `SUBAGENT_NO_INTERIM_STATE`, regardless of whether
 *   `metrics` happens to be non-`null`: a `launched` result already carries `agentId` and
 *   `resolvedModel` (so `metrics` is non-`null`) while the run itself is still going in the
 *   background with no interim report — verified as the *common* case against real agent
 *   results, not an edge case, so this must key off `status` and never off `metrics`.
 * - anything else (completed, or a status this transcript could not interpret) → `'none'`.
 *
 * A `'error'` result does *not* suppress the row's model/context chips: story 011 requires
 * `errorText` to coexist with, not replace, a model or report the run had already produced
 * before it died (D4's acceptance criterion) — the caller renders those alongside the error
 * text rather than hiding them.
 */
export function subagentMessage(
  status: SubagentStatus,
  metrics: SubagentMetrics | null,
  errorText: string | null,
): SubagentMessage {
  if (status === 'failed' && errorText) return { kind: 'error', text: errorText };
  if (status === 'running' || status === 'launched') {
    return { kind: 'absent', text: SUBAGENT_NO_INTERIM_STATE };
  }
  return { kind: 'none', text: null };
}
