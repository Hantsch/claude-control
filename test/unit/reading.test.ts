/**
 * Reading strategy tests (§5.2): tail windows, torn writes, bookkeeping tails, and the
 * Claude-specific path handling from RESEARCH.md §2.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonlChunk } from '../../src/core/adapters/claude/jsonl.ts';
import {
  isPathInside,
  normalizePathKey,
  projectRefForCwd,
  slugForCwd,
} from '../../src/core/adapters/claude/paths.ts';
import { isPromptRecord, isSemanticRecord } from '../../src/core/adapters/claude/records.ts';
import { summarizeRecords } from '../../src/core/adapters/claude/summarize.ts';
import { runningSubagentCount } from '../../src/core/state/subagents.ts';
import { readHead, readTail, scanRecordsFromEnd } from '../../src/core/adapters/claude/tail.ts';
import { matchIdeWindow, parseIdeLock, readIdeWindows } from '../../src/core/adapters/claude/ide.ts';
import {
  T0,
  agentErrorResult,
  agentLaunchedResult,
  agentResult,
  assistant,
  aiTitle,
  fileHistorySnapshot,
  ideLock,
  lastPrompt,
  makeFixtureTree,
  prompt,
  toJsonl,
  toJsonlWithTornTail,
  toolResult,
} from '../fixtures/builders.ts';

const READ_DIAG = {
  fileSize: 0,
  mtimeMs: 0,
  windowBytes: 0,
  startOffset: 0,
  linesParsed: 0,
  linesSkipped: 0,
  exhausted: false,
  error: null,
};

describe('slug and path handling', () => {
  it('derives the project slug the way Claude Code does', () => {
    expect(slugForCwd('c:\\development\\Hantsch\\claude-control')).toBe(
      'c--development-Hantsch-claude-control',
    );
  });

  it('matches paths case-insensitively, because slug casing is inconsistent on disk', () => {
    expect(normalizePathKey('C:\\Development\\X\\')).toBe('c:/development/x');
    expect(isPathInside('c:\\dev\\proj\\sub', 'C:/DEV/PROJ')).toBe(true);
    expect(isPathInside('c:\\dev\\proj2', 'C:/dev/proj')).toBe(false);
  });

  it('names a project after its last path segment', () => {
    const ref = projectRefForCwd('c:\\development\\Hantsch\\claude-control\\');
    expect(ref.name).toBe('claude-control');
    expect(ref.key).toBe('c:/development/hantsch/claude-control');
  });
});

describe('parseJsonlChunk', () => {
  it('skips a torn final line silently instead of reporting corruption', () => {
    const text = toJsonlWithTornTail([assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' })]);
    const result = parseJsonlChunk(text, { dropFirstPartial: false });
    expect(result.records).toHaveLength(1);
    expect(result.tornTail).toBe(true);
    expect(result.linesSkipped).toBe(0);
  });

  it('drops the partial first line of a mid-file window', () => {
    const text = '{"partial": tru\n{"type":"user","uuid":"u1"}\n';
    const result = parseJsonlChunk(text, { dropFirstPartial: true });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.uuid).toBe('u1');
  });

  it('counts a broken line in the middle as skipped, not as a torn tail', () => {
    const text = '{"type":"user","uuid":"u1"}\nNOT JSON\n{"type":"user","uuid":"u2"}\n';
    const result = parseJsonlChunk(text, { dropFirstPartial: false });
    expect(result.records).toHaveLength(2);
    expect(result.linesSkipped).toBe(1);
    expect(result.tornTail).toBe(false);
  });
});

describe('readTail', () => {
  it('finds the newest semantic record behind a bookkeeping tail', async () => {
    const tree = await makeFixtureTree();
    const path = await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'session-1',
      toJsonl([
        prompt('u1', 0),
        assistant({ uuid: 'a1', at: 1_000, stopReason: 'end_turn', text: 'Done.' }),
        aiTitle('Fixture session', 1_100),
        fileHistorySnapshot(1_200),
        lastPrompt('u1'),
      ]),
    );

    const tail = await readTail(path, {
      initialWindowBytes: 64 * 1024,
      maxWindowBytes: 1024 * 1024,
      predicate: isSemanticRecord,
    });
    expect(tail.exhausted).toBe(false);

    const facts = summarizeRecords(tail.records, { now: T0, read: READ_DIAG });
    expect(facts.last?.kind).toBe('assistant');
    expect(facts.last?.stopReason).toBe('end_turn');
    expect(facts.aiTitle).toBe('Fixture session');
  });

  it('doubles the window until a semantic record is inside it', async () => {
    const tree = await makeFixtureTree();
    // 8 KB of bookkeeping after the only semantic record, with a 1 KB initial window.
    const padding = Array.from({ length: 40 }, (_, i) => fileHistorySnapshot(i));
    const path = await tree.writeTranscript(
      'proj',
      'session-2',
      toJsonl([assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' }), ...padding]),
    );

    const tail = await readTail(path, {
      initialWindowBytes: 1024,
      maxWindowBytes: 1024 * 1024,
      predicate: isSemanticRecord,
    });
    expect(tail.windowBytes).toBeGreaterThan(1024);
    expect(tail.records.some(isSemanticRecord)).toBe(true);
    expect(tail.exhausted).toBe(false);
  });

  it('reports exhausted rather than guessing when nothing semantic fits the ceiling', async () => {
    const tree = await makeFixtureTree();
    const padding = Array.from({ length: 200 }, (_, i) => fileHistorySnapshot(i));
    const path = await tree.writeTranscript(
      'proj',
      'session-3',
      toJsonl([assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' }), ...padding]),
    );

    const tail = await readTail(path, {
      initialWindowBytes: 512,
      maxWindowBytes: 2048,
      predicate: isSemanticRecord,
    });
    expect(tail.exhausted).toBe(true);
  });

  it('reads only the tail window, not the whole file', async () => {
    const tree = await makeFixtureTree();
    const filler = Array.from({ length: 500 }, (_, i) => prompt(`u${i}`, i));
    const path = await tree.writeTranscript(
      'proj',
      'session-4',
      toJsonl([...filler, assistant({ uuid: 'last', at: 600_000, stopReason: 'end_turn' })]),
    );
    const size = (await readFile(path)).byteLength;

    const tail = await readTail(path, {
      initialWindowBytes: 8 * 1024,
      maxWindowBytes: 64 * 1024,
      predicate: isSemanticRecord,
    });
    expect(size).toBeGreaterThan(8 * 1024);
    expect(tail.startOffset).toBeGreaterThan(0);
    expect(tail.records.length).toBeLessThan(filler.length);
  });
});

describe('scanRecordsFromEnd', () => {
  /**
   * The run-start anchor is regularly outside the tail window — a single turn can be
   * megabytes of tool traffic — so this scan is what makes "how long did the run take"
   * answerable at all. Its risk is the chunk boundary, which is what these tests aim at.
   */
  it('finds the newest prompt far outside any tail window, across chunk boundaries', async () => {
    const tree = await makeFixtureTree();
    const records = [
      prompt('old', 0, 'the first prompt'),
      // Umlauts on purpose: a chunk can split a multi-byte character, and the stitched line
      // must still parse.
      ...Array.from({ length: 300 }, (_, i) =>
        assistant({ uuid: `a${i}`, at: 1_000 + i, text: `Zwischenschritt über Änderungen ${i}` }),
      ),
      prompt('newest', 500_000, 'the prompt that started this run'),
      ...Array.from({ length: 300 }, (_, i) =>
        assistant({ uuid: `b${i}`, at: 600_000 + i, text: `Weiter mit Größen ${i}` }),
      ),
    ];
    const path = await tree.writeTranscript('proj', 'session-scan', toJsonl(records));
    const size = (await readFile(path)).byteLength;

    const hit = await scanRecordsFromEnd(path, isPromptRecord, {
      chunkBytes: 4096,
      maxBytes: 4 * 1024 * 1024,
    });
    expect(hit.record?.uuid).toBe('newest');
    // It stopped at the hit instead of walking the whole file.
    expect(hit.bytesScanned).toBeLessThan(size);
  });

  it('gives up at its byte budget instead of reading the whole file', async () => {
    const tree = await makeFixtureTree();
    const records = [
      prompt('old', 0, 'unreachable prompt'),
      ...Array.from({ length: 400 }, (_, i) => assistant({ uuid: `a${i}`, at: 1_000 + i, text: `step ${i}` })),
    ];
    const path = await tree.writeTranscript('proj', 'session-budget', toJsonl(records));

    const hit = await scanRecordsFromEnd(path, isPromptRecord, { chunkBytes: 4096, maxBytes: 8 * 1024 });
    expect(hit.record).toBeNull();
    expect(hit.reachedStart).toBe(false);
    expect(hit.bytesScanned).toBeLessThanOrEqual(8 * 1024);
  });

  it('reports reaching the start, so "not found" can be told apart from "out of budget"', async () => {
    const tree = await makeFixtureTree();
    const path = await tree.writeTranscript(
      'proj',
      'session-nostart',
      toJsonl([assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' })]),
    );
    const hit = await scanRecordsFromEnd(path, isPromptRecord, { chunkBytes: 4096, maxBytes: 1024 * 1024 });
    expect(hit.record).toBeNull();
    expect(hit.reachedStart).toBe(true);
  });
});

