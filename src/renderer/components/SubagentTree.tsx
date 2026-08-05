/**
 * Subagent tree (F11, §8).
 *
 * v1 shows each subagent as a node with status, duration and — once it has finished — the
 * numbers its own result reports: model, tokens spent, how full its context got, tool calls
 * and lines touched. Not its inner timeline: `isSidechain` was true on zero records, so
 * where a subagent's own transcript lives is unverified (RESEARCH.md §2).
 *
 * A running subagent shows no numbers because none exist yet — they arrive with the result.
 */

import { Fragment } from 'react';
import type { SubagentMetrics, SubagentNode } from '../../shared/ipc.ts';
import { BAND_LABEL, BAND_SYMBOL } from '../../shared/presentation.ts';
import { formatDuration, formatTokens } from '../lib/format.ts';

const STATUS_MARK: Record<SubagentNode['status'], string> = {
  running: '◐',
  launched: '↗',
  completed: '✓',
  failed: '✗',
  unknown: '·',
};

const STATUS_HINT: Record<SubagentNode['status'], string> = {
  running: 'Issued, no result yet.',
  launched:
    'Started in the background — the tool call returned immediately, so this transcript ' +
    'never reports when the run finished. The time is how long ago it was launched.',
  completed: 'The run finished and reported its numbers.',
  failed: 'The run ended in an error.',
  unknown: 'The result could not be interpreted.',
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
          <span className="meta" title={STATUS_HINT[node.status]}>
            {node.agentType ? `${node.agentType} · ` : ''}
            {node.status}
            {' · '}
            {formatDuration(node.durationMs)}
            {node.status === 'launched' ? ' since launch' : ''}
          </span>
          {node.errorText && (
            <span className="meta error" title={node.errorText}>
              {node.errorText}
            </span>
          )}
          {node.metrics ? (
            <Metrics metrics={node.metrics} />
          ) : (
            node.status === 'running' && (
              <span className="meta">tokens and context arrive when the run finishes</span>
            )
          )}
          {node.children.length > 0 && <SubagentTree nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}

interface MetricPart {
  key: string;
  text: string;
  title: string;
}

function Metrics({ metrics }: { metrics: SubagentMetrics }): React.JSX.Element {
  const parts: MetricPart[] = [];

  if (metrics.model) {
    parts.push({
      key: 'model',
      text: metrics.model,
      title: 'Model the run actually resolved to',
    });
  }
  if (metrics.totalTokens !== null) {
    parts.push({
      key: 'tokens',
      text: `${formatTokens(metrics.totalTokens)} tok`,
      title: 'Tokens the whole run spent — cumulative, not its context size',
    });
  }
  if (metrics.context) {
    const { used, window, band, ratio } = metrics.context;
    parts.push({
      key: 'ctx',
      text: `${BAND_SYMBOL[band]} ctx ${Math.round(ratio * 100)}%`,
      title:
        `Context when the run finished — estimate: ${formatTokens(used)} of an assumed ` +
        `${formatTokens(window)} window (${BAND_LABEL[band]})`,
    });
  }
  if (metrics.toolUses !== null) {
    parts.push({
      key: 'tools',
      text: `${metrics.toolUses} tools`,
      title: 'Tool calls the subagent made',
    });
  }
  if (metrics.linesAdded || metrics.linesRemoved) {
    parts.push({
      key: 'lines',
      text: `+${metrics.linesAdded ?? 0}/−${metrics.linesRemoved ?? 0}`,
      title: 'Lines the subagent added / removed',
    });
  }

  if (parts.length === 0) return <></>;
  return (
    <span className="meta metrics">
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 && ' · '}
          <span title={part.title}>{part.text}</span>
        </Fragment>
      ))}
    </span>
  );
}
