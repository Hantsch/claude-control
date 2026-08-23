/**
 * Subagent tree (§8, F11).
 *
 * Derived from subagent tool calls in the *parent* transcript: label from the tool input,
 * start time from the record, completion from the paired result.
 *
 * Carried caveat from research: `isSidechain` is `false` on every record of the *parent*
 * transcript, so a subagent's inner timeline is not interleaved into it. Each subagent is
 * therefore a node with status, duration and its own run numbers, not an inner timeline —
 * `children` exists in the model but stays empty until the nesting is read from disk.
 *
 * The run numbers (model, tokens, context, tool count, lines touched) come from the result
 * record, so they appear the moment the subagent finishes and are absent while it runs. The
 * one exception is `lastActivityAt`, which `withSubagentActivity` stamps on from the run's own
 * transcript file — see `adapters/claude/subagentFiles.ts`.
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

/**
 * Stamp `lastActivityAt` onto the running nodes from a `tool_use id → newest write` map.
 *
 * Kept apart from `buildSubagentTree` on purpose: the tree is a pure function of records, and
 * the activity times come from the filesystem, which only the adapter may touch (§9). A node
 * with no entry keeps `null` — "no evidence", never "silent since the epoch".
 */
export function withSubagentActivity(
  nodes: readonly SubagentNode[],
  activity: ReadonlyMap<string, number>,
): SubagentNode[] {
  if (activity.size === 0) return nodes as SubagentNode[];
  return nodes.map((node) => {
    const children = withSubagentActivity(node.children, activity);
    const at = node.status === 'running' ? activity.get(node.id) ?? null : null;
    if (at === node.lastActivityAt && children === node.children) return node;
    return { ...node, lastActivityAt: at, children };
  });
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
    // Filled in by `withSubagentActivity` once the adapter has looked at the run's own
    // transcript; the tree itself has no way to know and must not guess.
    lastActivityAt: null,
    durationMs,
    status,
    metrics: result && hasNumbers(result) ? toMetrics(result) : null,
    errorText: result?.errorText ?? null,
    // Deliberately not routed through `toMetrics`: `metrics` is nulled whenever the result
    // carries no numbers, which would swallow the report of a run that only wrote prose.
    finalText: result?.finalText ?? null,
    // `resolvedModel` (finished) wins over the declared alias from the call; no inherited
    // third source, per the Sprint decision — `metrics.model` stays `resolvedModel` only.
    model: result?.model ?? call.declaredModel ?? null,
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
