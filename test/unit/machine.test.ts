/**
 * The state machine is the risky part, so it is tested first and hardest (§10).
 * Table-driven: one row per scenario, given a transcript tail and a clock.
 */

import { describe, expect, it } from 'vitest';
import { summarizeRecords } from '../../src/core/adapters/claude/summarize.ts';
import type { TranscriptRecord } from '../../src/core/adapters/claude/records.ts';
import { DEFAULT_THRESHOLDS } from '../../src/core/model/settings.ts';
import type { SessionStatus } from '../../src/core/model/status.ts';
import { deriveHistoricalStatus, deriveStatus } from '../../src/core/state/machine.ts';
import {
  T0,
  assistant,
  fileHistorySnapshot,
  lastPrompt,
  prompt,
  queueOperation,
  syntheticAssistant,
  toolResult,
} from '../fixtures/builders.ts';

function facts(records: Record<string, unknown>[], now = T0, exhausted = false) {
  return summarizeRecords(records as TranscriptRecord[], {
    now,
    read: {
      fileSize: 1024,
      mtimeMs: T0,
      windowBytes: 64 * 1024,
      startOffset: exhausted ? 4096 : 0,
      linesParsed: records.length,
      linesSkipped: 0,
      exhausted,
      error: null,
    },
  });
}

function derive(records: Record<string, unknown>[], atMs: number, alive = true) {
  return deriveStatus({
    alive,
    facts: facts(records, T0 + atMs),
    now: T0 + atMs,
    thresholds: DEFAULT_THRESHOLDS,
  });
}

interface Row {
  name: string;
  records: Record<string, unknown>[];
  /** ms after T0 at which the status is evaluated. */
  at: number;
  alive?: boolean;
  expected: SessionStatus;
}

const SECOND = 1_000;
const MINUTE = 60_000;

