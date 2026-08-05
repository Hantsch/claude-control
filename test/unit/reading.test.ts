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
import { isSemanticRecord } from '../../src/core/adapters/claude/records.ts';
import { summarizeRecords } from '../../src/core/adapters/claude/summarize.ts';
import { readHead, readTail } from '../../src/core/adapters/claude/tail.ts';
import { matchIdeWindow, parseIdeLock, readIdeWindows } from '../../src/core/adapters/claude/ide.ts';
import {
  T0,
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
  linesParsed: 0,
  linesSkipped: 0,
  exhausted: false,
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
