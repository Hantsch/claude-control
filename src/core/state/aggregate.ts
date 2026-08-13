/**
 * Tray aggregation (§6.5) and project/branch grouping (F10).
 */

import type { SessionStatus, TrayState } from '../model/status.ts';
import { TRAY_URGENCY_ORDER, needsAttention } from '../model/status.ts';
import type { ProjectRef, SessionView } from '../model/types.ts';

/**
 * A session in `waiting` or `done` that the user has already acknowledged. It is still in
 * that state, but it is no longer *news*, so it must not keep the tray lit — otherwise the
 * icon claims something is open with no way to dismiss it.
 */
function isSeenAttention(session: SessionView): boolean {
  return needsAttention(session.status) && session.seen;
}

/** Icon colour = most urgent state present: waiting > done > working > idle > none (§6.5). */
export function trayStateFor(sessions: readonly SessionView[]): TrayState {
  const present = new Set<SessionStatus>(
    sessions.filter((s) => !isSeenAttention(s)).map((s) => s.status),
  );
  for (const candidate of TRAY_URGENCY_ORDER) {
    if (present.has(candidate)) return candidate;
  }
  return 'none';
}

/** Badge count = unacknowledged sessions in `waiting` or `done`; empty badge at zero (§6.5). */
export function attentionCount(sessions: readonly SessionView[]): number {
  return sessions.filter((s) => needsAttention(s.status) && !s.seen).length;
}

export interface BranchGroup {
  /** Branch, worktree name, or null when the transcript carried no branch. */
  branch: string | null;
  sessions: SessionView[];
}

export interface ProjectGroup {
  project: ProjectRef;
  branches: BranchGroup[];
  sessions: SessionView[];
  /** Most urgent state inside the group, for the group header. */
  trayState: TrayState;
  attention: number;
}

/** Sessions grouped by project → branch/worktree (F10, §8 "Sessions"). */
export function groupSessions(sessions: readonly SessionView[]): ProjectGroup[] {
  const byProject = new Map<string, ProjectGroup>();

  for (const session of sessions) {
    let group = byProject.get(session.project.key);
    if (!group) {
      group = {
        project: session.project,
        branches: [],
        sessions: [],
        trayState: 'none',
        attention: 0,
      };
      byProject.set(session.project.key, group);
    }
    group.sessions.push(session);

    const branchKey = session.branch ?? null;
    let branchGroup = group.branches.find((b) => b.branch === branchKey);
    if (!branchGroup) {
      branchGroup = { branch: branchKey, sessions: [] };
      group.branches.push(branchGroup);
    }
    branchGroup.sessions.push(session);
  }

  const groups = [...byProject.values()];
  for (const group of groups) {
    group.trayState = trayStateFor(group.sessions);
    group.attention = attentionCount(group.sessions);
    group.sessions.sort(compareSessions);
    group.branches.sort((a, b) => (a.branch ?? '').localeCompare(b.branch ?? ''));
    for (const branch of group.branches) branch.sessions.sort(compareSessions);
  }

  // Projects that need attention float to the top; otherwise alphabetical, so the list
  // does not reshuffle on every tick.
  groups.sort((a, b) => {
    if (a.attention !== b.attention) return b.attention - a.attention;
    return a.project.name.localeCompare(b.project.name);
  });
  return groups;
}

const STATUS_SORT_RANK: Record<SessionStatus, number> = {
  waiting: 0,
  done: 1,
  working: 2,
  queued: 3,
  idle: 4,
  starting: 5,
  unknown: 6,
  ended: 7,
};

export function compareSessions(a: SessionView, b: SessionView): number {
  const rank = STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status];
  if (rank !== 0) return rank;
  return (b.lastActivityAt ?? b.startedAt) - (a.lastActivityAt ?? a.startedAt);
}

/** Distinct projects across a session list, for the project filter (F8). */
export function distinctProjects(sessions: readonly { project: ProjectRef }[]): ProjectRef[] {
  const byKey = new Map<string, ProjectRef>();
  for (const session of sessions) {
    if (!byKey.has(session.project.key)) byKey.set(session.project.key, session.project);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