describe('readHead', () => {
  it('recovers the first semantic record for the history index', async () => {
    const tree = await makeFixtureTree();
    const path = await tree.writeTranscript(
      'proj',
      'session-5',
      toJsonl([prompt('u1', 0), assistant({ uuid: 'a1', at: 1_000, stopReason: 'end_turn' })]),
    );
    const head = await readHead(path, 32 * 1024);
    expect(head.records[0]!.uuid).toBe('u1');
  });
});

describe('tool pairing and subagents', () => {
  it('pairs results by tool_use_id, so parallel calls stay distinct', () => {
    const records = [
      assistant({
        uuid: 'a1',
        at: 0,
        tools: [
          { id: 't1', name: 'Read' },
          { id: 't2', name: 'Agent', input: { description: 'child work', subagent_type: 'Explore' } },
        ],
      }),
      toolResult('u1', 5_000, { assistantUuid: 'a1', toolUseId: 't1' }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 10_000, read: READ_DIAG });

    // The Read call is answered; the Agent call is not. Because the newest semantic record
    // is that tool result rather than the assistant record, the unanswered Agent call is a
    // *stalled* tool (display only) and not a `pendingTool` — the §6.2 rule keys on the
    // newest semantic record, so a partially answered turn stays `working`.
    expect(facts.pendingTools).toHaveLength(0);
    expect(facts.stalledTools.map((tool) => tool.name)).toEqual(['Agent']);
    expect(facts.subagents).toHaveLength(1);
    expect(facts.subagents[0]!.status).toBe('running');
    expect(facts.subagents[0]!.label).toBe('child work');
    expect(facts.subagents[0]!.agentType).toBe('Explore');
  });

  it('completes a subagent when its result arrives, with a duration', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      toolResult('u1', 30_000, { assistantUuid: 'a1', toolUseId: 't1' }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 40_000, read: READ_DIAG });
    expect(facts.subagents[0]!.status).toBe('completed');
    expect(facts.subagents[0]!.durationMs).toBe(30_000);
    expect(facts.pendingTools).toHaveLength(0);
  });

  it('reads a finished subagent\'s own run numbers, including its context estimate', () => {
    const records = [
      prompt('u0', 0, 'delegate it'),
      assistant({ uuid: 'a1', at: 1_000, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      agentResult('u1', 901_106, { assistantUuid: 'a1', toolUseId: 't1' }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 950_000, read: READ_DIAG });
    const node = facts.subagents[0]!;

    expect(node.status).toBe('completed');
    expect(node.agentId).toBe('agent-1');
    // The run's own `totalDurationMs`, not the timestamp difference (900 106 vs 900 106+).
    expect(node.durationMs).toBe(900_106);
    expect(node.metrics).toMatchObject({
      model: 'claude-opus-5[1m]',
      totalTokens: 67_430,
      toolUses: 10,
      linesAdded: 122,
      linesRemoved: 26,
    });
    // 2 + 318 + 64 400 against the 1M window the `[1m]` suffix resolves to.
    expect(node.metrics!.context).toMatchObject({ used: 64_720, window: 1_000_000, band: 'green' });
  });

  it('keeps a running subagent free of run numbers, because none exist yet', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 5_000, read: READ_DIAG });
    expect(facts.subagents[0]!.status).toBe('running');
    expect(facts.subagents[0]!.metrics).toBeNull();
    expect(facts.subagents[0]!.durationMs).toBe(5_000);
  });

  it('takes the report from the last text block of the result, like a session\'s last message', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      agentResult('u1', 60_000, {
        assistantUuid: 'a1',
        toolUseId: 't1',
        content: [
          { type: 'text', text: 'An interim note from halfway through' },
          { type: 'thinking', thinking: 'not a report' },
          { type: 'text', text: 'Three combat modules are relevant.' },
        ],
      }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 61_000, read: READ_DIAG });
    expect(facts.subagents[0]!.finalText).toBe('Three combat modules are relevant.');
  });

  it('accepts a plain-string content too, which is how some results deliver the report', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      agentResult('u1', 60_000, {
        assistantUuid: 'a1',
        toolUseId: 't1',
        content: '  Survey done:\n  three modules.  ',
      }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 61_000, read: READ_DIAG });
    // Collapsed to one line, because a row is one line.
    expect(facts.subagents[0]!.finalText).toBe('Survey done: three modules.');
  });

  it('clips a long report at the adapter boundary, so the renderer never sees the full text', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      agentResult('u1', 60_000, {
        assistantUuid: 'a1',
        toolUseId: 't1',
        content: [{ type: 'text', text: `${'A long report that keeps going. '.repeat(12)}TAIL-MARKER` }],
      }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 61_000, read: READ_DIAG });
    const finalText = facts.subagents[0]!.finalText!;

    expect(finalText.startsWith('A long report that keeps going.')).toBe(true);
    // `toolInputHint`'s 120-character rule, not a third convention.
    expect(finalText.length).toBeLessThanOrEqual(120);
    expect(finalText.endsWith('…')).toBe(true);
    expect(JSON.stringify(facts)).not.toContain('TAIL-MARKER');
  });

  it('reports no final message when the result object carries no text', () => {
    const records = [
      assistant({
        uuid: 'a1',
        at: 0,
        tools: [
          { id: 't1', name: 'Agent', input: { description: 'no text block' } },
          { id: 't2', name: 'Agent', input: { description: 'no content at all' } },
        ],
      }),
      agentResult('u1', 60_000, {
        assistantUuid: 'a1',
        toolUseId: 't1',
        content: [{ type: 'image', source: {} }],
      }),
      agentResult('u2', 60_000, { assistantUuid: 'a1', toolUseId: 't2', content: undefined }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 61_000, read: READ_DIAG });

    expect(facts.subagents.map((node) => node.finalText)).toEqual([null, null]);
    // The numbers still arrived — it is the text that is missing, not the result.
    expect(facts.subagents[0]!.metrics!.totalTokens).toBe(67_430);
  });

  it('never mistakes a failed run\'s error string for a report', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      agentErrorResult('u1', 5_000, { assistantUuid: 'a1', toolUseId: 't1' }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 6_000, read: READ_DIAG });
    const node = facts.subagents[0]!;

    // The plain-string result shape is the death notice; only `errorText` may carry it.
    expect(node.errorText).toMatch(/529 Overloaded/);
    expect(node.finalText).toBeNull();
  });

  it('shows no report for a running subagent, because none exists yet', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 5_000, read: READ_DIAG });
    expect(facts.subagents[0]!.status).toBe('running');
    expect(facts.subagents[0]!.finalText).toBeNull();
  });

  it('leaves a launched run textless and never opens its outputFile', () => {
    const records = [
      assistant({
        uuid: 'a1',
        at: 0,
        tools: [{ id: 't1', name: 'Agent', input: { description: 'background work' } }],
      }),
      agentLaunchedResult('u1', 2_400, { assistantUuid: 'a1', toolUseId: 't1' }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 3_600_000, read: READ_DIAG });

    expect(facts.subagents[0]!.status).toBe('launched');
    expect(facts.subagents[0]!.finalText).toBeNull();
    // Opening that second file would be a new data source and a new read cost.
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain('outputFile');
    expect(serialized).not.toContain('agent-bg.jsonl');
  });

  it('never retains the subagent prompt, and keeps only a clipped row of its report (§4)', () => {
    const report = `PRIVATE REPORT — ${'the body runs on and on and on. '.repeat(8)}END-OF-REPORT`;
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      agentResult('u1', 60_000, {
        assistantUuid: 'a1',
        toolUseId: 't1',
        content: [{ type: 'text', text: report }],
      }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 61_000, read: READ_DIAG });
    const serialized = JSON.stringify(facts);

    // The prompt is still not read — anywhere, not just on the node.
    expect(serialized).not.toContain('PRIVATE PROMPT');
    // The report is read, but only ever as much of it as fits on a row.
    expect(facts.subagents[0]!.finalText).toContain('PRIVATE REPORT');
    expect(facts.subagents[0]!.finalText!.length).toBeLessThanOrEqual(120);
    expect(facts.subagents[0]!.finalText!.endsWith('…')).toBe(true);
    expect(serialized).not.toContain('END-OF-REPORT');
  });

  it('shows the declared model while a subagent is still running', () => {
    const records = [
      assistant({
        uuid: 'a1',
        at: 0,
        tools: [{ id: 't1', name: 'Agent', input: { description: 'x', model: 'sonnet' } }],
      }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 5_000, read: READ_DIAG });
    expect(facts.subagents[0]!.status).toBe('running');
    expect(facts.subagents[0]!.model).toBe('sonnet');
  });

  it('lets the resolved model win once the result arrives, even over a different declared alias', () => {
    const records = [
      assistant({
        uuid: 'a1',
        at: 0,
        tools: [{ id: 't1', name: 'Agent', input: { description: 'x', model: 'haiku' } }],
      }),
      agentResult('u1', 60_000, {
        assistantUuid: 'a1',
        toolUseId: 't1',
        model: 'claude-opus-5[1m]',
      }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 61_000, read: READ_DIAG });
    expect(facts.subagents[0]!.status).toBe('completed');
    expect(facts.subagents[0]!.model).toBe('claude-opus-5[1m]');
  });

  it('shows no model at all when none was declared, whether running or finished', () => {
    const runningRecords = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
    ];
    const running = summarizeRecords(runningRecords as never, { now: T0 + 5_000, read: READ_DIAG });
    expect(running.subagents[0]!.status).toBe('running');
    expect(running.subagents[0]!.model).toBeNull();

    const noModelResult = agentResult('u1', 60_000, { assistantUuid: 'a1', toolUseId: 't1' });
    delete (noModelResult.toolUseResult as Record<string, unknown>).resolvedModel;
    const finishedRecords = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      noModelResult,
    ];
    const finished = summarizeRecords(finishedRecords as never, { now: T0 + 61_000, read: READ_DIAG });
    expect(finished.subagents[0]!.status).toBe('completed');
    expect(finished.subagents[0]!.model).toBeNull();
  });

  it('ignores the run-number shape for ordinary tool results', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] }),
      toolResult('u1', 1_000, { assistantUuid: 'a1', toolUseId: 't1' }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 2_000, read: READ_DIAG });
    expect(facts.subagents).toHaveLength(0);
  });

  it('reports a background subagent as launched, not as a two-second completed run', () => {
    const records = [
      assistant({
        uuid: 'a1',
        at: 0,
        tools: [{ id: 't1', name: 'Agent', input: { description: 'background work' } }],
      }),
      agentLaunchedResult('u1', 2_400, { assistantUuid: 'a1', toolUseId: 't1' }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 3_600_000, read: READ_DIAG });
    const node = facts.subagents[0]!;

    expect(node.status).toBe('launched');
    // The result is not an end: the elapsed time counts from the launch, not to the result.
    expect(node.endedAt).toBeNull();
    expect(node.durationMs).toBe(3_600_000);
    expect(node.metrics).toMatchObject({ model: 'claude-opus-5[1m]', totalTokens: null });
    // And it must not be mistaken for a subagent we can watch finish.
    expect(runningSubagentCount(facts.subagents)).toBe(0);
  });

  it('keeps the reason a subagent run died', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      agentErrorResult('u1', 5_000, { assistantUuid: 'a1', toolUseId: 't1' }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 6_000, read: READ_DIAG });
    expect(facts.subagents[0]!.status).toBe('failed');
    expect(facts.subagents[0]!.errorText).toMatch(/529 Overloaded/);
    expect(facts.subagents[0]!.metrics?.totalTokens ?? null).toBeNull();
  });

  it('marks a failed subagent as failed', () => {
    const records = [
      assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent', input: { description: 'x' } }] }),
      toolResult('u1', 1_000, { assistantUuid: 'a1', toolUseId: 't1', isError: true }),
    ];
    const facts = summarizeRecords(records as never, { now: T0 + 2_000, read: READ_DIAG });
    expect(facts.subagents[0]!.status).toBe('failed');
  });

  it('falls back to sourceToolAssistantUUID when the result has no tool_use_id', () => {
    const result = toolResult('u1', 4_000, { assistantUuid: 'a1', toolUseId: 'ignored' });
    (result.message as { content: unknown[] }).content = [];
    const records = [assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] }), result];
    const facts = summarizeRecords(records as never, { now: T0 + 5_000, read: READ_DIAG });
    expect(facts.pendingTools).toHaveLength(0);
  });
});