const rows: Row[] = [
  {
    name: 'assistant end_turn → done',
    records: [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn', text: 'All set.' })],
    at: 2 * SECOND,
    expected: 'done',
  },
  {
    name: 'unpaired tool_use below T_work → working',
    records: [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Read' }] })],
    at: 5 * SECOND,
    expected: 'working',
  },
  {
    name: 'unpaired fast tool over its 10 s override → waiting',
    records: [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Read' }] })],
    at: 12 * SECOND,
    expected: 'waiting',
  },
  {
    name: 'unpaired Bash at 30 s is still working (120 s override)',
    records: [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] })],
    at: 30 * SECOND,
    expected: 'working',
  },
  {
    // Slow by nature, so overdue means "taking a while", not "asking you something".
    name: 'unpaired Bash past its override → stale, not waiting',
    records: [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] })],
    at: 121 * SECOND,
    expected: 'stale',
  },
  {
    name: 'a subagent running for ten minutes is still working',
    records: [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent' }] })],
    at: 10 * MINUTE,
    expected: 'working',
  },
  {
    name: 'a subagent past its 20 min budget → stale',
    records: [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent' }] })],
    at: 21 * MINUTE,
    expected: 'stale',
  },
  {
    name: 'parallel Read + Bash uses the most permissive threshold',
    records: [
      assistant({
        uuid: 'a1',
        at: 0,
        tools: [
          { id: 't1', name: 'Read' },
          { id: 't2', name: 'Bash' },
        ],
      }),
    ],
    at: 30 * SECOND,
    expected: 'working',
  },
  {
    // …and the tool that set that threshold also sets the speed class, so the pair reads as
    // "the slow one is still going", not "the fast one is blocked".
    name: 'parallel Read + Bash past the Bash budget → stale',
    records: [
      assistant({
        uuid: 'a1',
        at: 0,
        tools: [
          { id: 't1', name: 'Read' },
          { id: 't2', name: 'Bash' },
        ],
      }),
    ],
    at: 121 * SECOND,
    expected: 'stale',
  },
  {
    name: 'unknown tool falls back to the 25 s default',
    records: [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'MysteryTool' }] })],
    at: 26 * SECOND,
    expected: 'waiting',
  },
  {
    name: 'paired tool result → working (the model is thinking again)',
    records: [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] }),
      toolResult('u1', 200, { assistantUuid: 'a1', toolUseId: 't1' }),
    ],
    at: 5 * SECOND,
    expected: 'working',
  },
  {
    name: 'human prompt → working',
    records: [prompt('u1', 0)],
    at: 3 * SECOND,
    expected: 'working',
  },
  {
    // Status says *what*, never *how long ago* — the old T_idle rule turned this into `idle`
    // and made a finished session indistinguishable from a forgotten one.
    name: 'a turn that ended hours ago is still done',
    records: [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' })],
    at: 3 * 60 * MINUTE,
    expected: 'done',
  },
  {
    name: 'a long-unpaired tool stays stale rather than decaying to something else',
    records: [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] })],
    at: 3 * 60 * MINUTE,
    expected: 'stale',
  },
  {
    name: 'enqueue without dequeue after a finished turn → queued',
    records: [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' }), queueOperation('enqueue', 1_000)],
    at: 3 * SECOND,
    expected: 'queued',
  },
  {
    name: 'enqueue followed by dequeue is not queued',
    records: [
      assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' }),
      queueOperation('enqueue', 1_000),
      queueOperation('dequeue', 1_500),
    ],
    at: 3 * SECOND,
    expected: 'done',
  },
  {
    // Observed live: a session repeatedly enqueued and withdrew prompts, then finished its
    // turn. Counting `remove` as "still queued" pinned it to `queued` forever, which is
    // invisible to the tray, the badge and the toasts.
    name: 'enqueue followed by remove is not queued',
    records: [
      queueOperation('enqueue', 0),
      queueOperation('remove', 500),
      assistant({ uuid: 'a1', at: 1_000, stopReason: 'end_turn' }),
    ],
    at: 3 * SECOND,
    expected: 'done',
  },
  {
    name: 'a burst of enqueue/remove pairs leaves no phantom queued prompt',
    records: [
      queueOperation('enqueue', 0),
      queueOperation('remove', 100),
      queueOperation('enqueue', 200),
      queueOperation('remove', 300),
      queueOperation('enqueue', 400),
      queueOperation('remove', 500),
      assistant({ uuid: 'a1', at: 1_000, stopReason: 'end_turn' }),
    ],
    at: 3 * SECOND,
    expected: 'done',
  },
  {
    // The dangerous shape: more enqueues than clears, but the newest operation is a
    // withdrawal. A counting-only rule would report a phantom pending prompt here.
    name: 'two enqueues and one remove still leave no queued prompt when the newest is a remove',
    records: [
      queueOperation('enqueue', 0),
      queueOperation('enqueue', 100),
      queueOperation('remove', 200),
      assistant({ uuid: 'a1', at: 1_000, stopReason: 'end_turn' }),
    ],
    at: 3 * SECOND,
    expected: 'done',
  },
  {
    name: 'an unknown queue operation clears rather than sticking',
    records: [
      queueOperation('enqueue', 0),
      queueOperation('some-future-operation', 500),
      assistant({ uuid: 'a1', at: 1_000, stopReason: 'end_turn' }),
    ],
    at: 3 * SECOND,
    expected: 'done',
  },
  {
    name: 'a withdrawn prompt does not hide a subagent that is still running',
    records: [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent' }] }),
      queueOperation('enqueue', 1_000),
      queueOperation('remove', 1_500),
    ],
    at: 200 * SECOND,
    expected: 'working',
  },
  {
    // `stale` is still a turn in flight, so a prompt sitting in the queue behind it must not
    // overwrite it — otherwise the one row that might want a look reads as merely queued.
    name: 'a queued prompt does not mask an overdue tool either',
    records: [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] }),
      queueOperation('enqueue', 1_000),
    ],
    at: 200 * SECOND,
    expected: 'stale',
  },
  {
    name: 'a queued prompt does not mask an actively running tool',
    records: [
      queueOperation('enqueue', 0),
      assistant({ uuid: 'a1', at: 1_000, tools: [{ id: 't1', name: 'Bash' }] }),
    ],
    at: 5 * SECOND,
    expected: 'working',
  },
  {
    name: 'bookkeeping tail is ignored — last-prompt does not decide the state',
    records: [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' }), lastPrompt('a1')],
    at: 2 * SECOND,
    expected: 'done',
  },
  {
    name: 'file-history-snapshot tail is ignored too',
    records: [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Edit' }] }),
      fileHistorySnapshot(500),
    ],
    at: 5 * SECOND,
    expected: 'working',
  },
  {
    name: '<synthetic> model records do not break derivation',
    records: [syntheticAssistant('a1', 0)],
    at: 2 * SECOND,
    expected: 'working',
  },
  {
    // Bookkeeping only, whole file seen: the session exists but has never been used.
    name: 'no semantic record in a fully read transcript → starting',
    records: [lastPrompt('nothing'), fileHistorySnapshot(0)],
    at: 2 * SECOND,
    expected: 'starting',
  },
  {
    name: 'dead process → ended, regardless of the transcript',
    records: [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' })],
    at: 2 * SECOND,
    alive: false,
    expected: 'ended',
  },
  {
    name: 'stop_sequence is treated as output, not a handover',
    records: [assistant({ uuid: 'a1', at: 0, stopReason: 'stop_sequence' })],
    at: 2 * SECOND,
    expected: 'working',
  },
];

describe('deriveStatus', () => {
  for (const row of rows) {
    it(row.name, () => {
      const result = derive(row.records, row.at, row.alive ?? true);
      expect(result.status, result.reason).toBe(row.expected);
    });
  }

  it('reports the applied per-tool threshold, so the reason is checkable', () => {
    const result = derive([assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] })], 121 * SECOND);
    expect(result.appliedWorkMs).toBe(DEFAULT_THRESHOLDS.perToolWorkMs.Bash);
    expect(result.reason).toContain('Bash');
  });

  it('distinguishes an exhausted tail window from an empty transcript', () => {
    const exhausted = deriveStatus({
      alive: true,
      facts: facts([lastPrompt('x')], T0, true),
      now: T0,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(exhausted.status).toBe('unknown');
    expect(exhausted.reason).toContain('maximum tail window');
  });

  it('calls a session that was never used `starting`, not `unknown`', () => {
    // What every freshly opened Claude Code window looks like: registered, no transcript.
    const untouched = facts([], T0);
    expect(
      deriveStatus({ alive: true, facts: untouched, now: T0, thresholds: DEFAULT_THRESHOLDS }).status,
    ).toBe('starting');
  });

  it('keeps `unknown` for a transcript that could not be read', () => {
    const broken = facts([], T0);
    broken.read = { ...broken.read, error: 'EPERM: operation not permitted' };
    const result = deriveStatus({ alive: true, facts: broken, now: T0, thresholds: DEFAULT_THRESHOLDS });
    expect(result.status).toBe('unknown');
    expect(result.reason).toContain('EPERM');
  });

  it('a queued prompt still outranks both, since there is pending work', () => {
    const queued = facts([queueOperation('enqueue', 0)], T0);
    expect(
      deriveStatus({ alive: true, facts: queued, now: T0, thresholds: DEFAULT_THRESHOLDS }).status,
    ).toBe('queued');
  });

  it('never throws on garbage records', () => {
    const garbage = [{ type: 'assistant' }, { type: 'user', timestamp: 'not-a-date' }, {}];
    expect(() =>
      deriveStatus({
        alive: true,
        facts: facts(garbage),
        now: T0,
        thresholds: DEFAULT_THRESHOLDS,
      }),
    ).not.toThrow();
  });
});

describe('deriveHistoricalStatus', () => {
  it('evaluates at the moment of the last record, not now', () => {
    const records = [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' })];
    // Hours old in wall-clock terms, yet the session did finish its turn.
    expect(deriveHistoricalStatus(facts(records, T0 + 5 * 60 * MINUTE), DEFAULT_THRESHOLDS)).toBe('done');
  });

  it('reports unknown when there is nothing semantic', () => {
    expect(deriveHistoricalStatus(facts([lastPrompt('x')]), DEFAULT_THRESHOLDS)).toBe('unknown');
  });
});
