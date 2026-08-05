/**
 * Subagent tree (F11, §8).
 *
 * v1 shows each subagent as a node with status and duration, not its inner timeline:
 * `isSidechain` was true on zero records, so where a subagent's own transcript lives is
 * unverified (RESEARCH.md §2).
 */

import type { SubagentNode } from '../../shared/ipc.ts';
import { formatDuration } from '../lib/format.ts';

const STATUS_MARK: Record<SubagentNode['status'], string> = {
  running: '◐',
  completed: '✓',
  failed: '✗',
  unknown: '·',
};

export function SubagentTree({ nodes }: { nodes: SubagentNode[] }): React.JSX.Element {
  if (nodes.length === 0) {
    return <div className="estimate">No subagents in the current transcript window.</div>;
  }
  return (
    <ul className="subagents">
      {nodes.map((node) => (
        <li key={node.id}>
          <span className="label" title={node.label}>
            {STATUS_MARK[node.status]} {node.label}
          </span>
          <span className="meta">
            {node.agentType ? `${node.agentType} · ` : ''}
            {node.status}
            {' · '}
            {formatDuration(node.durationMs)}
          </span>
          {node.children.length > 0 && <SubagentTree nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}
