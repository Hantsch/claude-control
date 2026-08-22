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
 * The wording for "this subagent is running/launched and has not reported anything yet"
 * (story 010 D6, reconciled with story 011 D4). Shared between `popoverModel.ts` and
 * `SubagentTree.tsx` so the two surfaces cannot describe the same run with two different
 * strings — both import this constant rather than hand-typing their own copy.
 */
export const SUBAGENT_NO_INTERIM_STATE =
  "No report yet — a subagent's progress isn't observable until it finishes.";

/**
 * One part per fact `metrics` actually carries, in a fixed order: cumulative tokens, context,
 * tool uses, lines touched. Absent facts (`null`, or both line counts falsy) produce no part
 * at all — never a placeholder — so a caller can render `parts.length === 0` as "nothing to
 * show" without a special case.
 *
 * Does not build a `model` part: that used to read `metrics.model` (`resolvedModel` only), but
 * both callers now build their own model chip from `node.model` directly, since that also
 * covers a declared-but-not-yet-run alias that `metrics.model` alone cannot represent.
 */
export function buildMetricParts(metrics: SubagentMetrics): MetricPart[] {
  const parts: MetricPart[] = [];

  if (metrics.totalTokens !== null) {
    parts.push({
      key: 'tokens',
      text: `${formatTokens(metrics.totalTokens)} tok`,
      title: 'Tokens the whole run spent — cumulative, not its context size',
    });
  }
  if (metrics.context) {
    const { used, window, band, ratio, windowSource } = metrics.context;
    parts.push({
      key: 'ctx',
      text: `${BAND_SYMBOL[band]} ctx ${Math.round(ratio * 100)}%`,
      title:
        windowSource === 'exact'
          ? `Context when the run finished — exact: ${formatTokens(used)} of the ` +
            `${formatTokens(window)} window from the fetched model table (${BAND_LABEL[band]})`
          : `Context when the run finished — estimate: ${formatTokens(used)} of an assumed ` +
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
