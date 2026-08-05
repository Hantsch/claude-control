/**
 * Subagent tree (§8, F11).
 *
 * Derived from subagent tool calls in the *parent* transcript: label from the tool input,
 * start time from the record, completion from the paired result.
 *
 * Carried caveat from research: `isSidechain` was `true` on zero records, so a subagent's
 * internal transcript is not interleaved into the parent and its location is unverified.
 * v1 therefore shows each subagent as a node with status and duration, not an inner
 * timeline — `children` exists in the model but stays empty until that is resolved.
 */

import type { SubagentNode, SubagentStatus, ToolCallEvent } from '../model/types.ts';

export function buildSubagentTree(calls: readonly ToolCallEvent[], now: number): SubagentNode[] {
  return calls
    .filter((call) => call.isSubagent)
    .map((call) => toNode(call, now))
    .sort((a, b) => a.startedAt - b.startedAt);
}

function toNode(call: ToolCallEvent, now: number): SubagentNode {
  const status = subagentStatus(call);
  const endedAt = call.endedAt;
  const durationMs = endedAt !== null
    ? Math.max(0, endedAt - call.issuedAt)
    : status === 'running'
      ? Math.max(0, now - call.issuedAt)
      : null;
  return {
    id: call.id,
    label: call.label ?? call.agentType ?? call.name,
    agentType: call.agentType,
    startedAt: call.issuedAt,
    endedAt,
    durationMs,
    status,
    children: [],
  };
}

function subagentStatus(call: ToolCallEvent): SubagentStatus {
  if (call.endedAt === null) return 'running';
  return call.errored ? 'failed' : 'completed';
}

/** Count of subagents still running — shown next to the session row. */
export function runningSubagentCount(nodes: readonly SubagentNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.status === 'running') count += 1;
    count += runningSubagentCount(node.children);
  }
  return count;
}
