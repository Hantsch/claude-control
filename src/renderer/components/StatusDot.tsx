import type { SessionStatus } from '../../shared/ipc.ts';
import { STATUS_COLOR_VAR, STATUS_HINT, STATUS_LABEL } from '../../shared/presentation.ts';

export function StatusDot({
  status,
  size,
}: {
  status: SessionStatus;
  /** `sm` is the popover's second row (story 010 D1), where the dot only re-states the
   *  status next to its text and must not compete with the full-size dot on line 1. */
  size?: 'sm';
}): React.JSX.Element {
  return (
    <span
      className={`dot${size ? ` ${size}` : ''}${status === 'working' ? ' pulse' : ''}${status === 'waiting' ? ' halo' : ''}`}
      style={{ background: `var(${STATUS_COLOR_VAR[status]})` }}
      title={`${STATUS_LABEL[status]} — ${STATUS_HINT[status]}`}
    />
  );
}
