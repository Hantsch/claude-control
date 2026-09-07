/**
 * CLI formatting helpers (`src/cli/index.ts`). `formatAge` here is a separate
 * implementation from the renderer's (compact, no " ago" suffix, for fixed-width table
 * columns) but must share the same "ages under 5s read 'just now'" threshold — see the
 * renderer's equivalent test in `presentation.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { engineDataDir, formatAge, formatContextColumn } from '../../src/cli/format.ts';
import type { ContextPressure } from '../../src/core/model/types.ts';

describe('cli formatAge', () => {
  it('returns "just now" just under the 5s boundary (4999ms)', () => {
    expect(formatAge(4999)).toBe('just now');
  });

  it('switches to normal "Ns" formatting at the 5s boundary (5000ms)', () => {
    expect(formatAge(5000)).toBe('5s');
  });
});

/**
 * Story 005 D8: the `ctx=` column marks provenance — `~` for the estimated table, `=` once
 * the opt-in fetched table resolved the model exactly.
 */
function pressure(overrides: Partial<ContextPressure> = {}): ContextPressure {
  return {
    used: 1_000,
    window: 10_000,
    ratio: 0.1,
    band: 'green',
    widened: false,
    windowSource: 'estimated',
    model: 'claude-x',
    ...overrides,
  };
}

describe('cli formatContextColumn', () => {
  it('marks an estimated window with ~', () => {
    expect(formatContextColumn(pressure())).toBe('10%~');
  });

  it('marks an exact window (fetched table hit) with =', () => {
    expect(formatContextColumn(pressure({ windowSource: 'exact' }))).toBe('10%=');
  });

  it('puts the widened * ahead of the ~ marker (widened pressure is always windowSource: estimated per D4)', () => {
    expect(formatContextColumn(pressure({ widened: true }))).toBe('10%*~');
  });

  it('renders — when there is no context pressure at all', () => {
    expect(formatContextColumn(null)).toBe('—');
  });
});

/**
 * `engineDataDir` is what stops the CLI from ever constructing a `WindowSource` — and
 * therefore from ever fetching — while "Exact context windows" is off (D8 accept: "with the
 * setting off, no fetch happens"). `createEngine` only builds a `WindowSource` when handed a
 * `dataDir` (`src/core/createEngine.ts`), so `undefined` here is the whole guarantee.
 */
describe('cli engineDataDir', () => {
  it('omits the data dir when the setting is off, so no WindowSource — and no fetch — is ever created', () => {
    expect(engineDataDir(false, 'C:/data')).toBeUndefined();
  });

  it('passes the data dir through once the setting is on', () => {
    expect(engineDataDir(true, 'C:/data')).toBe('C:/data');
  });
});
