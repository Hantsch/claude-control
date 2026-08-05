/**
 * Subagent tree (§8, F11).
 *
 * Derived from subagent tool calls in the *parent* transcript: label from the tool input,
 * start time from the record, completion from the paired result.
 *
 * Carried caveat from research: `isSidechain` was `true` on zero records, so a subagent's
 * internal transcript is not interleaved into the parent and its location is unverified.
 * v1 therefore shows each subagent as a node with status, duration and its own run numbers,
 * not an inner timeline — `children` exists in the model but stays empty until that is
 * resolved.
 *
 * The run numbers (model, tokens, context, tool count, lines touched) come from the result
 * record, so they appear the moment the subagent finishes and are absent while it runs.
 */

import type {
  SubagentMetrics,
  SubagentNode,
  SubagentRunResult,
  SubagentStatus,
  ToolCallEvent,
} from '../model/types.ts';
import { pressureFor } from './contextPressure.ts';

export function buildSubagentTree(calls: readonly ToolCallEvent[], now: number): SubagentNode[] {
  return calls
    .filter((call) => call.isSubagent)
    .map((call) => toNode(call, now))
    .sort((a, b) => a.startedAt - b.startedAt);
}

function toNode(call: ToolCallEvent, now: number): SubagentNode {
  const status = subagentStatus(call);
  const result = call.runResult;
  // A background run's result only says "launched", so its result timestamp is not an end.
  const open = status === 'running' || status === 'launched';
  const endedAt = open ? null : call.endedAt;
  // The subagent's own `totalDurationMs` wins when it reported one — it and the record
  // timestamps agree, but the reported value is the run's own measurement.
  const durationMs = result?.durationMs
    ?? (open
      ? Math.max(0, now - call.issuedAt)
      : endedAt !== null
        ? Math.max(0, endedAt - call.issuedAt)
        : null);
  return {
    id: call.id,
    label: call.label ?? call.agentType ?? call.name,
    agentType: call.agentType ?? result?.agentType ?? null,
    agentId: result?.agentId ?? null,
    startedAt: call.issuedAt,
    endedAt,
    durationMs,
    status,
    metrics: result && hasNumbers(result) ? toMetrics(result) : null,
    errorText: result?.errorText ?? null,
    children: [],
  };
}

/** A run that only reported an error has nothing to show; do not fake an empty metrics row. */
function hasNumbers(result: SubagentRunResult): boolean {
  return (
    result.model !== null ||
    result.totalTokens !== null ||
    result.toolUses !== null ||
    result.usage !== null ||
    result.linesAdded !== null ||
    result.linesRemoved !== null
  );
}

function toMetrics(result: SubagentRunResult): SubagentMetrics {
  return {
    model: result.model,
    totalTokens: result.totalTokens,
    toolUses: result.toolUses,
    // `resolvedModel` spells out the 1M variant, so this estimate needs no widening trick.
    context: result.usage ? pressureFor(result.model, result.usage) : null,
    linesAdded: result.linesAdded,
    linesRemoved: result.linesRemoved,
  };
}

function subagentStatus(call: ToolCallEvent): SubagentStatus {
  // A background launch answers immediately and keeps working (see `SubagentStatus`).
  if (call.runResult?.status === 'async_launched') return 'launched';
  if (call.endedAt === null) return 'running';
  return call.errored ? 'failed' : 'completed';
}

/**
 * Count of subagents still running — shown next to the session row.
 *
 * `launched` ones are deliberately not counted: nothing in this transcript ever reports
 * their end, so counting them would pin "subagent" on the row for the rest of the session.
 */
export function runningSubagentCount(nodes: readonly SubagentNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.status === 'running') count += 1;
    count += runningSubagentCount(node.children);
  }
  return count;
}
