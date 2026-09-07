import type { GroupStatusCount } from '../../core/state/aggregate.ts';
import { STATUS_LABEL } from '../../shared/presentation.ts';
import { StatusDot } from './StatusDot.tsx';

/**
 * A project group's status rollup — one small coloured dot plus a count per status present,
 * in the order core already put them (`STATUS_SORT_RANK`, zero counts omitted).
 *
 * Shared between the popover's group head and the main window's, so the two surfaces cannot
 * drift into showing the same group differently. The component deliberately owns no counting
 * logic: it maps over `ProjectGroup.statusCounts`, which `groupSessions()` computed once in
 * core, where it is reachable by unit tests — the renderer has no render harness (vitest runs
 * without jsdom here), so anything with rules in it does not belong in JSX.
 */
export function StatusRollup({ counts }: { counts: GroupStatusCount[] }): React.JSX.Element {
  return (
    <span className="rollup">
      {counts.map((entry) => (
        <span key={entry.status} title={`${entry.count}× ${STATUS_LABEL[entry.status]}`}>
          <StatusDot status={entry.status} size="sm" />
          <span className="n">{entry.count}</span>
        </span>
      ))}
    </span>
  );
}
