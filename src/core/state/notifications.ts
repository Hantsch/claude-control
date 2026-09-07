/**
 * Notification discipline (§6.6) as a pure decision, so it can be tested without Electron.
 * `main/notifier.ts` only turns a `NotifyDecision` into a toast.
 */

import type { NotificationSettings } from '../model/settings.ts';
import { isNotifyingStatus } from '../model/status.ts';
import type { SessionId, StatusTransition } from '../model/types.ts';

export type NotifySkipReason =
  | 'seeded'
  | 'session-muted'
  | 'disabled'
  | 'status-not-notifying'
  | 'status-muted'
  | 'cooldown';

export interface NotifyDecision {
  notify: boolean;
  reason: NotifySkipReason | 'transition';
}

/**
 * A toast fires **only on a transition into** `waiting` or `done`, and only once per
 * session per cooldown window. `lastNotifiedAt` is null when the session has never
 * notified.
 */
export function decideNotification(
  transition: StatusTransition,
  lastNotifiedAt: number | null,
  settings: NotificationSettings,
  muted = false,
): NotifyDecision {
  // Startup seeding is silent: no burst of six toasts because the app just launched.
  if (transition.seeded) return { notify: false, reason: 'seeded' };
  // An explicit per-session mute is a deliberate user override, so it is checked ahead of
  // the global settings — muting one noisy session must not depend on how the rest are set.
  if (muted) return { notify: false, reason: 'session-muted' };
  if (!settings.enabled) return { notify: false, reason: 'disabled' };
  if (!isNotifyingStatus(transition.to)) return { notify: false, reason: 'status-not-notifying' };
  if (transition.to === 'done' && !settings.onDone) return { notify: false, reason: 'status-muted' };
  if (transition.to === 'waiting' && !settings.onWaiting) {
    return { notify: false, reason: 'status-muted' };
  }
  if (lastNotifiedAt !== null && transition.at - lastNotifiedAt < settings.cooldownMs) {
    // done → working → done inside the cooldown therefore notifies exactly once.
    return { notify: false, reason: 'cooldown' };
  }
  return { notify: true, reason: 'transition' };
}

/**
 * First sentence of the assistant's last message — the body of a `done` toast (§6.6).
 * Capped so a long paragraph cannot become an unreadable toast.
 */
export function firstSentence(text: string | null, maxChars = 160): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const match = new RegExp(`^(.{1,${maxChars}}?[.!?])(\\s|$)`).exec(normalized);
  if (match) return match[1]!;
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1).trimEnd()}…` : normalized;
}

/** Tracks the cooldown per session. Pure bookkeeping, no I/O. */
export class NotificationGate {
  private readonly lastNotifiedAt = new Map<SessionId, number>();

  evaluate(transition: StatusTransition, settings: NotificationSettings, muted = false): NotifyDecision {
    const decision = decideNotification(
      transition,
      this.lastNotifiedAt.get(transition.sessionId) ?? null,
      settings,
      muted,
    );
    if (decision.notify) this.lastNotifiedAt.set(transition.sessionId, transition.at);
    // A session that ended can start fresh if its id ever reappears.
    if (transition.to === 'ended') this.lastNotifiedAt.delete(transition.sessionId);
    return decision;
  }

  forget(sessionId: SessionId): void {
    this.lastNotifiedAt.delete(sessionId);
  }
}
