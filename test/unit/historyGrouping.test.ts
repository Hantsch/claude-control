/**
 * `groupHistory()` (§8 "History") — project/branch/model grouping over a filtered
 * `HistoryEntry` list.
 */

import { describe, expect, it } from 'vitest';
import { groupHistory } from '../../src/core/state/historyGrouping.ts';
import type { HistoryEntry, ProjectRef, UsageTotals } from '../../src/core/model/types.ts';

const PROJECT_A: ProjectRef = { path: 'c:\\dev\\a', name: 'proj-a', key: 'c:/dev/a' };
const PROJECT_B: ProjectRef = { path: 'c:\\dev\\b', name: 'proj-b', key: 'c:/dev/b' };

function usage(overrides: Partial<UsageTotals> = {}): UsageTotals {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sessionId: 'session-1',
    transcriptPath: 'c:\\transcript.jsonl',
    project: PROJECT_A,
    branch: 'main',
    title: null,
    model: 'claude-opus-5',
    startedAt: 0,
    endedAt: 100,
    finalStatus: 'ended',
    messageCountEstimate: 1,
    usage: usage({ inputTokens: 10, outputTokens: 5, cacheCreationTokens: 2, cacheReadTokens: 100 }),
    usageComplete: true,
    fileSize: 10,
    mtimeMs: 0,
    ...overrides,
  };
}

