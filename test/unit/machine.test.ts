/**
 * The state machine is the risky part, so it is tested first and hardest (§10).
 * Table-driven: one row per scenario, given a transcript tail and a clock.
 */

import { describe, expect, it } from 'vitest';
import { summarizeRecords } from '../../src/core/adapters/claude/summarize.ts';
import type { TranscriptRecord } from '../../src/core/adapters/claude/records.ts';
import { DEFAULT_THRESHOLDS, SUBAGENT_LIVENESS_MS } from '../../src/core/model/settings.ts';
import type { SessionStatus } from '../../src/core/model/status.ts';
import { deriveHistoricalStatus, deriveStatus } from '../../src/core/state/machine.ts';
import {
  T0,
  assistant,
  fileHistorySnapshot,
  interrupt,
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
  {
    // The bug this state exists for: the marker is a plain `user` record, so it used to read
    // as "a prompt was just submitted" → `working`, i.e. a turn in flight forever.
    name: 'an interrupted turn → interrupted, not working',
    records: [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] }),
      interrupt('u1', 1_000),
    ],
    at: 3 * SECOND,
    expected: 'interrupted',
  },
  {
    name: 'the "for tool use" wording is the same interrupt',
    records: [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] }),
      interrupt('u1', 1_000, '[Request interrupted by user for tool use]'),
    ],
    at: 3 * SECOND,
    expected: 'interrupted',
  },
  {
    // Age never changes a status, and this one least of all: it is a statement about what the
    // user did, not about how long ago they did it.
    name: 'an interrupt from hours ago is still interrupted',
    records: [interrupt('u1', 0)],
    at: 5 * 60 * MINUTE,
    expected: 'interrupted',
  },
  {
    name: 'typing again after an interrupt puts the session back to working',
    records: [interrupt('u1', 0), prompt('u2', 1_000, 'weiter bitte')],
    at: 3 * SECOND,
    expected: 'working',
  },
  {
    // A prompt that *quotes* the marker is still a prompt — the pattern matches the whole
    // text, so an interrupt cannot be faked (or accidentally triggered) by talking about one.
    name: 'a prompt merely mentioning the marker is not an interrupt',
    records: [prompt('u1', 0, 'why does [Request interrupted by user] show as working?')],
    at: 3 * SECOND,
    expected: 'working',
  },
  {
    // An interrupt is not pending work, so a prompt waiting in the queue behind it is the
    // more specific fact — same rule that lets `queued` beat `done`.
    name: 'a prompt queued after an interrupt reads as queued',
    records: [interrupt('u1', 0), queueOperation('enqueue', 1_000)],
    at: 3 * SECOND,
    expected: 'queued',
  },
];

