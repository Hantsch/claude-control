/**
 * Shared metric-part builder for a finished subagent's numbers (story 010 D5).
 *
 * `SubagentTree.tsx` (the main window's detail pane) and `popover.tsx` (the tray's glance
 * surface) both need to describe the same subagent run, and they must never disagree about
 * wording or tooltips while doing it — so the rule for *which* parts a `SubagentMetrics`
 * produces, and what each one says, lives here once. Both surfaces render from this; neither
 * builds its own array.
 */

import type { SubagentMetrics } from '../../shared/ipc.ts';
import { BAND_LABEL, BAND_SYMBOL } from '../../shared/presentation.ts';
import { formatTokens } from './format.ts';

export interface MetricPart {
  key: string;
  text: string;
  title: string;
}

/**
 * One part per fact `metrics` actually carries, in a fixed order: model, cumulative tokens,
 * context, tool uses, lines touched. Absent facts (`null`, or both line counts falsy) produce
 * no part at all — never a placeholder — so a caller can render `parts.length === 0` as
 * "nothing to show" without a special case.
 */
export function buildMetricParts(metrics: SubagentMetrics): MetricPart[] {
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

  return parts;
}