describe('groupHistory', () => {
  it('groups by project using key/name, membership matches input entries', () => {
    const a1 = entry({ sessionId: 'a1', project: PROJECT_A });
    const a2 = entry({ sessionId: 'a2', project: PROJECT_A });
    const b1 = entry({ sessionId: 'b1', project: PROJECT_B });

    const groups = groupHistory([a1, a2, b1], 'project');

    const byLabel = new Map(groups.map((g) => [g.label, g]));
    expect(byLabel.get('proj-a')?.entries.map((e) => e.sessionId).sort()).toEqual(['a1', 'a2']);
    expect(byLabel.get('proj-b')?.entries.map((e) => e.sessionId)).toEqual(['b1']);
  });

  it('keys project groups by project.key, not the (possibly colliding) display name', () => {
    // Two distinct checkouts of the same repo share a display name but not a `key` —
    // `groupHistory` must not merge them, and each group's `key` must reflect that.
    const sameName: ProjectRef = { path: 'c:\\dev\\copy-2\\repo', name: 'repo', key: 'c:/dev/copy-2/repo' };
    const otherName: ProjectRef = { path: 'c:\\dev\\copy-1\\repo', name: 'repo', key: 'c:/dev/copy-1/repo' };
    const a = entry({ sessionId: 'a', project: otherName });
    const b = entry({ sessionId: 'b', project: sameName });

    const groups = groupHistory([a, b], 'project');

    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
    expect(groups.every((g) => g.label === 'repo')).toBe(true);
    expect(groups.map((g) => g.key).sort()).toEqual(['c:/dev/copy-1/repo', 'c:/dev/copy-2/repo']);
  });

  it('groups by branch, using entry.branch as the label', () => {
    const feature = entry({ sessionId: 's1', branch: 'feature-x' });
    const main = entry({ sessionId: 's2', branch: 'main' });

    const groups = groupHistory([feature, main], 'branch');
    const labels = groups.map((g) => g.label).sort();
    expect(labels).toEqual(['feature-x', 'main']);
  });

  it('groups by model, using entry.model as the label', () => {
    const opus = entry({ sessionId: 's1', model: 'claude-opus-5' });
    const sonnet = entry({ sessionId: 's2', model: 'claude-sonnet-5' });

    const groups = groupHistory([opus, sonnet], 'model');
    const labels = groups.map((g) => g.label).sort();
    expect(labels).toEqual(['claude-opus-5', 'claude-sonnet-5']);
  });

  it('sorts the null-branch group last as "no branch", regardless of its total', () => {
    const huge = entry({
      sessionId: 'huge',
      branch: null,
      usage: usage({ inputTokens: 100000, outputTokens: 0, cacheCreationTokens: 0 }),
    });
    const small = entry({
      sessionId: 'small',
      branch: 'main',
      usage: usage({ inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0 }),
    });

    const groups = groupHistory([huge, small], 'branch');

    expect(groups.map((g) => g.label)).toEqual(['main', 'no branch']);
    expect(groups[1]!.totalTokens).toBe(100000);
  });

  it('sorts the null-model group last as "unknown model", regardless of its total', () => {
    const huge = entry({
      sessionId: 'huge',
      model: null,
      usage: usage({ inputTokens: 100000, outputTokens: 0, cacheCreationTokens: 0 }),
    });
    const small = entry({
      sessionId: 'small',
      model: 'claude-opus-5',
      usage: usage({ inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0 }),
    });

    const groups = groupHistory([huge, small], 'model');

    expect(groups.map((g) => g.label)).toEqual(['claude-opus-5', 'unknown model']);
  });

  it('sorts remaining groups by descending total, ties broken by label', () => {
    const low = entry({
      sessionId: 'low',
      branch: 'low-branch',
      usage: usage({ inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0 }),
    });
    const high = entry({
      sessionId: 'high',
      branch: 'high-branch',
      usage: usage({ inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0 }),
    });

    const groups = groupHistory([low, high], 'branch');
    expect(groups.map((g) => g.label)).toEqual(['high-branch', 'low-branch']);
  });

  it('excludes cache-read tokens from totalTokens, using inputTokens + outputTokens + cacheCreationTokens', () => {
    const e = entry({
      sessionId: 's1',
      usage: usage({ inputTokens: 10, outputTokens: 5, cacheCreationTokens: 2, cacheReadTokens: 9999 }),
    });

    const groups = groupHistory([e], 'branch');
    expect(groups[0]!.totalTokens).toBe(17);
  });

  it('entries with usage: null count toward notCounted, not toward totalTokens as zero', () => {
    const withUsage = entry({
      sessionId: 'has-usage',
      usage: usage({ inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0 }),
    });
    const noUsage = entry({ sessionId: 'no-usage', usage: null, usageComplete: false });

    const groups = groupHistory([withUsage, noUsage], 'branch');

    expect(groups).toHaveLength(1);
    expect(groups[0]!.notCounted).toBe(1);
    expect(groups[0]!.totalTokens).toBe(15);
    expect(groups[0]!.entries).toHaveLength(2);
  });

  it('partial is true when any counted entry has usage but usageComplete: false', () => {
    const partialEntry = entry({
      sessionId: 'partial',
      usage: usage({ inputTokens: 3, outputTokens: 0, cacheCreationTokens: 0 }),
      usageComplete: false,
    });
    const completeEntry = entry({
      sessionId: 'complete',
      usage: usage({ inputTokens: 4, outputTokens: 0, cacheCreationTokens: 0 }),
      usageComplete: true,
    });

    const groups = groupHistory([partialEntry, completeEntry], 'branch');
    expect(groups[0]!.partial).toBe(true);
    expect(groups[0]!.totalTokens).toBe(7);
  });

  it('partial is false when all counted entries are usageComplete: true', () => {
    const e1 = entry({ sessionId: 's1', usageComplete: true });
    const e2 = entry({ sessionId: 's2', usageComplete: true });

    const groups = groupHistory([e1, e2], 'branch');
    expect(groups[0]!.partial).toBe(false);
  });

  it('a usage: null entry does not flip partial on its own', () => {
    const noUsage = entry({ sessionId: 'no-usage', usage: null, usageComplete: false });

    const groups = groupHistory([noUsage], 'branch');
    expect(groups[0]!.partial).toBe(false);
    expect(groups[0]!.notCounted).toBe(1);
    expect(groups[0]!.totalTokens).toBe(0);
  });

  it('truncated defaults to false when the options argument is omitted', () => {
    const groups = groupHistory([entry()], 'branch');
    expect(groups[0]!.truncated).toBe(false);
  });

  it('truncated is false when options.truncated is explicitly false', () => {
    const groups = groupHistory([entry()], 'branch', { truncated: false });
    expect(groups[0]!.truncated).toBe(false);
  });

  it('truncated is true on every group when options.truncated is true', () => {
    const a = entry({ sessionId: 'a', branch: 'main' });
    const b = entry({ sessionId: 'b', branch: 'other' });

    const groups = groupHistory([a, b], 'branch', { truncated: true });

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.truncated)).toBe(true);
  });

  it('truncated is orthogonal to partial: a truncated, non-partial group has truncated true and partial false', () => {
    const complete = entry({ sessionId: 'complete', usageComplete: true });

    const groups = groupHistory([complete], 'branch', { truncated: true });

    expect(groups[0]!.truncated).toBe(true);
    expect(groups[0]!.partial).toBe(false);
  });
});
