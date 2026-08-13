/**
 * Row-sized context-pressure indicator (F9, §6.4).
 *
 * The same estimate the detail pane's `ContextGauge` shows, compressed to one grid cell so
 * the live list answers "how much room is left in that session" without a click — that is
 * the number you steer by when deciding which session to go back to first.
 *
 * Colour comes from the shared band table, so a row and the gauge can never disagree.
 */

import type { ContextPressure } from '../../shared/ipc.ts';
import { BAND_COLOR_VAR, BAND_LABEL } from '../../shared/presentation.ts';
import { formatTokens } from '../lib/format.ts';

export function ContextBar({
  context,
  showValue = true,
}: {
  context: ContextPressure | null;
  /** The popover is narrow: there the bar alone carries the message. */
  showValue?: boolean;
}): React.JSX.Element {
  if (!context) {
    return (
      <span className="ctx empty" title="No usage recorded in the transcript tail yet.">
        —
      </span>
    );
  }

  const percent = Math.min(100, Math.round(context.ratio * 100));
  return (
    <span
      className="ctx"
      title={
        `Context pressure ≈ ${percent} % (${BAND_LABEL[context.band]}) — ` +
        `${formatTokens(context.used)} of an assumed ${formatTokens(context.window)}. Estimate.`
      }
    >
      <span className="ctx-bar">
        <span
          className="ctx-fill"
          style={{ width: `${percent}%`, background: `var(${BAND_COLOR_VAR[context.band]})` }}
        />
      </span>
      {showValue && <span className="ctx-value">{percent}%</span>}
    </span>
  );
}
