/**
 * Story: a session whose subagent is still working must not read `stale` (§6.2) — the fact
 * was available on disk and simply not read, so it is covered here against the real on-disk
 * layout. The other half of that story, picking *this* session's window out of a shared host
 * process, lives in `focusWindowPick.test.ts`.
 */

import { appendFile, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../src/core/adapters/claude/adapter.ts';
import {
  SubagentActivityReader,
  subagentDirForTranscript,
  type SubagentFs,
} from '../../src/core/adapters/claude/subagentFiles.ts';
import { resolveClaudePaths } from '../../src/core/adapters/claude/paths.ts';
import { DEFAULT_THRESHOLDS } from '../../src/core/model/settings.ts';
import { deriveStatus } from '../../src/core/state/machine.ts';
import { T0, agentLaunchedResult, assistant, makeFixtureTree, toJsonl } from '../fixtures/builders.ts';

const MINUTE = 60_000;
const SLUG = 'c--dev-proj';
const SESSION = 'sess-1';
const TOOL_USE_ID = 'toolu_agent_042';

/** A parent transcript whose newest record is an unanswered `Agent` call. */
function parentTranscript(): string {
  return toJsonl([
    assistant({
      uuid: 'a1',
      at: 0,
      tools: [
        {
          id: TOOL_USE_ID,
          name: 'Agent',
          input: { description: 'Build story 042', subagent_type: 'general-purpose' },
        },
      ],
    }),
  ]);
}

async function fixture(options: {
  /** ms after T0 that the subagent's own transcript was last written. */
  subagentAt?: number;
  /** A run spawned *by* the subagent, with its own newer write. */
  grandchildAt?: number;
  /** Leave the subagent directory out entirely — an agent version that writes none. */
  noSubagentFiles?: boolean;
}) {
  const tree = await makeFixtureTree('cc-subagent-');
  const transcript = await tree.writeTranscript(SLUG, SESSION, parentTranscript());
  if (!options.noSubagentFiles) {
    await tree.writeSubagent({
      slug: SLUG,
      sessionId: SESSION,
      agentId: 'a4468',
      toolUseId: TOOL_USE_ID,
      at: T0 + (options.subagentAt ?? 0),
    });
    if (options.grandchildAt !== undefined) {
      await tree.writeSubagent({
        slug: SLUG,
        sessionId: SESSION,
        agentId: 'a3fb5',
        toolUseId: 'toolu_inner',
        parentAgentId: 'a4468',
        at: T0 + options.grandchildAt,
      });
    }
  }
  return { tree, transcript };
}

/** A parent that launched the subagent in the background and then ended its turn. */
async function launchedFixture() {
  const tree = await makeFixtureTree('cc-subagent-');
  const transcript = await tree.writeTranscript(
    SLUG,
    SESSION,
    toJsonl([
      assistant({ uuid: 'a1', at: 0, tools: [{ id: TOOL_USE_ID, name: 'Agent', input: { description: 'Build story 042' } }] }),
      agentLaunchedResult('r1', 1_000, { assistantUuid: 'a1', toolUseId: TOOL_USE_ID }),
      assistant({ uuid: 'a2', at: 2_000, stopReason: 'end_turn', text: 'Running in the background.' }),
    ]),
  );
  await tree.writeSubagent({
    slug: SLUG,
    sessionId: SESSION,
    agentId: 'a4468',
    toolUseId: TOOL_USE_ID,
    at: T0 + 41 * MINUTE,
  });
  return { tree, transcript };
}

/** Status of that session `atMs` after T0, read through the real adapter. */
async function statusAt(tree: Awaited<ReturnType<typeof fixture>>['tree'], atMs: number) {
  const now = T0 + atMs;
  const adapter = new ClaudeAdapter({
    paths: resolveClaudePaths(tree.root),
    tailWindowBytes: 64 * 1024,
    maxTailWindowBytes: 1024 * 1024,
    probe: { alive: async (pids) => new Set(pids), creationStamps: async () => new Map() },
    thresholds: DEFAULT_THRESHOLDS,
    now: () => now,
  });
  const snapshot = await adapter.readStatus({
    sessionId: SESSION,
    pid: 4242,
    cwd: 'c:\\dev\\proj',
    name: 'proj-1',
    entrypoint: 'claude-vscode',
    kind: 'interactive',
    agentVersion: '2.1.241',
    startedAt: T0,
    procStart: null,
    transcriptPath: null,
    source: 'fixture',
    reportedStatus: null,
    waitingFor: null,
    reportedAt: null,
  });
  return {
    snapshot,
    adapter,
    result: deriveStatus({
      alive: true,
      facts: snapshot.facts,
      now,
      thresholds: DEFAULT_THRESHOLDS,
    }),
  };
}

describe('a running subagent is evidence that the session is working', () => {
  it('stays working past the Agent budget while the subagent writes', async () => {
    // The reported bug: an `Agent` call 42 min old (budget 20 min) whose subagent had
    // written seconds earlier was shown as `stale`.
    const { tree } = await fixture({ subagentAt: 41 * MINUTE });
    const { result } = await statusAt(tree, 42 * MINUTE);
    expect(result.status).toBe('working');
    expect(result.reason).toContain('subagent wrote');
    // The call's own age is still reported honestly — only the verdict changed.
    expect(result.ageMs).toBe(42 * MINUTE);
  });

  it('counts a write by a subagent of the subagent, which the direct one cannot show', async () => {
    // A subagent blocked in its own `Agent` call writes nothing itself; the run is alive all
    // the same, and the grandchild's file is the only place that says so.
    const { tree } = await fixture({ subagentAt: 5 * MINUTE, grandchildAt: 41 * MINUTE });
    const { result } = await statusAt(tree, 42 * MINUTE);
    expect(result.status).toBe('working');
  });

  it('still goes stale when the subagent itself has gone quiet past the budget', async () => {
    const { tree } = await fixture({ subagentAt: 5 * MINUTE });
    const { result } = await statusAt(tree, 42 * MINUTE);
    expect(result.status).toBe('stale');
  });

  it('behaves exactly as before for an agent version that writes no subagent transcripts', async () => {
    const { tree } = await fixture({ noSubagentFiles: true });
    const { snapshot, result } = await statusAt(tree, 42 * MINUTE);
    expect(snapshot.facts.subagentActivityAt).toBeNull();
    expect(result.status).toBe('stale');
  });

  it('puts the activity on the running node so the UI can say the run is alive', async () => {
    const { tree } = await fixture({ subagentAt: 41 * MINUTE });
    const { snapshot } = await statusAt(tree, 42 * MINUTE);
    const node = snapshot.facts.subagents.find((n) => n.id === TOOL_USE_ID);
    expect(node?.status).toBe('running');
    expect(node?.lastActivityAt).toBe(T0 + 41 * MINUTE);
  });

  it('a background-launched subagent node carries the time of its latest write', async () => {
    const { tree, transcript } = await launchedFixture();
    const { snapshot } = await statusAt(tree, 42 * MINUTE);
    const node = snapshot.facts.subagents.find((n) => n.id === TOOL_USE_ID);
    expect(node?.status).toBe('launched');
    expect(node?.lastActivityAt).toBe(T0 + 41 * MINUTE);
    expect(transcript).toBeTruthy();
  });

  it('a refresh after the subagent file vanished carries no earlier write time', async () => {
    const { tree } = await launchedFixture();
    const { snapshot, adapter } = await statusAt(tree, 42 * MINUTE);
    expect(snapshot.facts.subagents[0]?.lastActivityAt).toBe(T0 + 41 * MINUTE);
    await rm(join(tree.root, 'projects', SLUG, SESSION, 'subagents'), { recursive: true, force: true });
    const refreshed = await adapter.refreshSubagentActivity!(snapshot, T0 + 43 * MINUTE);
    expect(refreshed.facts.subagents[0]?.lastActivityAt ?? null).toBeNull();
    expect(refreshed.facts.subagentActivityAt).toBeNull();
  });
});

describe('SubagentActivityReader', () => {
  it('reports nothing for a tool_use id no sidecar names', async () => {
    const { transcript } = await fixture({ subagentAt: 0 });
    const reader = new SubagentActivityReader();
    const found = await reader.newestActivity(SESSION, subagentDirForTranscript(transcript), [
      'toolu_never_spawned',
    ]);
    expect(found.size).toBe(0);
  });

  it('picks up a subagent that started after the index was first read', async () => {
    const { tree, transcript } = await fixture({ subagentAt: 0 });
    const dir = subagentDirForTranscript(transcript);
    const reader = new SubagentActivityReader();
    await reader.newestActivity(SESSION, dir, [TOOL_USE_ID]);

    await tree.writeSubagent({
      slug: SLUG,
      sessionId: SESSION,
      agentId: 'later',
      toolUseId: 'toolu_later',
      at: T0 + MINUTE,
    });
    const found = await reader.newestActivity(SESSION, dir, ['toolu_later']);
    expect(found.get('toolu_later')).toBe(T0 + MINUTE);
  });

  it('returns an empty map when there is no subagent directory at all', async () => {
    const { transcript } = await fixture({ noSubagentFiles: true });
    const reader = new SubagentActivityReader();
    const found = await reader.newestActivity(SESSION, subagentDirForTranscript(transcript), [
      TOOL_USE_ID,
    ]);
    expect(found.size).toBe(0);
  });
});

/** Real filesystem calls, recorded so a test can say exactly what a pass touched. */
function countingFs() {
  const calls = { stat: [] as string[], readdir: [] as string[], readFile: [] as string[] };
  const fs: SubagentFs = {
    stat: (path) => {
      calls.stat.push(path);
      return stat(path);
    },
    readdir: (path) => {
      calls.readdir.push(path);
      return readdir(path);
    },
    readFile: (path, encoding) => {
      calls.readFile.push(path);
      return readFile(path, encoding);
    },
  };
  const reset = () => {
    calls.stat.length = 0;
    calls.readdir.length = 0;
    calls.readFile.length = 0;
  };
  return { fs, calls, reset };
}

describe('session-wide subagent activity', () => {
  it('finds the newest write across every subagent file of a session, linked or not', async () => {
    const { tree, transcript } = await fixture({ subagentAt: MINUTE, grandchildAt: 3 * MINUTE });
    // No `toolUseId` in its sidecar: no node in the tree can point at this run.
    await tree.writeSubagent({
      slug: SLUG,
      sessionId: SESSION,
      agentId: 'unlinked',
      toolUseId: null,
      at: T0 + 5 * MINUTE,
    });
    const reader = new SubagentActivityReader();
    const newest = await reader.sessionActivity(
      SESSION,
      subagentDirForTranscript(transcript),
      'stamp-1',
      T0 + 6 * MINUTE,
    );
    expect(newest).toBe(T0 + 5 * MINUTE);
  });

  it('a steady-state pass stats the directory and the recently written files only', async () => {
    const tree = await makeFixtureTree('cc-subagent-');
    const transcript = await tree.writeTranscript(SLUG, SESSION, parentTranscript());
    for (let i = 0; i < 50; i++) {
      await tree.writeSubagent({ slug: SLUG, sessionId: SESSION, agentId: `old${i}`, at: T0 });
    }
    await tree.writeSubagent({ slug: SLUG, sessionId: SESSION, agentId: 'hot', at: T0 + 29 * MINUTE });
    const dir = subagentDirForTranscript(transcript);
    const { fs, calls, reset } = countingFs();
    const reader = new SubagentActivityReader({ fs });

    expect(await reader.sessionActivity(SESSION, dir, 'stamp-1', T0 + 30 * MINUTE)).toBe(T0 + 29 * MINUTE);
    expect(calls.readdir).toHaveLength(1);
    expect(calls.stat).toHaveLength(52);

    reset();
    expect(await reader.sessionActivity(SESSION, dir, 'stamp-1', T0 + 30 * MINUTE + 5_000)).toBe(
      T0 + 29 * MINUTE,
    );
    expect(calls.readdir).toHaveLength(0);
    expect(calls.stat).toEqual([dir, join(dir, 'agent-hot.jsonl')]);
  });

  it('a file that grows without changing the directory is still seen as written', async () => {
    const tree = await makeFixtureTree('cc-subagent-');
    const transcript = await tree.writeTranscript(SLUG, SESSION, parentTranscript());
    const file = await tree.writeSubagent({
      slug: SLUG,
      sessionId: SESSION,
      agentId: 'a4468',
      at: T0 + 29 * MINUTE,
    });
    const dir = subagentDirForTranscript(transcript);
    const { fs, calls, reset } = countingFs();
    const reader = new SubagentActivityReader({ fs });
    await reader.sessionActivity(SESSION, dir, 'stamp-1', T0 + 30 * MINUTE);

    const dirBefore = (await stat(dir)).mtimeMs;
    await appendFile(file, '{"type":"assistant"}\n', 'utf8');
    await utimes(file, new Date(T0 + 30 * MINUTE), new Date(T0 + 30 * MINUTE));
    // The premise: growing a file leaves the directory mtime where it was.
    expect((await stat(dir)).mtimeMs).toBe(dirBefore);

    reset();
    expect(await reader.sessionActivity(SESSION, dir, 'stamp-1', T0 + 30 * MINUTE + 10_000)).toBe(
      T0 + 30 * MINUTE,
    );
    expect(calls.readdir).toHaveLength(0);
  });

  it('a changed parent transcript forces one full pass', async () => {
    const tree = await makeFixtureTree('cc-subagent-');
    const transcript = await tree.writeTranscript(SLUG, SESSION, parentTranscript());
    const file = await tree.writeSubagent({ slug: SLUG, sessionId: SESSION, agentId: 'cold', at: T0 });
    const dir = subagentDirForTranscript(transcript);
    const now = T0 + 30 * MINUTE;
    const { fs, calls, reset } = countingFs();
    const reader = new SubagentActivityReader({ fs });
    expect(await reader.sessionActivity(SESSION, dir, 'stamp-1', now)).toBe(T0);

    // A cold run resumes: its file grows, the directory does not move, it is not hot.
    await utimes(file, new Date(now - MINUTE), new Date(now - MINUTE));
    reset();
    expect(await reader.sessionActivity(SESSION, dir, 'stamp-1', now)).toBe(T0);
    expect(calls.readdir).toHaveLength(0);

    expect(await reader.sessionActivity(SESSION, dir, 'stamp-2', now)).toBe(now - MINUTE);
    expect(calls.readdir).toHaveLength(1);

    expect(await reader.sessionActivity(SESSION, dir, 'stamp-2', now)).toBe(now - MINUTE);
    expect(calls.readdir).toHaveLength(1);
  });

  it('opens no subagent transcript', async () => {
    const { transcript } = await fixture({ subagentAt: 41 * MINUTE, grandchildAt: 41 * MINUTE });
    const dir = subagentDirForTranscript(transcript);
    const { fs, calls } = countingFs();
    const reader = new SubagentActivityReader({ fs });
    await reader.newestActivity(SESSION, dir, [TOOL_USE_ID]);
    await reader.sessionActivity(SESSION, dir, 'stamp-1', T0 + 42 * MINUTE);
    await reader.sessionActivity(SESSION, dir, 'stamp-1', T0 + 42 * MINUTE + 5_000);

    // The sidecars are read, so the spy is wired; the transcripts never are.
    expect(calls.readFile.length).toBeGreaterThan(0);
    expect(calls.readFile.filter((path) => path.toLowerCase().endsWith('.jsonl'))).toEqual([]);
  });

  it('reports nothing when the session has no subagent directory', async () => {
    const { transcript } = await fixture({ noSubagentFiles: true });
    const reader = new SubagentActivityReader();
    expect(
      await reader.sessionActivity(SESSION, subagentDirForTranscript(transcript), 'stamp-1', T0),
    ).toBeNull();
  });
});
