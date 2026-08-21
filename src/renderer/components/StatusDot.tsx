import type { SessionStatus } from '../../shared/ipc.ts';
import { STATUS_COLOR_VAR, STATUS_HINT, STATUS_LABEL } from '../../shared/presentation.ts';

export function StatusDot({ status }: { status: SessionStatus }): React.JSX.Element {
  return (
    <span
      className={`dot${status === 'working' ? ' pulse' : ''}${status === 'waiting' ? ' halo' : ''}`}
      style={{ background: `var(${STATUS_COLOR_VAR[status]})` }}
      title={`${STATUS_LABEL[status]} — ${STATUS_HINT[status]}`}
    />
  );
}
