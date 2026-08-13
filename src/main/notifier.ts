/**
 * Windows toasts (M3, F5, §6.6).
 *
 * The *decision* whether to notify lives in `core/state/notifications.ts` so it is testable
 * without Electron; this file only renders it. Body: session name, project, branch, and
 * either the last assistant sentence (`done`) or the pending tool name (`waiting`).
 * Activating the toast triggers F6.
 *
 * No sound, and no suppression-when-focused rule, in v1.
 */

import { Notification } from 'electron';
import type { NotificationSettings } from '../core/model/settings.ts';
import { STATUS_LABEL } from '../core/model/status.ts';
import type { SessionId, StatusTransition } from '../core/model/types.ts';
import { NotificationGate, firstSentence } from '../core/state/notifications.ts';
import { clampLabel, sessionLabel } from '../shared/presentation.ts';

export interface NotifierDeps {
  settings: () => NotificationSettings;
  /** Invoked when the user activates a toast (F6). */
  onActivate: (sessionId: SessionId) => void;
}

export class Notifier {
  private readonly deps: NotifierDeps;
  private readonly gate = new NotificationGate();

  constructor(deps: NotifierDeps) {
    this.deps = deps;
  }

  handle(transitions: readonly StatusTransition[]): void {
    const settings = this.deps.settings();
    for (const transition of transitions) {
      if (this.gate.evaluate(transition, settings).notify) this.show(transition);
    }
  }

  private show(transition: StatusTransition): void {
    if (!Notification.isSupported()) return;
    const view = transition.view;
    const where = [view.project.name, view.branch].filter(Boolean).join(' · ');
    const detail =
      transition.to === 'waiting'
        ? view.pendingTool
          ? `${view.pendingTool.name} has been pending${view.pendingTool.hint ? `: ${view.pendingTool.hint}` : ''}`
          : 'A fast tool is overdue — probably a prompt waiting for you'
        : (firstSentence(view.lastAssistantText) ?? 'Turn finished');

    const notification = new Notification({
      title: `${clampLabel(sessionLabel(view), 40)} — ${STATUS_LABEL[transition.to]}`,
      body: `${where}\n${detail}`,
      silent: true,
      timeoutType: 'default',
    });
    notification.on('click', () => this.deps.onActivate(transition.sessionId));
    notification.show();
  }
}
