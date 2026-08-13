/**
 * Session status model — CONCEPT.md §6.1.
 *
 * These eight states are the whole vocabulary of the app. Everything the tray, the
 * notifier and the UI show is a projection of them.
 *
 * A status answers **what is going on**, never **how long ago it was**: the age column
 * already says the latter, and a status that decays over time made every finished session
 * read as `idle` after 15 minutes — which is why the old `idle` state is gone. A turn that
 * ended stays `done`; whether that `done` is still worth showing is a *list* question,
 * answered by `isTrayWorthy` in `state/aggregate.ts`, not a state-machine question.
 *
 * `waiting` and `stale` split what used to be one over-claiming `waiting`. Both mean "a tool
 * call is overdue", but the two cases are worth very different reactions (§6.3):
 *
 *   - a *fast* tool (Read, Edit, Grep — normally seconds) that is overdue is almost always a
 *     permission prompt or a question waiting for you → `waiting`, notifies;
 *   - a *slow* tool (Bash, Agent, Workflow) that is overdue is usually still running fine,
 *     just longer than usual → `stale`, visible but silent. It does not claim anything is
 *     broken; it claims something might be worth a look.
 *
 * `starting` is the one addition to the concept's original seven: a session that the
 * registry knows about but whose transcript holds no user/assistant record *at all* is not
 * an unreadable session, it is one that has not been used yet — every freshly opened Claude
 * Code window looks like this until the first prompt. `unknown` is kept for what it was
 * meant for: the transcript could not be read, or its tail window held no answer.
 */

export const SESSION_STATUSES = [
  'working',
  'waiting',
  'stale',
  'done',
  'queued',
  'starting',
  'ended',
  'unknown',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * States a toast may fire for (§6.1 "Notification" column, §6.6).
 *
 * `stale` deliberately stays out: it says "this might be odd", and interrupting for a maybe
 * is exactly how a notification channel gets muted.
 */
export const NOTIFYING_STATUSES: readonly SessionStatus[] = ['waiting', 'done'];

/** States that count towards the tray overlay badge (§6.5). */
export const ATTENTION_STATUSES: readonly SessionStatus[] = ['waiting', 'done'];

/**
 * Tray icon colour = most urgent state present, in the order
 * `waiting` > `done` > `stale` > `working` > none (§6.5).
 *
 * `stale` outranks `working` because it is the one of the two that might want a look, and
 * ranks below `done` because a finished turn is a certainty while `stale` is a suspicion.
 * `queued`, `starting`, `unknown` and `ended` deliberately do not influence the icon: none
 * of the four is a claim about urgency.
 */
export const TRAY_URGENCY_ORDER = ['waiting', 'done', 'stale', 'working'] as const;

export type TrayState = (typeof TRAY_URGENCY_ORDER)[number] | 'none';

/**
 * Which tile the tray shows. The urgency order collapses everything to one winner, which is
 * right for a colour but loses one pair worth distinguishing: a turn that finished while
 * other sessions are still running. `done` alone would claim the whole set is settled, so
 * that pair gets its own icon (`trayIconFor` in `state/aggregate.ts`).
 */
export type TrayIcon = TrayState | 'mixed';

export function isNotifyingStatus(status: SessionStatus): boolean {
  return NOTIFYING_STATUSES.includes(status);
}

export function needsAttention(status: SessionStatus): boolean {
  return ATTENTION_STATUSES.includes(status);
}

/**
 * Label used in the UI. Both overdue states are intentionally hedged — transcript watching
 * cannot see a permission prompt, so the UI must not overclaim (§6.3). `stale` is the softer
 * of the two on purpose: it does not say the tool failed, only that it is taking longer than
 * that tool usually does.
 */
export const STATUS_LABEL: Record<SessionStatus, string> = {
  working: 'working',
  waiting: 'needs you?',
  stale: 'stale',
  done: 'done',
  queued: 'queued',
  starting: 'no prompt yet',
  ended: 'ended',
  unknown: 'unreadable',
};
