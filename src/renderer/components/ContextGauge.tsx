/**
 * Context-pressure gauge (F9, §6.4).
 *
 * Labelled an estimate on purpose: the denominator comes from a model → window lookup
 * table because `message.model` does not distinguish the 1M-context variant, and a session
 * that exceeded its assumed window has been auto-widened.
 */

import type { ContextPressure } from '../../shared/ipc.ts';
import { BAND_COLOR_VAR, BAND_LABEL, BAND_SYMBOL } from '../../shared/presentation.ts';
import { contextGaugeEstimateText } from '../lib/contextProvenance.ts';
import { formatTokens } from '../lib/format.ts';

export function ContextGauge({ context }: { context: ContextPressure | null }): React.JSX.Element {
  if (!context) {
    return <div className="estimate">No usage recorded in the transcript tail yet.</div>;
  }

  const percent = Math.min(100, Math.round(context.ratio * 1000) / 10);
  return (
    <div className="gauge">
      <div className="gauge-bar">
        <div
          className="gauge-fill"
          style={{
            width: `${Math.min(100, percent)}%`,
            background: `var(${BAND_COLOR_VAR[context.band]})`,
          }}
        />
      </div>
      <div className="gauge-legend">
        <span title={`Band: ${BAND_LABEL[context.band]}`}>
          {BAND_SYMBOL[context.band]} {percent}%
        </span>
        <span>
          {formatTokens(context.used)} / {formatTokens(context.window)}
        </span>
      </div>
      <div className="estimate">{contextGaugeEstimateText(context)}</div>
    </div>
  );
}
