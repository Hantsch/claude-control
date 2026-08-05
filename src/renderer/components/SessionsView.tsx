/**
 * Live session list, grouped by project → branch/worktree (F1, F2, F10, §8).
 */

import type { AppState, ProjectGroup, SessionView } from '../../shared/ipc.ts';
import { STATUS_LABEL } from '../../shared/presentation.ts';
import { formatAge } from '../lib/format.ts';
import { StatusDot } from './StatusDot.tsx';

export interface SessionsViewProps {
  state: AppState;
  /** Session shown in the detail pane; may be the implicit default (see `App`). */
  selectedId: string | null;
  projectFilter: string | null;
  onSelect: (session: SessionView) => void;
  onActivate: (session: SessionView) => void;
}

export function SessionsView({
  state,
  selectedId,
  projectFilter,
  onSelect,
  onActivate,
}: SessionsViewProps): React.JSX.Element {
  const groups = projectFilter
    ? state.groups.filter((group) => group.project.key === projectFilter)
    : state.groups;

  if (groups.length === 0) {
    return (
      <div className="empty">
        No live Claude Code sessions.
        <br />
        <span className="estimate">
          Sessions appear here as soon as `~/.claude/sessions/&lt;pid&gt;.json` exists for them.
        </span>
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <ProjectGroupBlock
          key={group.project.key}
          group={group}
          selectedId={selectedId}
          onSelect={onSelect}
          onActivate={onActivate}
        />
      ))}
    </>
  );
}

function ProjectGroupBlock({
  group,
  selectedId,
  onSelect,
  onActivate,
}: {
  group: ProjectGroup;
  selectedId: string | null;
  onSelect: (session: SessionView) => void;
  onActivate: (session: SessionView) => void;
}): React.JSX.Element {
  return (
    <div className="project-group">
      <div className="project-header">
        <span className="name">{group.project.name}</span>
        <span className="path" title={group.project.path}>
          {group.project.path}
        </span>
        <span className="count">
          {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
          {group.attention > 0 ? ` · ${group.attention} need attention` : ''}
        </span>
      </div>
      {group.branches.map((branch) => (
        <div className="branch-group" key={branch.branch ?? '(none)'}>
          <div className="branch-label">{branch.branch ?? 'no branch recorded'}</div>
          {branch.sessions.map((session) => (
            <SessionRow
              key={session.sessionId}
              session={session}
              selected={session.sessionId === selectedId}
              onSelect={onSelect}
              onActivate={onActivate}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
  onActivate,
}: {
  session: SessionView;
  selected: boolean;
  onSelect: (session: SessionView) => void;
  onActivate: (session: SessionView) => void;
}): React.JSX.Element {
  const age = session.lastActivityAt ? Date.now() - session.lastActivityAt : null;
  const context = session.context ? `${Math.round(session.context.ratio * 100)}%` : '—';

  return (
    <button
      type="button"
      className={`session-row${selected ? ' selected' : ''}`}
      onClick={() => onSelect(session)}
      onDoubleClick={() => onActivate(session)}
      title={session.statusReason}
    >
      <StatusDot status={session.status} />
      <span className="name">
        {session.name}
        {session.title && <span className="title">{session.title}</span>}
      </span>
      <span className="status">
        {STATUS_LABEL[session.status]}
        {session.pendingTool && (
          <span className="title" title={session.pendingTool.hint ?? undefined}>
            {session.pendingTool.name}
            {session.subagents.some((node) => node.status === 'running') ? ' · subagent' : ''}
          </span>
        )}
      </span>
      <span className="age">{formatAge(age)}</span>
      <span className="ctx" title="Context pressure (estimate)">
        {context}
      </span>
    </button>
  );
}