describe('deriveStatus', () => {
  for (const row of rows) {
    it(row.name, () => {
      const result = derive(row.records, row.at, row.alive ?? true);
      expect(result.status, result.reason).toBe(row.expected);
      // No row passes a `reported` block, so every verdict in the table stays our own (AC 4).
      expect(result.statusSource, row.name).toBe('inferred');
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

  describe('a registry-reported status (§1)', () => {
    /** A transcript that derives `done` entirely on its own — the rule has to beat it. */
    const finished = [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn', text: 'All set.' })];
    /** …and one that derives `working`, to show it is not just the passive states. */
    const busy = [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] })];

    function withReported(
      records: Record<string, unknown>[],
      reported: { status: string | null; waitingFor: string | null; at: number | null },
      alive = true,
      atMs = 2 * SECOND,
    ) {
      const at = T0 + atMs;
      return deriveStatus({
        alive,
        facts: facts(records, at),
        now: at,
        thresholds: DEFAULT_THRESHOLDS,
        reported,
      });
    }

    it('overrides a transcript that would otherwise be done', () => {
      const result = withReported(finished, { status: 'waiting', waitingFor: 'permission prompt', at: T0 });
      expect(result.status).toBe('waiting');
      expect(result.statusSource).toBe('reported');
      expect(result.reason).toContain('Claude Code');
      expect(result.reason).toContain('permission prompt');
    });

    it('overrides a transcript that would otherwise be working', () => {
      const result = withReported(busy, { status: 'waiting', waitingFor: 'permission prompt', at: T0 });
      expect(result.status).toBe('waiting');
      expect(result.statusSource).toBe('reported');
    });

    it('never goes stale — an ancient reportedAt still wins immediately', () => {
      // No staleness threshold anywhere in this rule: the agent's word stands until it
      // publishes a different one, so a week-old stamp changes nothing.
      const ancient = withReported(finished, {
        status: 'waiting',
        waitingFor: 'permission prompt',
        at: T0 - 7 * 24 * 60 * MINUTE,
      });
      expect(ancient.status).toBe('waiting');
      expect(ancient.statusSource).toBe('reported');
      // …and a missing stamp is just as good.
      expect(withReported(finished, { status: 'waiting', waitingFor: 'a question', at: null }).status).toBe(
        'waiting',
      );
    });

    it('names a generic blocker when the agent reported no waitingFor', () => {
      const result = withReported(finished, { status: 'waiting', waitingFor: null, at: T0 });
      expect(result.status).toBe('waiting');
      expect(result.reason).toContain('Claude Code');
    });

    it('a dead process is still ended, reported waiting or not', () => {
      const result = withReported(finished, { status: 'waiting', waitingFor: 'permission prompt', at: T0 }, false);
      expect(result.status).toBe('ended');
      expect(result.statusSource).toBe('inferred');
    });

    it('carries any other reported status without acting on it', () => {
      // Only `waiting`, `busy` and `idle` act; anything else is registry noise here.
      for (const status of ['running', '', null]) {
        const result = withReported(finished, { status, waitingFor: null, at: T0 });
        expect(result.status, `reported=${String(status)}`).toBe('done');
        expect(result.statusSource, `reported=${String(status)}`).toBe('inferred');
      }
    });

    /** A `busy`/`idle` report stamped at the moment of evaluation. */
    function reportedNow(status: 'busy' | 'idle', atMs = 2 * SECOND) {
      return { status, waitingFor: null, at: T0 + atMs };
    }

    /** An open tool call issued at T0 whose name is `name`. */
    function openTool(name: string) {
      return [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name }] })];
    }

    it('a session Claude Code reports busy is never done, interrupted or starting, whatever its last record', () => {
      const cases: { name: string; records: Record<string, unknown>[] }[] = [
        {
          // Background agents launched asynchronously: the tool result comes straight back and
          // the turn ends, while the agents keep running.
          name: 'end_turn after an async Agent launch',
          records: [
            assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent' }] }),
            toolResult('u1', 500, { assistantUuid: 'a1', toolUseId: 't1' }),
            assistant({ uuid: 'a2', at: 1_000, stopReason: 'end_turn', text: 'Agents launched.' }),
          ],
        },
        { name: 'interrupt marker', records: [prompt('p1', 0), interrupt('i1', 1_000)] },
        { name: 'empty transcript', records: [] },
        {
          name: 'queued prompt',
          records: [
            assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn', text: 'All set.' }),
            queueOperation('enqueue', 1_000),
          ],
        },
      ];
      for (const { name, records } of cases) {
        const result = withReported(records, reportedNow('busy'));
        expect(result.status, name).toBe('working');
        expect(result.statusSource, name).toBe('reported');
      }
      // No age cut-off: background agents may run for hours after the turn ended.
      const hoursLater = withReported(cases[0]!.records, reportedNow('busy', 3 * 60 * MINUTE), true, 3 * 60 * MINUTE);
      expect(hoursLater.status).toBe('working');
    });

    it('a session Claude Code reports idle is never working or queued — a turn that died mid-tool reads interrupted', () => {
      const cases: { name: string; records: Record<string, unknown>[]; atMs: number }[] = [
        { name: 'open Bash call below budget', records: openTool('Bash'), atMs: 2 * SECOND },
        { name: 'open fast tool over budget', records: openTool('Read'), atMs: 12 * SECOND },
        { name: 'open slow tool over budget', records: openTool('Bash'), atMs: 121 * SECOND },
        { name: 'prompt just submitted', records: [prompt('p1', 0)], atMs: 2 * SECOND },
        { name: 'tool result returned', records: [...openTool('Bash'), toolResult('u1', 500, { assistantUuid: 'a1', toolUseId: 't1' })], atMs: 2 * SECOND },
      ];
      for (const { name, records, atMs } of cases) {
        const result = withReported(records, reportedNow('idle', atMs), true, atMs);
        expect(result.status, name).toBe('interrupted');
        expect(result.statusSource, name).toBe('reported');
      }
      // A queued prompt nobody is working on does not outrank the finished turn.
      const queued = withReported(
        [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn', text: 'All set.' }), queueOperation('enqueue', 1_000)],
        reportedNow('idle'),
      );
      expect(queued.status).toBe('done');
    });

    it('under idle the transcript still tells done from interrupted from starting', () => {
      expect(withReported(finished, reportedNow('idle')).status).toBe('done');
      expect(withReported([prompt('p1', 0), interrupt('i1', 1_000)], reportedNow('idle')).status).toBe('interrupted');
      expect(withReported([], reportedNow('idle')).status).toBe('starting');
    });

    it('under busy an open tool keeps its name and the working/stale split', () => {
      const below = withReported(openTool('Bash'), reportedNow('busy'));
      expect(below.status).toBe('working');
      expect(below.reason).toContain('Bash');
      expect(below.appliedWorkMs).toBe(DEFAULT_THRESHOLDS.perToolWorkMs.Bash);

      const slowOver = withReported(openTool('Bash'), reportedNow('busy', 121 * SECOND), true, 121 * SECOND);
      expect(slowOver.status).toBe('stale');
      expect(slowOver.reason).toContain('Bash');

      // A fast tool over budget would read `waiting` on its own; Claude Code reports prompts
      // itself, so under busy it is overdue work, not a prompt.
      const fastOver = withReported(openTool('Read'), reportedNow('busy', 12 * SECOND), true, 12 * SECOND);
      expect(fastOver.status).toBe('stale');
      expect(fastOver.reason).toContain('Read');

      // The subagent quiet-clock still holds an Agent call past its budget at `working`.
      const now = T0 + 21 * MINUTE;
      const delegating = facts(openTool('Agent'), now);
      delegating.subagentActivityAt = now - 5 * SECOND;
      const progressing = deriveStatus({
        alive: true,
        facts: delegating,
        now,
        thresholds: DEFAULT_THRESHOLDS,
        reported: { status: 'busy', waitingFor: null, at: now },
      });
      expect(progressing.status).toBe('working');
      expect(progressing.reason).toContain('subagent');
      expect(withReported(openTool('Agent'), reportedNow('busy', 21 * MINUTE), true, 21 * MINUTE).status).toBe(
        'stale',
      );
    });

    it('a status shaped by the registry says so in its reason and source', () => {
      const delegated = withReported(
        [
          assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent' }] }),
          toolResult('u1', 500, { assistantUuid: 'a1', toolUseId: 't1' }),
          assistant({ uuid: 'a2', at: 1_000, stopReason: 'end_turn', text: 'Agents launched.' }),
        ],
        reportedNow('busy'),
      );
      expect(delegated.reason).toBe('Claude Code reports busy — the turn ended, background agents are still running');
      expect(delegated.statusSource).toBe('reported');

      const died = withReported(openTool('Bash'), reportedNow('idle'));
      expect(died.reason.startsWith('Claude Code reports idle')).toBe(true);
      expect(died.statusSource).toBe('reported');

      // An `idle` stamped well before the newest record lags the transcript: today's inference.
      const records = [assistant({ uuid: 'a1', at: 10 * SECOND, tools: [{ id: 't1', name: 'Bash' }] })];
      const lagging = withReported(records, { status: 'idle', waitingFor: null, at: T0 + 7 * SECOND }, true, 12 * SECOND);
      expect(lagging.status).toBe('working');
      expect(lagging.statusSource).toBe('inferred');
      expect(lagging.reason.startsWith('Claude Code')).toBe(false);
      // …while one within the tolerance still counts.
      const current = withReported(records, { status: 'idle', waitingFor: null, at: T0 + 8 * SECOND }, true, 12 * SECOND);
      expect(current.status).toBe('interrupted');
      expect(current.statusSource).toBe('reported');
    });

    it('reports `inferred` when no reported block is passed at all', () => {
      const result = derive(finished, 2 * SECOND);
      expect(result.status).toBe('done');
      expect(result.statusSource).toBe('inferred');
    });
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

describe('subagent writes after the turn ended', () => {
  const ended = [assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn', text: 'Dispatched.' })];
  const LIVENESS = SUBAGENT_LIVENESS_MS;

  /** Derives at `atMs` with the subagents last having written `wroteAgoMs` earlier. */
  function deriveWith(
    wroteAgoMs: number | null,
    atMs: number,
    reported?: { status: string | null; waitingFor: string | null; at: number | null },
  ) {
    const now = T0 + atMs;
    const f = facts(ended, now);
    f.subagentsWrittenAt = wroteAgoMs === null ? null : now - wroteAgoMs;
    return deriveStatus({ alive: true, facts: f, now, thresholds: DEFAULT_THRESHOLDS, reported });
  }

  it('a turn that ended while its subagent is still writing stays working and says so', () => {
    const result = deriveWith(30 * SECOND, 40 * SECOND);
    expect(result.status).toBe('working');
    expect(result.statusSource).toBe('inferred');
    expect(result.reason).toBe(
      "subagent still running — it wrote 30s ago, so this turn's work is not over",
    );
    expect(deriveWith(5 * MINUTE, 6 * MINUTE).reason).toContain('wrote 5 min ago');
  });

  it('settles to done once the subagents have been quiet for the liveness window, and stays there', () => {
    const wroteAt = 10 * SECOND;
    const at = (afterMs: number) => {
      const now = T0 + wroteAt + afterMs;
      const f = facts(ended, now);
      f.subagentsWrittenAt = T0 + wroteAt;
      return deriveStatus({ alive: true, facts: f, now, thresholds: DEFAULT_THRESHOLDS }).status;
    };
    expect(at(LIVENESS - SECOND)).toBe('working');
    expect(at(LIVENESS)).toBe('done');
    expect(at(60 * MINUTE)).toBe('done');
  });

  it('a registry busy session names its subagent evidence in the reason', () => {
    const busy = { status: 'busy', waitingFor: null, at: T0 };
    const withEvidence = deriveWith(12 * SECOND, 20 * SECOND, busy);
    expect(withEvidence.status).toBe('working');
    expect(withEvidence.statusSource).toBe('reported');
    expect(withEvidence.reason).toContain('subagent still running, wrote 12s ago');
    const quiet = deriveWith(2 * LIVENESS, 3 * LIVENESS, busy);
    expect(quiet.status).toBe('working');
    expect(quiet.reason).toContain('wrote 20 min ago');
    expect(deriveWith(null, 20 * SECOND, busy).reason).not.toContain('subagent still running');
  });

  it('a registry idle session stays settled whatever its subagents wrote', () => {
    const result = deriveWith(SECOND, 20 * SECOND, { status: 'idle', waitingFor: null, at: T0 + 10 * SECOND });
    expect(result.status).toBe('done');
    expect(result.statusSource).toBe('reported');
  });

  it("a finished session's history status ignores subagent writes after its last record", () => {
    const f = facts(ended);
    f.subagentsWrittenAt = T0 + 5 * SECOND;
    expect(deriveHistoricalStatus(f, DEFAULT_THRESHOLDS)).toBe('done');
  });
});
