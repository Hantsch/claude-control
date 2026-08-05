/**
 * The committed fixtures from §10, read from disk through the real read path.
 *
 * `test/fixtures/samples/` mirrors a `~/.claude` tree. These tests exist so that the parser
 * is exercised against files, not against arrays built in memory — file size, torn lines,
 * directory casing and `readdir` behaviour are all part of what can break.
 *
 * See `test/fixtures/README.md` for what each sample pins down and why the records are
 * written to the measured shapes rather than copied from a real transcript.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSemanticRecord } from '../../src/core/adapters/claude/records.ts';
import { summarizeRecords } from '../../src/core/adapters/claude/summarize.ts';
import { readTail } from '../../src/core/adapters/claude/tail.ts';
import { readIdeWindows } from '../../src/core/adapters/claude/ide.ts';
import { ClaudeAdapter } from '../../src/core/adapters/claude/adapter.ts';
import { resolveClaudePaths } from '../../src/core/adapters/claude/paths.ts';
import { readRegistry } from '../../src/core/registry/registry.ts';
import { procStartMatches } from '../../src/core/registry/liveness.ts';
import { DEFAULT_THRESHOLDS } from '../../src/core/model/settings.ts';
import { deriveStatus } from '../../src/core/state/machine.ts';
import type { SessionStatus } from '../../src/core/model/status.ts';

const SAMPLES = new URL('../fixtures/samples/', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');
const PROJECTS = join(SAMPLES, 'projects');

const CC = join(PROJECTS, 'c--development-Hantsch-claude-control');
const MMO = join(PROJECTS, 'C--development-Hantsch-Browser-MMO');

/** Read a sample transcript the way the adapter does and derive its status at `now`. */
async function statusOf(path: string, now: number): Promise<{ status: SessionStatus; reason: string }> {
  const tail = await readTail(path, {
    initialWindowBytes: 64 * 1024,
    maxWindowBytes: 1024 * 1024,
    predicate: isSemanticRecord,
  });
  const facts = summarizeRecords(tail.records, {
    now,
    read: {
      fileSize: tail.fileSize,
      mtimeMs: tail.mtimeMs,
      windowBytes: tail.windowBytes,
      linesParsed: tail.linesParsed,
      linesSkipped: tail.linesSkipped,
      exhausted: tail.exhausted,
    },
  });
  const derived = deriveStatus({ alive: true, facts, now, thresholds: DEFAULT_THRESHOLDS });
  return { status: derived.status, reason: derived.reason };
}

describe('committed sample transcripts', () => {
  it('bookkeeping-tail: state comes from the newest semantic record, not the last line', async () => {
    const path = join(CC, 'bookkeeping-tail.jsonl');
    const raw = await readFile(path, 'utf8');
    // Precondition: the file really does end in a bookkeeping record.
    expect(raw.trimEnd().split('\n').at(-1)).toContain('"type":"last-prompt"');

    const at = Date.parse('2026-08-05T10:00:12.000Z');
    expect(await statusOf(path, at)).toMatchObject({ status: 'done' });
  });

  it('torn-tail: the half-written final line is skipped, the real state survives', async () => {
    const path = join(CC, 'torn-tail.jsonl');
    const raw = await readFile(path, 'utf8');
    expect(raw.trimEnd().endsWith('}')).toBe(false);

    // Bash was issued 3 s before this instant, well inside its 120 s budget.
    const at = Date.parse('2026-08-05T10:10:06.000Z');
    expect(await statusOf(path, at)).toMatchObject({ status: 'working' });

    // …and past it, the same file must read as "probably waiting".
    const later = Date.parse('2026-08-05T10:13:00.000Z');
    expect((await statusOf(path, later)).status).toBe('waiting');
  });

  it('queue-remove: a withdrawn queued prompt does not pin the session to queued', async () => {
    const path = join(CC, 'queue-remove.jsonl');
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"operation":"remove"');

    const at = Date.parse('2026-08-05T12:13:06.000Z');
    const result = await statusOf(path, at);
    expect(result.status).toBe('done');
    expect(result.status).not.toBe('queued');
  });

  it('synthetic-model: <synthetic> is not reported as a model and does not crash the parser', async () => {
    const path = join(CC, 'synthetic-model.jsonl');
    const tail = await readTail(path, {
      initialWindowBytes: 64 * 1024,
      maxWindowBytes: 1024 * 1024,
      predicate: isSemanticRecord,
    });
    const facts = summarizeRecords(tail.records, {
      now: Date.parse('2026-08-05T09:00:04.000Z'),
      read: {
        fileSize: tail.fileSize,
        mtimeMs: tail.mtimeMs,
        windowBytes: tail.windowBytes,
        linesParsed: tail.linesParsed,
        linesSkipped: tail.linesSkipped,
        exhausted: tail.exhausted,
      },
    });
    expect(facts.model).toBeNull();
    expect(facts.usage).toBeNull();
    expect(facts.last?.kind).toBe('assistant');
  });

  it('subagent-run: parallel tool calls pair correctly and the subagent tree is built', async () => {
    const path = join(MMO, 'subagent-run.jsonl');
    const tail = await readTail(path, {
      initialWindowBytes: 64 * 1024,
      maxWindowBytes: 1024 * 1024,
      predicate: isSemanticRecord,
    });
    const facts = summarizeRecords(tail.records, {
      now: Date.parse('2026-08-05T08:32:41.000Z'),
      read: {
        fileSize: tail.fileSize,
        mtimeMs: tail.mtimeMs,
        windowBytes: tail.windowBytes,
        linesParsed: tail.linesParsed,
        linesSkipped: tail.linesSkipped,
        exhausted: tail.exhausted,
      },
    });

    expect(facts.subagents).toHaveLength(1);
    expect(facts.subagents[0]).toMatchObject({
      label: 'Survey the combat modules',
      agentType: 'Explore',
      status: 'completed',
      // 08:30:05 → 08:32:35
      durationMs: 150_000,
      children: [],
    });
    expect(facts.branch).toBe('dev');
    expect(facts.aiTitle).toBe('Combat module survey');
    // 265 400 observed tokens against an assumed 200k window → auto-widening territory.
    expect(facts.usage!.cacheReadTokens).toBe(260_000);
  });
});

