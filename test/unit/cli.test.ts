/**
 * CLI formatting helpers (`src/cli/index.ts`). `formatAge` here is a separate
 * implementation from the renderer's (compact, no " ago" suffix, for fixed-width table
 * columns) but must share the same "ages under 5s read 'just now'" threshold — see the
 * renderer's equivalent test in `presentation.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { formatAge } from '../../src/cli/format.ts';

describe('cli formatAge', () => {
  it('returns "just now" just under the 5s boundary (4999ms)', () => {
    expect(formatAge(4999)).toBe('just now');
  });

  it('switches to normal "Ns" formatting at the 5s boundary (5000ms)', () => {
    expect(formatAge(5000)).toBe('5s');
  });
});
