/**
 * The popover's initial-focus decision (story 012, D6), split out of `popover.tsx` so it can be
 * tested at all: vitest runs `environment: 'node'` with no jsdom and no testing-library, so a
 * React render test would mean adding a whole test environment for one regression. Hence a pure
 * function of plain booleans — no DOM and no React types cross this boundary; `popover.tsx`
 * reduces `document.activeElement` to those booleans at the call site.
 */

/**
 * Whether the popover's initial/retry focus pass (story 003) may move focus onto the top session
 * row. It must keep retrying while focus is nowhere meaningful yet — the document body, or
 * already somewhere inside the row list itself — because on the very first open of an app run the
 * mount-time pass finds zero rows (`state` is still `EMPTY_STATE`) and only the `[state]` retry
 * gets there. But it must never *take* focus away from a control the user deliberately parked it
 * on outside the list (Pin, Close, the notify switch).
 *
 * Story 012 residual C: with zero sessions open and focus on Pin or Close, the first session that
 * ever arrived used to yank focus onto its row. This is the guard that stops it.
 *
 * Only the "not focused yet" branch of that effect asks this. The separate restoration path from
 * story 010 (focused row vanished from the new snapshot ⇒ focus the top row again) is driven by
 * the remembered nav key and is deliberately not routed through here — which is why `focusedYet`
 * is an outright `false`: once a row has been focused this open, this pass is done.
 */
export function shouldFocusTopRow(input: {
  /** Has a row been successfully focused since the popover was last opened? */
  focusedYet: boolean;
  /**
   * Is `document.activeElement` the document body, the document root, or nothing at all — i.e.
   * has nothing been deliberately focused?
   */
  activeElementIsBody: boolean;
  /** Is `document.activeElement` already inside the row list? */
  activeElementIsInList: boolean;
}): boolean {
  if (input.focusedYet) return false;
  return input.activeElementIsBody || input.activeElementIsInList;
}