describe('committed sample registry and ide lock', () => {
  it('reads every registry entry in the documented shape', async () => {
    const { entries, problems } = await readRegistry(join(SAMPLES, 'sessions'));
    expect(problems).toHaveLength(0);
    expect(entries.map((entry) => entry.pid).sort((a, b) => a - b)).toEqual([4242, 17152, 31208]);

    const live = entries.find((entry) => entry.pid === 17_152)!;
    expect(live.name).toBe('claude-control-d5');
    expect(live.entrypoint).toBe('claude-vscode');
    expect(live.cwd).toBe('c:\\development\\Hantsch\\claude-control');
  });

  it('detects the stale entry by procStart, and accepts the live one', async () => {
    const { entries } = await readRegistry(join(SAMPLES, 'sessions'));
    const stale = entries.find((entry) => entry.pid === 4242)!;
    const live = entries.find((entry) => entry.pid === 17_152)!;

    // The PID is alive but the process was created at a different time → different process.
    expect(procStartMatches(stale.procStart, '134303945409015547')).toBe(false);
    expect(procStartMatches(live.procStart, '134303945409015547')).toBe(true);
  });

  /**
   * The end-to-end path over committed files: registry → slug → project directory →
   * transcript → status. `subagent-run`'s `cwd` starts with a lower-case `c:` while its
   * directory on disk starts with `C--`, so this is where the case-insensitive slug lookup
   * has to hold (RESEARCH.md §2).
   */
  it('resolves both sessions from the registry to their transcripts, despite slug casing', async () => {
    const adapter = new ClaudeAdapter({
      paths: resolveClaudePaths(SAMPLES),
      tailWindowBytes: 64 * 1024,
      maxTailWindowBytes: 1024 * 1024,
      thresholds: DEFAULT_THRESHOLDS,
      probe: {
        // Both PIDs "alive" with a matching creation stamp; 4242's stamp deliberately differs.
        alive: async (pids) => new Set(pids),
        creationStamps: async () => new Map([[4242, '134303945409015547']]),
      },
    });

    const refs = await adapter.discoverLiveSessions();
    const bySession = new Map(refs.map((ref) => [ref.sessionId, ref]));

    // The stale entry is dropped by the procStart cross-check, the other two resolve.
    expect([...bySession.keys()].sort()).toEqual(['bookkeeping-tail', 'subagent-run']);
    expect(bySession.get('subagent-run')!.transcriptPath).toMatch(
      /C--development-Hantsch-Browser-MMO[\\/]subagent-run\.jsonl$/,
    );
    expect(bySession.get('bookkeeping-tail')!.transcriptPath).toMatch(/bookkeeping-tail\.jsonl$/);

    const snapshot = await adapter.readStatus(bySession.get('subagent-run')!);
    expect(snapshot.project.name).toBe('Browser-MMO');
    expect(snapshot.facts.subagents).toHaveLength(1);
  });

  it('parses the ide lock without ever carrying authToken through', async () => {
    const refs = await readIdeWindows(join(SAMPLES, 'ide'));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ pid: 25_196, ideName: 'Visual Studio Code' });

    const serialized = JSON.stringify(refs);
    expect(serialized).not.toContain('FIXTURE-FAKE-TOKEN');
    expect(serialized).not.toContain('authToken');

    // Precondition: the sample really does contain a token to leak.
    const raw = await readFile(join(SAMPLES, 'ide', '41000.lock'), 'utf8');
    expect(raw).toContain('FIXTURE-FAKE-TOKEN');
  });
});