describe('ide locks', () => {
  it('never returns authToken or any other field beyond pid/folders/ideName', () => {
    const ref = parseIdeLock(JSON.stringify(ideLock({ pid: 25_196, folders: ['c:\\dev\\x'] })), 'x.lock');
    expect(ref).not.toBeNull();
    expect(Object.keys(ref!).sort()).toEqual(['ideName', 'pid', 'source', 'workspaceFolders']);
    expect(JSON.stringify(ref)).not.toContain('fixture-secret');
  });

  it('picks the longest matching workspace folder', () => {
    const refs = [
      { pid: 1, ideName: 'VS Code', workspaceFolders: ['c:\\dev'], source: 'a' },
      { pid: 2, ideName: 'VS Code', workspaceFolders: ['c:\\dev\\proj'], source: 'b' },
    ];
    expect(matchIdeWindow('c:\\dev\\proj\\sub', refs)?.ref.pid).toBe(2);
    expect(matchIdeWindow('c:\\other', refs)).toBeNull();
  });

  it('reads a directory of locks and ignores non-lock files', async () => {
    const tree = await makeFixtureTree();
    await tree.writeIdeLock(41_000, ideLock({ pid: 999, folders: ['c:\\dev\\proj'] }));
    await writeFile(join(tree.ideDir, 'notes.txt'), 'ignore me', 'utf8');
    const refs = await readIdeWindows(tree.ideDir);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.pid).toBe(999);
  });
});
