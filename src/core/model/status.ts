/**
 * Session status model — CONCEPT.md §6.1.
 *
 * These seven states are the whole vocabulary of the app. Everything the tray, the
 * notifier and the UI show is a projection of them.
 */

export const SESSION_STATUSES = [
  'working',
  'waiting',
  'done',
  'idle',
  'queued',
  'ended',
  'unknown',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** States a toast may fire for (§6.1 "Notification" column, §6.6). */
export const NOTIFYING_STATUSES: readonly SessionStatus[] = ['waiting', 'done'];

/** States that count towards the tray overlay badge (§6.5). */
export const ATTENTION_STATUSES: readonly SessionStatus[] = ['waiting', 'done'];

/**
 * Tray icon colour = most urgent state present, in the order
 * `waiting` > `done` > `working` > `idle` > none (§6.5).
 *
 * `queued`, `unknown` and `ended` deliberately do not influence the icon: the concept
 * names exactly these four tiers, and none of the three is a claim about urgency.
 */
export const TRAY_URGENCY_ORDER = ['waiting', 'done', 'working', 'idle'] as const;

export type TrayState = (typeof TRAY_URGENCY_ORDER)[number] | 'none';

export function isNotifyingStatus(status: SessionStatus): boolean {
  return NOTIFYING_STATUSES.includes(status);
}

export function needsAttention(status: SessionStatus): boolean {
  return ATTENTION_STATUSES.includes(status);
}

/**
 * Label used in the UI. `waiting` is intentionally hedged — transcript watching cannot
 * see a permission prompt, so the UI must not overclaim (§6.3).
 */
export const STATUS_LABEL: Record<SessionStatus, string> = {
  working: 'working',
  waiting: 'probably waiting',
  done: 'done',
  idle: 'idle',
  queued: 'queued',
  ended: 'ended',
  unknown: 'unknown',
};
