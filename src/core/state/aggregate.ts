/**
 * Tray aggregation (§6.5) and project/branch grouping (F10).
 */

import type { SessionStatus, TrayIcon, TrayState } from '../model/status.ts';
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

/** Icon colour = most urgent state present: waiting > done > stale > working > none (§6.5). */
export function trayStateFor(sessions: readonly SessionView[]): TrayState {
  const present = new Set<SessionStatus>(
    sessions.filter((s) => !isSeenAttention(s)).map((s) => s.status),
  );
  for (const candidate of TRAY_URGENCY_ORDER) {
    if (present.has(candidate)) return candidate;
  }
  return 'none';
}

/**
 * Which tile the tray shows — the urgency colour, plus the one case a single winner cannot
 * express: a finished turn while something else is still running.
 *
 * Only `done` + `working` gets the mixed tile. `stale` deliberately keeps the plain `done`
 * tile: the mixed art says "still busy" with the working colour, and claiming that for a
 * session that is merely overdue would overstate what is known about it (§6.3).
 */
export function trayIconFor(sessions: readonly SessionView[]): TrayIcon {
  const state = trayStateFor(sessions);
  if (state !== 'done') return state;
  return sessions.some((session) => session.status === 'working') ? 'mixed' : 'done';
}

/** Badge count = unacknowledged sessions in `waiting` or `done`; empty badge at zero (§6.5). */
export function attentionCount(sessions: readonly SessionView[]): number {
  return sessions.filter((s) => needsAttention(s.status) && !s.seen).length;
}

/** A turn is in flight — the session is doing something right now, at any age. */
const ONGOING_STATUSES = new Set<SessionStatus>(['working', 'waiting', 'stale', 'queued']);

/**
 * Does this session belong on the *tray* surfaces — the popover and the tray menu (§6.5)?
 *
 * The tray answers "what needs me right now", so it is not the live list minus nothing; it
 * is the live list minus what has been settled and acknowledged. Three ways in:
 *
 *   1. something is in flight (`working`, `waiting`, `stale`, `queued`) — age is irrelevant,
 *      a subagent that has been running for two hours is still the most interesting row
 *      there is;
 *   2. it wants attention and has not been acknowledged — a `done` you have not seen is news
 *      however long it has been sitting there, and dropping it would lose the result;
 *   3. it did something recently — the session you were just in stays reachable for a while
 *      even once you have clicked it away.
 *
 * `dismissed` is the user's own veto on rules 2 and 3: "Mark as seen" in the popover means
 * *take this row off the list now*, so it must also beat the recency window — otherwise
 * dismissing the session you just finished would look like it did nothing for the next half
 * hour. It cannot veto rule 1: a session that is still running or is blocked on an answer is
 * not something a dismissal may hide, and the stamp behind `dismissed` re-arms on the next
 * status change anyway.
 *
 * What this drops is exactly the case that made the popover useless: finished sessions from
 * hours ago that you have already dealt with. They stay in the main window, which is the
 * complete list, and in history once the process ends.
 */
export function isTrayWorthy(session: SessionView, now: number, recentMs: number): boolean {
  if (ONGOING_STATUSES.has(session.status)) return true;
  if (session.dismissed) return false;
  if (needsAttention(session.status) && !session.seen) return true;
  const at = session.lastActivityAt ?? session.startedAt;
  return now - at < recentMs;
}

/**
 * Would "Mark as seen" actually take this row off the tray surfaces? Rule 1 of
 * `isTrayWorthy` outranks a dismissal, so a session that is in flight would come straight
 * back — the popover greys the item out for those rather than offering a no-op.
 */
export function isDismissible(session: SessionView): boolean {
  return !ONGOING_STATUSES.has(session.status);
}

/** How many of these rows "Mark all as seen" would remove — the number on that menu item. */
export function dismissibleCount(sessions: readonly SessionView[]): number {
  return sessions.filter(isDismissible).length;
}

/** The tray surfaces' session list — already sorted by urgency (§6.5). */
export function selectTraySessions(
  sessions: readonly SessionView[],
  now: number,
  recentMs: number,
): SessionView[] {
  return sessions.filter((session) => isTrayWorthy(session, now, recentMs));
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
  statusCounts: GroupStatusCount[];
}

export interface GroupStatusCount {
  status: SessionStatus;
  count: number;
}

/**
 * One entry per distinct `SessionStatus` present in `sessions`, zero-count statuses omitted,
 * for the collapsible group head's rollup (story 010 D3). Ordered by `STATUS_SORT_RANK` rather
 * than first-seen order, so the rollup reads left-to-right in the same urgency order the rows
 * themselves are already sorted by.
 */
export function statusCounts(sessions: readonly SessionView[]): GroupStatusCount[] {
  const counts = new Map<SessionStatus, number>();
  for (const session of sessions) {
    counts.set(session.status, (counts.get(session.status) ?? 0) + 1);
  }

  return (Object.keys(STATUS_SORT_RANK) as SessionStatus[])
    .sort((a, b) => STATUS_SORT_RANK[a] - STATUS_SORT_RANK[b])
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => ({ status, count: counts.get(status)! }));
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
        statusCounts: [],
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
    group.statusCounts = statusCounts(group.sessions);
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

export const STATUS_SORT_RANK: Record<SessionStatus, number> = {
  waiting: 0,
  done: 1,
  stale: 2,
  working: 3,
  queued: 4,
  starting: 5,
  // Below every state that says something is pending: an interrupted session is idle, and
  // the user is the one who stopped it. Above `unknown`/`ended`, which are not sessions
  // asking for anything at all. `ended` stays the highest rank — `popoverGroupRank` uses it
  // as the base of its demoted band.
  interrupted: 6,
  unknown: 7,
  ended: 8,
};

export function compareSessions(a: SessionView, b: SessionView): number {
  const rank = STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status];
  if (rank !== 0) return rank;
  return (b.lastActivityAt ?? b.startedAt) - (a.lastActivityAt ?? a.startedAt);
}

/**
 * Rank of a project group for the *popover's* group order — lower sorts first.
 *
 * It is the lowest effective rank over **all** sessions of the group, not the rank of the
 * first row: an unseen `done` further down a group still makes that project more interesting
 * than one whose only news has already been acknowledged.
 *
 * A session that wants attention but has been seen is demoted below every ordinary status —
 * it is still `waiting`, but it is no longer *news*, so it must not pin its project to the
 * top of the popover forever with no way to dismiss it. The demoted band sits below `ended`
 * and keeps the normal waiting-before-done order inside itself.
 *
 * Deliberately popover-only: `compareSessions` (and with it the row order inside a group and
 * the main window's list) is untouched.
 */
export function popoverGroupRank(group: ProjectGroup): number {
  let rank = Number.POSITIVE_INFINITY;
  for (const session of group.sessions) {
    const base = STATUS_SORT_RANK[session.status];
    const effective = isSeenAttention(session) ? STATUS_SORT_RANK.ended + 1 + base : base;
    if (effective < rank) rank = effective;
  }
  return rank;
}

/** Distinct projects across a session list, for the project filter (F8). */
export function distinctProjects(sessions: readonly { project: ProjectRef }[]): ProjectRef[] {
  const byKey = new Map<string, ProjectRef>();
  for (const session of sessions) {
    if (!byKey.has(session.project.key)) byKey.set(session.project.key, session.project);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
