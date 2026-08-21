/**
 * Presentation constants shared by the tray, the toasts and the renderer, so the wording
 * of a status can never drift between the three surfaces.
 *
 * Pure data — no Node, no Electron, no DOM.
 */

import type { ContextBand, SubagentStatus } from '../core/model/types.ts';
import type { SessionStatus } from '../core/model/status.ts';

export { STATUS_LABEL } from '../core/model/status.ts';

/** CSS custom-property name per status, defined in `renderer/styles.css`. */
export const STATUS_COLOR_VAR: Record<SessionStatus, string> = {
  waiting: '--status-waiting',
  done: '--status-done',
  stale: '--status-stale',
  working: '--status-working',
  queued: '--status-queued',
  starting: '--status-starting',
  ended: '--status-ended',
  unknown: '--status-unknown',
};

/**
 * CSS custom-property name per `SubagentStatus` (story 010 D5), for the popover's subagent
 * status dot. There is no `SubagentStatus` equivalent of `STATUS_COLOR_VAR` elsewhere — this
 * is that table. `launched` and `unknown` share the neutral faint colour: `launched` has no
 * observable end (§8), and `unknown` is a state we cannot colour honestly either way.
 */
export const SUBAGENT_STATUS_COLOR_VAR: Record<SubagentStatus, string> = {
  running: '--status-working',
  launched: '--text-faint',
  completed: '--status-done',
  failed: '--band-red',
  unknown: '--text-faint',
};

/** One-line explanation shown in tooltips — both overdue states carry the caveat (§6.3). */
export const STATUS_HINT: Record<SessionStatus, string> = {
  working: 'The model is producing output, or a tool or subagent is executing.',
  waiting:
    'A tool that normally finishes in seconds has produced no result for much longer than ' +
    'that — usually a permission prompt or a question waiting for you. Transcript watching ' +
    'cannot see the prompt itself, so this is a heuristic.',
  stale:
    'A tool that is slow by nature (Bash, a subagent, a workflow) is running well past its ' +
    'usual budget. Most likely it is simply still working — this is a hint that it may be ' +
    'worth a look, not a claim that anything failed.',
  done: 'The turn finished and control is back with you.',
  queued: 'A prompt is enqueued and has not started yet.',
  starting:
    'The session is open but has not exchanged a single message yet — a freshly opened ' +
    'Claude Code window looks like this until the first prompt.',
  ended: 'The process is no longer alive; the session moved to history.',
  unknown:
    'The transcript could not be read, or its tail window held no user/assistant record. ' +
    'This is a reading problem, not a claim about the session.',
};

/**
 * How a *finished* session's last derived state reads in the history table. The state
 * vocabulary is the same, but "working" for a session that is over means it was cut off
 * mid-turn, and saying that plainly avoids a confusing label.
 */
export const HISTORY_FINAL_LABEL: Record<SessionStatus, string> = {
  done: 'done',
  working: 'ended mid-turn',
  waiting: 'ended on a prompt',
  stale: 'ended mid-tool',
  queued: 'prompt still queued',
  // `deriveHistoricalStatus` only reaches `unknown` when the transcript held no
  // user/assistant record at all, so that is what the history table should say.
  starting: 'never used',
  ended: 'ended',
  unknown: 'no messages',
};

/** Context-pressure band → indicator, per the §6.4 thresholds. */
export const BAND_SYMBOL: Record<ContextBand, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  critical: '⚠️',
};

/** CSS custom-property name per band, so the gauge and the list rows cannot drift apart. */
export const BAND_COLOR_VAR: Record<ContextBand, string> = {
  green: '--band-green',
  yellow: '--band-yellow',
  red: '--band-red',
  critical: '--band-critical',
};

export const BAND_LABEL: Record<ContextBand, string> = {
  green: 'below 60 %',
  yellow: '60–80 %',
  red: '80–92 %',
  critical: 'above 92 %',
};

/**
 * How a session is named on every surface. Claude Code's own slug (`hantsch-mmo-dc`) is
 * never shown inside the IDE, so a row here could not be matched to a VS Code tab by it.
 * The generated title is what VS Code puts on the Claude Code panel and in its history, so
 * that comes first; the slug is the fallback for sessions that have no title yet.
 */
export function sessionLabel(view: { name: string; title?: string | null }): string {
  return view.title?.trim() || view.name;
}

/** Single-line label for the tray and the toasts, where long titles must not wrap. */
export function clampLabel(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * A declared model on an `Agent` tool call (story 011 D2's `declaredModelOf`) is one of these
 * four tier aliases, never a resolved model id — `subagent_type`'s sibling `model` key takes
 * only this vocabulary. Kept as its own set so `modelDisplayName` can special-case it before
 * falling into the `claude-…` id parsing below, which would otherwise leave it untouched (it
 * does not start with `claude-`) and print the raw lowercase alias next to a resolved model's
 * full display name, e.g. `opus` beside `Opus 5 · 1M` (011 Decisions (Sprint)).
 */
const TIER_ALIASES = new Set(['opus', 'sonnet', 'haiku', 'fable']);

/**
 * How a raw model id (`us.anthropic.claude-opus-5`, `claude-opus-5[1m]`, …) reads on the
 * tray and popover, instead of the API's dotted/bracketed wire form.
 *
 * Steps:
 *  0. A bare tier alias (`opus`, `sonnet`, `haiku`, `fable`) — the vocabulary a declared
 *     `model` on an `Agent` call uses — is title-cased directly (`opus` → `Opus`) and
 *     returned; it never reaches the `claude-…` id parsing below (story 011 D4).
 *  1. Strip everything up to and including the *last* `.` (drops a vendor/region prefix
 *     such as `us.anthropic.`).
 *  2. Split off a trailing `[...]` suffix (e.g. `[1m]`), if present.
 *  3. If what remains doesn't start with `claude-`, the shape is unrecognised — return the
 *     original input verbatim, unchanged.
 *  4. Drop the `claude-` prefix, then title-case each hyphen-separated word (digits pass
 *     through as-is) and join with spaces.
 *  5. Re-append the bracketed suffix, upper-cased, separated by ` · ` (e.g. ` · 1M`).
 *
 * `null` or a blank/whitespace-only string yields `null`. Never throws.
 */
export function modelDisplayName(modelId: string | null | undefined): string | null {
  if (modelId == null) return null;
  const trimmed = modelId.trim();
  if (trimmed === '') return null;
  if (TIER_ALIASES.has(trimmed)) return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

  const lastDot = modelId.lastIndexOf('.');
  const afterDot = lastDot >= 0 ? modelId.slice(lastDot + 1) : modelId;

  const suffixMatch = afterDot.match(/^(.*)\[([^\]]*)\]$/);
  const base = suffixMatch ? (suffixMatch[1] ?? '') : afterDot;
  const suffix = suffixMatch ? (suffixMatch[2] ?? '') : null;

  if (!base.startsWith('claude-')) return modelId;

  const words = base.slice('claude-'.length).split('-').filter((w) => w.length > 0);
  if (words.length === 0) return modelId;

  const titled = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return suffix ? `${titled} · ${suffix.toUpperCase()}` : titled;
}
