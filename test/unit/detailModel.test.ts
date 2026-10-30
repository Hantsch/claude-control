import { describe, expect, it } from 'vitest';
import type { SessionDetail, TimelineEvent } from '../../src/core/model/types.ts';
import {
  detailHeader,
  detailLoad,
  detailTruncatedNotice,
  eventRow,
  groupRuns,
  TIMELINE_PAGE,
  visibleEvents,
  type DetailLoad,
} from '../../src/renderer/lib/detailModel.ts';

const ev = (n: number, kind: TimelineEvent['kind'], over: Partial<TimelineEvent> = {}): TimelineEvent => ({
  uuid: `u${n}`,
  at: 1_000 * n,
  kind,
  tool: null,
  text: null,
  stopReason: null,
  ...over,
});

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    sessionId: 's1',
    transcriptPath: '/t.jsonl',
    project: { path: '/work/app', name: 'app', key: '/work/app' },
    title: 'Fix the bug',
    branches: ['main', 'dev'],
    models: ['opus'],
    startedAt: Date.UTC(2026, 0, 1, 12, 0, 0),
    endedAt: Date.UTC(2026, 0, 1, 12, 5, 30),
    usage: { inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 30, outputTokens: 40 },
    events: [],
    subagents: [],
    truncated: false,
    ...over,
  };
}

describe('session detail header', () => {
  it('the header carries title, project, branches, models, times and token totals', () => {
    const h = detailHeader(detail());
    expect(h.title).toBe('Fix the bug');
    expect(h.projectName).toBe('app');
    expect(h.projectPath).toBe('/work/app');
    expect(h.branches).toBe('main, dev');
    expect(h.models).toBe('opus');
    expect(h.startedAt).toMatch(/^2026-01-0[12] \d\d:\d\d$/);
    expect(h.duration).toBe('5m 30s');
    expect(h.tokens).toEqual({
      inputTokens: 10,
      cacheReadTokens: 20,
      cacheCreationTokens: 30,
      outputTokens: 40,
      total: 100,
    });
  });

  it('falls back to the session id, dashes and an explicit no-usage note', () => {
    const h = detailHeader(detail({ title: null, branches: [], models: [], endedAt: null, usage: null }));
    expect(h.title).toBe('s1');
    expect(h.branches).toBe('—');
    expect(h.models).toBe('—');
    expect(h.endedAt).toBe('—');
    expect(h.duration).toBe('—');
    expect(h.tokens).toBeNull();
    expect(h.tokensNote).toBe('no usage reported');
  });
});

describe('timeline runs', () => {
  it('events are grouped into runs starting at each prompt without dropping any', () => {
    const events = [
      ev(1, 'assistant'),
      ev(2, 'prompt', { text: 'first' }),
      ev(3, 'assistant', { tool: 'Bash' }),
      ev(4, 'tool-result', { tool: 'Bash' }),
      ev(5, 'prompt'),
      ev(6, 'assistant'),
    ];
    const runs = groupRuns(events);
    expect(runs.map((r) => r.eventCount)).toEqual([1, 3, 2]);
    expect(runs[0]!.label).toBe('Before the first prompt');
    expect(runs[1]!.promptText).toBe('first');
    expect(runs[1]!.toolCount).toBe(2);
    expect(runs[1]!.startedAt).toBe(2000);
    expect(runs[1]!.endedAt).toBe(4000);
    expect(runs[2]!.promptText).toBe('(no text)');
    expect(runs.flatMap((r) => r.events)).toEqual(events);
  });

  it('an expanded run shows events in pages of 200', () => {
    const events = [ev(0, 'prompt'), ...Array.from({ length: 449 }, (_, i) => ev(i + 1, 'assistant'))];
    const [run] = groupRuns(events);
    expect(TIMELINE_PAGE).toBe(200);
    expect(visibleEvents(run!, 1).events).toHaveLength(200);
    expect(visibleEvents(run!, 1).remaining).toBe(250);
    expect(visibleEvents(run!, 2).remaining).toBe(50);
    expect(visibleEvents(run!, 3).remaining).toBe(0);
    expect(visibleEvents(run!, 3).events).toHaveLength(450);
  });

  it('an event row clips long text and says so', () => {
    expect(eventRow(ev(1, 'assistant', { text: 'short' })).hasMore).toBe(false);
    const row = eventRow(ev(1, 'assistant', { text: 'x'.repeat(300), stopReason: 'end_turn' }));
    expect(row.hasMore).toBe(true);
    expect(row.text.length).toBeLessThanOrEqual(120);
    expect(row.text.endsWith('…')).toBe(true);
    expect(row.stopReason).toBe('end_turn');
  });
});

describe('detail loading', () => {
  it('loading is the state between target and response', () => {
    let s: DetailLoad = { state: 'idle' };
    s = detailLoad(s, { type: 'target', id: 's1' });
    expect(s).toEqual({ state: 'loading', id: 's1' });
    const d = detail();
    s = detailLoad(s, { type: 'resolved', detail: d });
    expect(s).toEqual({ state: 'loaded', id: 's1', detail: d });
    s = detailLoad(s, { type: 'target', id: 's2' });
    s = detailLoad(s, { type: 'rejected', id: 's2', message: 'boom' });
    expect(s).toEqual({ state: 'failed', id: 's2', message: 'boom' });
  });

  it('targeting the session already shown keeps its state', () => {
    const loading: DetailLoad = detailLoad({ state: 'idle' }, { type: 'target', id: 's1' });
    expect(detailLoad(loading, { type: 'target', id: 's1' })).toBe(loading);
    const loaded = detailLoad(loading, { type: 'resolved', detail: detail() });
    expect(detailLoad(loaded, { type: 'target', id: 's1' })).toBe(loaded);
  });

  it('a response for a session no longer targeted is ignored', () => {
    let s: DetailLoad = detailLoad({ state: 'idle' }, { type: 'target', id: 's1' });
    s = detailLoad(s, { type: 'target', id: 's2' });
    expect(detailLoad(s, { type: 'resolved', detail: detail({ sessionId: 's1' }) })).toEqual(s);
    expect(detailLoad(s, { type: 'rejected', id: 's1', message: 'late' })).toEqual(s);
  });
});

describe('truncated detail notice', () => {
  it('a truncated detail says the timeline stops at 10 000 events', () => {
    expect(detailTruncatedNotice(detail())).toBeNull();
    const notice = detailTruncatedNotice(detail({ truncated: true }));
    expect(notice).toContain('10 000 events');
    expect(notice).toContain('whole transcript');
  });
});
