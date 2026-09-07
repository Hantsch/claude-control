/**
 * `contextGaugeEstimateText` and `contextBarTitle` (story 005, D5) — the provenance-dependent
 * title/tooltip wording extracted from `ContextGauge.tsx` and `ContextBar.tsx` so it can be
 * unit tested (this project's `test/unit/` has no component-testing library). Covers both
 * `windowSource` values ('exact' and 'estimated') for both components.
 */

import { describe, expect, it } from 'vitest';
import { contextBarTitle, contextGaugeEstimateText } from '../../src/renderer/lib/contextProvenance.ts';

describe('contextGaugeEstimateText', () => {
  it('labels an exact window as coming from the fetched model table', () => {
    expect(contextGaugeEstimateText({ windowSource: 'exact', widened: false })).toBe(
      'Exact: window from the fetched model table.',
    );
  });

  it('ignores widened for an exact window — a widened window is always estimated', () => {
    expect(contextGaugeEstimateText({ windowSource: 'exact', widened: true })).toBe(
      'Exact: window from the fetched model table.',
    );
  });

  it('labels a non-widened estimate as not revealing the 1M-context variant', () => {
    expect(contextGaugeEstimateText({ windowSource: 'estimated', widened: false })).toBe(
      'Estimate: input + cache read + cache creation tokens against an assumed window. The transcript does not reveal the 1M-context variant.',
    );
  });

  it('labels a widened estimate as auto-widened to the 1M tier', () => {
    expect(contextGaugeEstimateText({ windowSource: 'estimated', widened: true })).toBe(
      'Estimate: input + cache read + cache creation tokens against an assumed window — auto-widened to the 1M tier because observed usage exceeded 200k.',
    );
  });
});

describe('contextBarTitle', () => {
  it('labels an exact window as coming from the fetched model table', () => {
    const title = contextBarTitle(
      { windowSource: 'exact', used: 180_000, window: 1_000_000 },
      18,
      'below 60 %',
    );
    expect(title).toBe(
      'Context pressure ≈ 18 % (below 60 %) — 180k of 1.00M. Exact: window from the fetched model table.',
    );
  });

  it('labels an estimated window as an assumed size', () => {
    const title = contextBarTitle(
      { windowSource: 'estimated', used: 180_000, window: 1_000_000 },
      18,
      'below 60 %',
    );
    expect(title).toBe('Context pressure ≈ 18 % (below 60 %) — 180k of an assumed 1.00M. Estimate.');
  });
});
