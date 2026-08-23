/**
 * Popover view-model helpers (story 010). The popover has no render harness — vitest runs
 * without jsdom here — so every rule the rows follow lives in `popoverModel.ts` and is
 * covered from this side instead of through the DOM.
 */

import { describe, expect, it } from 'vitest';
import type { SubagentNode } from '../../src/shared/ipc.ts';
import {
  SUBAGENT_FLAT_LIST_NOTE,
  SUBAGENT_NO_INTERIM_STATE,
  subagentMessage,
  subagentSummary,
} from '../../src/renderer/lib/popoverModel.ts';

/** A subagent node reduced to what the summary reads: its status. */
function node(status: SubagentNode['status'], id: string = status): SubagentNode {
  return {
    id,
    label: `agent ${id}`,
    agentType: null,
    agentId: null,
    startedAt: 0,
    endedAt: null,
    lastActivityAt: null,
    durationMs: null,
    status,
    metrics: null,
    errorText: null,
    finalText: null,
    model: null,
    children: [],
  };
}

describe('subagentSummary', () => {
  it('returns null for a session with no subagents, so the caller renders nothing', () => {
    expect(subagentSummary([])).toBeNull();
  });

  it('counts every completed node as done and marks its pip `on`', () => {
    const summary = subagentSummary([node('completed', 'a'), node('completed', 'b')]);
    expect(summary).toEqual({
      done: 2,
      total: 2,
      pipClasses: ['on', 'on'],
      title: '2 of 2 subagents finished',
    });
  });

  it('maps running and launched to `run`, failed to `fail` and unknown to no class', () => {
    const summary = subagentSummary([
      node('running'),
      node('launched'),
      node('failed'),
      node('unknown'),
      node('completed'),
    ]);
    expect(summary?.pipClasses).toEqual(['run', 'run', 'fail', '', 'on']);
    expect(summary?.total).toBe(5);
  });

  it('counts only `completed` as done — running, launched, failed and unknown do not', () => {
    const summary = subagentSummary([
      node('running'),
      node('launched'),
      node('failed'),
      node('unknown'),
    ]);
    expect(summary?.done).toBe(0);
    expect(summary?.total).toBe(4);
  });

  it('keeps the pips in `session.subagents` order', () => {
    const summary = subagentSummary([node('completed'), node('running'), node('completed', 'c2')]);
    expect(summary?.pipClasses).toEqual(['on', 'run', 'on']);
    expect(summary?.done).toBe(2);
  });

  it('states the count in the tooltip and names failures when there are any', () => {
    expect(subagentSummary([node('completed'), node('failed'), node('running')])?.title).toBe(
      '1 of 3 subagents finished, 1 failed',
    );
    expect(subagentSummary([node('failed'), node('failed', 'f2')])?.title).toBe(
      '0 of 2 subagents finished, 2 failed',
    );
  });

  it('says "subagent" in the singular for a single node', () => {
    expect(subagentSummary([node('running')])?.title).toBe('0 of 1 subagent finished');
    expect(subagentSummary([node('completed')])?.title).toBe('1 of 1 subagent finished');
  });

  it('reads the flat list only — nested children are story 010 D6, not this count', () => {
    const parent = node('completed', 'p');
    const summary = subagentSummary([{ ...parent, children: [node('running', 'child')] }]);
    expect(summary?.total).toBe(1);
    expect(summary?.done).toBe(1);
  });
});

describe('subagentMessage', () => {
  it('says there is no interim state for a running subagent with no metrics yet', () => {
    expect(subagentMessage('running', null, null)).toEqual({
      kind: 'absent',
      text: SUBAGENT_NO_INTERIM_STATE,
    });
  });

  it('says the same thing for a launched (background) subagent with no metrics yet', () => {
    expect(subagentMessage('launched', null, null)).toEqual({
      kind: 'absent',
      text: SUBAGENT_NO_INTERIM_STATE,
    });
  });

  it('still claims the absent state while running/launched even once metrics have arrived', () => {
    // A `launched` result already carries `agentId` + `resolvedModel` (so `metrics` is
    // non-null) while the run is still going in the background with no interim report —
    // verified as the *common* case against real agent results (163/351 sampled), not an
    // edge case, so this must key off `status` alone and never off `metrics`.
    const metrics = {
      model: 'sonnet',
      totalTokens: 100,
      toolUses: 1,
      context: null,
      linesAdded: null,
      linesRemoved: null,
    };
    expect(subagentMessage('running', metrics, null)).toEqual({
      kind: 'absent',
      text: SUBAGENT_NO_INTERIM_STATE,
    });
    expect(subagentMessage('launched', metrics, null)).toEqual({
      kind: 'absent',
      text: SUBAGENT_NO_INTERIM_STATE,
    });
  });

  it('replaces the line with the run\u2019s own liveness once its transcript is being written', () => {
    const now = 1_000_000;
    expect(
      subagentMessage('running', null, null, { lastActivityAt: now - 12_000, now }),
    ).toEqual({ kind: 'absent', text: 'Still working \u2014 wrote 12s ago; no report until it finishes.' });
  });

  it('keeps the old line when there is no activity evidence for the run', () => {
    // Either an agent version that writes no subagent transcripts, or a run whose file could
    // not be found — "no evidence" must never be rendered as evidence of silence.
    expect(subagentMessage('running', null, null, { lastActivityAt: null, now: 1 })).toEqual({
      kind: 'absent',
      text: SUBAGENT_NO_INTERIM_STATE,
    });
  });

  it('surfaces the error text for a failed run, regardless of any leftover metrics', () => {
    const metrics = {
      model: 'sonnet',
      totalTokens: 100,
      toolUses: 1,
      context: null,
      linesAdded: null,
      linesRemoved: null,
    };
    expect(subagentMessage('failed', metrics, 'boom')).toEqual({ kind: 'error', text: 'boom' });
    expect(subagentMessage('failed', null, 'boom')).toEqual({ kind: 'error', text: 'boom' });
  });

  it('says nothing for a failed run that reported no error text', () => {
    expect(subagentMessage('failed', null, null)).toEqual({ kind: 'none', text: null });
  });

  it('says nothing for a completed or unknown run', () => {
    expect(subagentMessage('completed', null, null)).toEqual({ kind: 'none', text: null });
    expect(subagentMessage('unknown', null, null)).toEqual({ kind: 'none', text: null });
  });
});

describe('SUBAGENT_FLAT_LIST_NOTE', () => {
  it('names the exact disclaimer the subagent list renders once, below the flat rows', () => {
    expect(SUBAGENT_FLAT_LIST_NOTE).toBe(
      'flat list — a subagent that itself spawned subagents would not be recognisable as a parent here.',
    );
  });
});
