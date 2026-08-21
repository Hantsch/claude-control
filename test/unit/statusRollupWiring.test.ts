/**
 * Story 006 D3 — guards that the main window's group header and the popover's group head
 * keep rendering the same status rollup via the shared `StatusRollup` component, rather than
 * one of them silently regrowing its own per-status counting logic (which is how the two
 * surfaces would drift apart again). This is a source-level check, not a render test: the
 * renderer has no render harness here (vitest runs without jsdom), so the only thing a unit
 * test can assert about JSX is what its source text says.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SESSIONS_VIEW = new URL(
  '../../src/renderer/components/SessionsView.tsx',
  import.meta.url,
).pathname.replace(/^\/([a-zA-Z]:)/, '$1');

const POPOVER = new URL('../../src/renderer/popover.tsx', import.meta.url).pathname.replace(
  /^\/([a-zA-Z]:)/,
  '$1',
);

const STATUS_ROLLUP_IMPORT = /from\s+['"]\.\/(?:components\/)?StatusRollup(?:\.tsx)?['"]/;

/** A `Map` keyed by a per-status count would be the tell of a reintroduced private rollup. */
const OWN_COUNTING = /new Map<SessionStatus/;

describe('StatusRollup wiring (story 006 D3)', () => {
  it('SessionsView imports and uses the shared StatusRollup', () => {
    const source = readFileSync(SESSIONS_VIEW, 'utf8');
    expect(source).toMatch(STATUS_ROLLUP_IMPORT);
    expect(source).toContain('<StatusRollup');
    expect(source).not.toMatch(OWN_COUNTING);
  });

  it('popover imports and uses the shared StatusRollup', () => {
    const source = readFileSync(POPOVER, 'utf8');
    expect(source).toMatch(STATUS_ROLLUP_IMPORT);
    expect(source).toContain('<StatusRollup');
    expect(source).not.toMatch(OWN_COUNTING);
  });
});
