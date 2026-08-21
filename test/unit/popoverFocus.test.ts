/**
 * The popover's initial-focus decision (story 012, D6). Same reason as `popoverModel.test.ts`:
 * there is no render harness here — vitest runs without jsdom — so the rule is covered as a pure
 * function of booleans, with `popover.tsx` reducing `document.activeElement` to them at the call
 * site.
 */

import { describe, expect, it } from 'vitest';
import { shouldFocusTopRow } from '../../src/renderer/lib/popoverFocus.ts';

describe('shouldFocusTopRow', () => {
  it('focuses the top row when nothing has been focused yet and focus sits on the body', () => {
    expect(
      shouldFocusTopRow({
        focusedYet: false,
        activeElementIsBody: true,
        activeElementIsInList: false,
      }),
    ).toBe(true);
  });

  it('leaves focus alone when it sits on a control outside the list (Pin, Close)', () => {
    // The residual-C bug: zero sessions open, focus parked on Pin or Close, then the first
    // session arrives — it must not yank focus onto its row.
    expect(
      shouldFocusTopRow({
        focusedYet: false,
        activeElementIsBody: false,
        activeElementIsInList: false,
      }),
    ).toBe(false);
  });

  it('keeps retrying while focus is already inside the row list', () => {
    // The popover window is reused, so on reopen a row from the previous open can still be
    // `document.activeElement` — that must not block the initial focus pass.
    expect(
      shouldFocusTopRow({
        focusedYet: false,
        activeElementIsBody: false,
        activeElementIsInList: true,
      }),
    ).toBe(true);
  });

  it('never fires once a row has been focused this open, whatever focus does', () => {
    // Which is what leaves the "focused row dropped out of `traySessions`" case (story 010) to
    // the separate restoration branch of the effect — it never reaches this helper's `true` path.
    for (const activeElementIsBody of [false, true]) {
      for (const activeElementIsInList of [false, true]) {
        expect(
          shouldFocusTopRow({ focusedYet: true, activeElementIsBody, activeElementIsInList }),
        ).toBe(false);
      }
    }
  });
});
