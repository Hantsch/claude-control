/**
 * Provenance-dependent wording shared by `ContextGauge.tsx` and `ContextBar.tsx` (story 005,
 * D5). Both components show the same `ContextPressure`, branching on `windowSource` to say
 * whether the window came from the fetched model table (`'exact'`) or is an assumed guess
 * (`'estimated'`). Pulling that branch out into plain functions here — rather than leaving it
 * inline in JSX — makes the wording unit-testable: this project's `test/unit/` has no
 * component-testing library, so JSX-embedded string logic cannot otherwise be exercised.
 */

import type { ContextPressure } from '../../shared/ipc.ts';
import { formatTokens } from './format.ts';

/**
 * The `ContextGauge` detail line under the bar (D5). Plain text: the widened-vs-not distinction
 * only applies to the estimated case, since a widened window is always `'estimated'` (see
 * `ContextPressure.windowSource`'s doc comment) — the fetched table is never widened.
 */
export function contextGaugeEstimateText(context: Pick<ContextPressure, 'windowSource' | 'widened'>): string {
  if (context.windowSource === 'exact') return 'Exact: window from the fetched model table.';
  return (
    'Estimate: input + cache read + cache creation tokens against an assumed window' +
    (context.widened
      ? ' — auto-widened to the 1M tier because observed usage exceeded 200k.'
      : '. The transcript does not reveal the 1M-context variant.')
  );
}

/**
 * The `ContextBar` row tooltip (D5) — same facts as the gauge, compressed to one sentence that
 * also carries the percentage and band, since the row itself has no separate detail line.
 */
export function contextBarTitle(
  context: Pick<ContextPressure, 'windowSource' | 'used' | 'window'>,
  percent: number,
  bandLabel: string,
): string {
  const head = `Context pressure ≈ ${percent} % (${bandLabel}) — `;
  return context.windowSource === 'exact'
    ? `${head}${formatTokens(context.used)} of ${formatTokens(context.window)}. Exact: window from the fetched model table.`
    : `${head}${formatTokens(context.used)} of an assumed ${formatTokens(context.window)}. Estimate.`;
}
