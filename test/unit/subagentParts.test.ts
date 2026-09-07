/**
 * `buildMetricParts` (story 010 D5) — the metric-part builder shared by `SubagentTree.tsx`
 * (main window) and `popover.tsx` (tray), so the two surfaces cannot describe the same run
 * differently. Covers every part the function can produce, and its absence.
 */

import { describe, expect, it } from 'vitest';
import type { SubagentMetrics } from '../../src/shared/ipc.ts';
import { buildMetricParts } from '../../src/renderer/lib/subagentParts.ts';

/** A metrics object with everything absent — the baseline every test overrides from. */
function metrics(overrides: Partial<SubagentMetrics> = {}): SubagentMetrics {
  return {
    model: null,
    totalTokens: null,
    toolUses: null,
    context: null,
    linesAdded: null,
    linesRemoved: null,
    ...overrides,
  };
}

describe('buildMetricParts', () => {
  it('returns an empty array for a metrics object with nothing set', () => {
    expect(buildMetricParts(metrics())).toEqual([]);
  });

  it('never produces a model part — the model chip is built by the callers from node.model', () => {
    expect(
      buildMetricParts(metrics({ model: 'claude-opus-5' })).some((part) => part.key === 'model'),
    ).toBe(false);
  });

  it('formats totalTokens and labels the title as cumulative spend, not context size', () => {
    const parts = buildMetricParts(metrics({ totalTokens: 184_300 }));
    expect(parts).toEqual([
      {
        key: 'tokens',
        text: '184k tok',
        title: 'Tokens the whole run spent — cumulative, not its context size',
      },
    ]);
  });

  it('omits the tokens part when totalTokens is null', () => {
    expect(buildMetricParts(metrics({ totalTokens: null })).some((p) => p.key === 'tokens')).toBe(
      false,
    );
  });

  it('renders a zero totalTokens (a real, non-null value) as its own part', () => {
    const parts = buildMetricParts(metrics({ totalTokens: 0 }));
    expect(parts.find((p) => p.key === 'tokens')?.text).toBe('0 tok');
  });

  it('adds a context part with band symbol, rounded ratio and the estimate in the title', () => {
    const parts = buildMetricParts(
      metrics({
        context: {
          used: 180_000,
          window: 1_000_000,
          ratio: 0.18,
          band: 'green',
          widened: false,
          windowSource: 'estimated',
          model: null,
        },
      }),
    );
    expect(parts).toEqual([
      {
        key: 'ctx',
        text: '🟢 ctx 18%',
        title:
          'Context when the run finished — estimate: 180k of an assumed 1.00M window (below 60 %)',
      },
    ]);
  });

  it('labels the title exact when windowSource is exact — window from the fetched model table', () => {
    const parts = buildMetricParts(
      metrics({
        context: {
          used: 180_000,
          window: 1_000_000,
          ratio: 0.18,
          band: 'green',
          widened: false,
          windowSource: 'exact',
          model: null,
        },
      }),
    );
    expect(parts).toEqual([
      {
        key: 'ctx',
        text: '🟢 ctx 18%',
        title:
          'Context when the run finished — exact: 180k of the 1.00M window from the fetched model table (below 60 %)',
      },
    ]);
  });

  it('omits the context part when context is null', () => {
    expect(buildMetricParts(metrics({ context: null })).some((p) => p.key === 'ctx')).toBe(false);
  });

  it('adds a toolUses part, including for a zero count', () => {
    expect(buildMetricParts(metrics({ toolUses: 5 }))).toEqual([
      { key: 'tools', text: '5 tools', title: 'Tool calls the subagent made' },
    ]);
    expect(buildMetricParts(metrics({ toolUses: 0 }))[0]?.text).toBe('0 tools');
  });

  it('omits the toolUses part when toolUses is null', () => {
    expect(buildMetricParts(metrics({ toolUses: null })).some((p) => p.key === 'tools')).toBe(
      false,
    );
  });

  it('adds a lines part when either linesAdded or linesRemoved is truthy', () => {
    expect(buildMetricParts(metrics({ linesAdded: 12, linesRemoved: 4 }))).toEqual([
      { key: 'lines', text: '+12/−4', title: 'Lines the subagent added / removed' },
    ]);
    expect(buildMetricParts(metrics({ linesAdded: 12, linesRemoved: null }))[0]).toEqual({
      key: 'lines',
      text: '+12/−0',
      title: 'Lines the subagent added / removed',
    });
    expect(buildMetricParts(metrics({ linesAdded: null, linesRemoved: 4 }))[0]).toEqual({
      key: 'lines',
      text: '+0/−4',
      title: 'Lines the subagent added / removed',
    });
  });

  it('omits the lines part when both linesAdded and linesRemoved are falsy', () => {
    expect(
      buildMetricParts(metrics({ linesAdded: 0, linesRemoved: 0 })).some((p) => p.key === 'lines'),
    ).toBe(false);
    expect(
      buildMetricParts(metrics({ linesAdded: null, linesRemoved: null })).some(
        (p) => p.key === 'lines',
      ),
    ).toBe(false);
  });

  it('orders parts tokens, context, tools, lines regardless of which are present', () => {
    const parts = buildMetricParts(
      metrics({
        model: 'claude-opus-5',
        totalTokens: 1_000,
        context: {
          used: 500,
          window: 1_000,
          ratio: 0.5,
          band: 'yellow',
          widened: false,
          windowSource: 'estimated',
          model: null,
        },
        toolUses: 3,
        linesAdded: 1,
        linesRemoved: 1,
      }),
    );
    expect(parts.map((part) => part.key)).toEqual(['tokens', 'ctx', 'tools', 'lines']);
  });
});
