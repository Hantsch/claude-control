/**
 * Live session list, grouped by project → branch/worktree (F1, F2, F10, §8).
 */

import { useEffect, useRef } from 'react';
import type { AppState, ProjectGroup, SessionView } from '../../shared/ipc.ts';
import { STATUS_LABEL, sessionLabel } from '../../shared/presentation.ts';
import { api } from '../api.ts';
import { formatAge } from '../lib/format.ts';
import { ContextBar } from './ContextBar.tsx';
import { StatusDot } from './StatusDot.tsx';
import { StatusRollup } from './StatusRollup.tsx';

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
          A session appears here once it has exchanged its first message. Windows that are
          open but unused are hidden — Settings can show them again.
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
        <StatusRollup counts={group.statusCounts} />
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
  const row = useRef<HTMLDivElement>(null);
  // A session selected from somewhere else — "Show in Claude Control" on a popover row — is
  // usually not the one on screen, so bring it there. `nearest` makes this a no-op for a row
  // that is already visible, which is every selection the user made by clicking.
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const age = session.lastActivityAt ? Date.now() - session.lastActivityAt : null;
  // Unseen only means something for the two states the badge counts; a working session is
  // not something you can have "missed".
  const unseen = !session.seen && (session.status === 'done' || session.status === 'waiting');

  const activate = (): void => onActivate(session);
  const select = (): void => onSelect(session);

  const toggleMuted = (event: React.SyntheticEvent): void => {
    // The mute button is nested inside the row's div-as-button — stop the click here or it
    // would also fire the row's onClick (select) right after toggling mute.
    event.stopPropagation();
    void api.setSessionMuted(session.sessionId, !session.muted);
  };

  return (
    <div
      ref={row}
      role="button"
      tabIndex={0}
      className={`session-row${selected ? ' selected' : ''}${unseen ? ' unseen' : ''}${session.muted ? ' muted' : ''}`}
      onClick={select}
      onDoubleClick={activate}
      onKeyDown={(event) => {
        // Preserve the button-like keyboard behaviour a plain <div role="button"> does not
        // get for free — but only for the row itself: bail out if the keydown bubbled up from
        // the nested mute-toggle <button> so its own native Enter/Space activation is not
        // suppressed (and replaced by "select the row") by this handler.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      }}
      title={session.statusReason}
    >
      <StatusDot status={session.status} />
      <span className="name" title={sessionLabel(session)}>
        {sessionLabel(session)}
        <span className="slug">{session.name}</span>
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
      <ContextBar context={session.context} />
      <button
        type="button"
        className={`mute-toggle${session.muted ? ' on' : ''}`}
        onClick={toggleMuted}
        onDoubleClick={(event) => event.stopPropagation()}
        title={session.muted ? 'Unmute this session' : 'Mute this session'}
        aria-pressed={session.muted}
      >
        {session.muted ? '🔇' : '🔔'}
      </button>
    </div>
  );
}
