/**
 * Context-pressure gauge (F9, §6.4).
 *
 * Labelled an estimate on purpose: the denominator comes from a model → window lookup
 * table because `message.model` does not distinguish the 1M-context variant, and a session
 * that exceeded its assumed window has been auto-widened.
 */

import type { ContextPressure } from '../../shared/ipc.ts';
import { BAND_LABEL, BAND_SYMBOL } from '../../shared/presentation.ts';
import { formatTokens } from '../lib/format.ts';

const BAND_COLOR: Record<ContextPressure['band'], string> = {
  green: 'var(--band-green)',
  yellow: 'var(--band-yellow)',
  red: 'var(--band-red)',
  critical: 'var(--band-critical)',
};

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
          style={{ width: `${Math.min(100, percent)}%`, background: BAND_COLOR[context.band] }}
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
      <div className="estimate">
        Estimate: input + cache read + cache creation tokens against an assumed window
        {context.widened
          ? ' — auto-widened to the 1M tier because observed usage exceeded 200k.'
          : '. The transcript does not reveal the 1M-context variant.'}
      </div>
    </div>
  );
}
