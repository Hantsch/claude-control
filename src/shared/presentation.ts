/**
 * Presentation constants shared by the tray, the toasts and the renderer, so the wording
 * of a status can never drift between the three surfaces.
 *
 * Pure data — no Node, no Electron, no DOM.
 */

import type { ContextBand } from '../core/model/types.ts';
import type { SessionStatus } from '../core/model/status.ts';

export { STATUS_LABEL } from '../core/model/status.ts';

/** CSS custom-property name per status, defined in `renderer/styles.css`. */
export const STATUS_COLOR_VAR: Record<SessionStatus, string> = {
  waiting: '--status-waiting',
  done: '--status-done',
  working: '--status-working',
  idle: '--status-idle',
  queued: '--status-queued',
  ended: '--status-ended',
  unknown: '--status-unknown',
};

/** One-line explanation shown in tooltips — `waiting` carries the honest caveat (§6.3). */
export const STATUS_HINT: Record<SessionStatus, string> = {
  working: 'The model is producing output or a tool is executing.',
  waiting:
    'A tool call was issued and no result has arrived for longer than that tool normally ' +
    'takes. Transcript watching cannot see a permission prompt, so this is a heuristic.',
  done: 'The turn finished and control is back with you.',
  idle: 'Alive but nothing has happened for a long time — possibly forgotten.',
  queued: 'A prompt is enqueued and has not started yet.',
  ended: 'The process is no longer alive; the session moved to history.',
  unknown: 'The state could not be derived from the transcript.',
};

/**
 * How a *finished* session's last derived state reads in the history table. The state
 * vocabulary is the same, but "working" for a session that is over means it was cut off
 * mid-turn, and saying that plainly avoids a confusing label.
 */
export const HISTORY_FINAL_LABEL: Record<SessionStatus, string> = {
  done: 'done',
  working: 'ended mid-turn',
  waiting: 'was waiting',
  queued: 'prompt still queued',
  idle: 'idle',
  ended: 'ended',
  unknown: 'unknown',
};

/** Context-pressure band → indicator, per the §6.4 thresholds. */
export const BAND_SYMBOL: Record<ContextBand, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  critical: '⚠️',
};

export const BAND_LABEL: Record<ContextBand, string> = {
  green: 'below 60 %',
  yellow: '60–80 %',
  red: '80–92 %',
  critical: 'above 92 %',
};
