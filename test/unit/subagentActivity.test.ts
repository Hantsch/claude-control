/**
 * Story: a session whose subagent is still working must not read `stale` (§6.2) — the fact
 * was available on disk and simply not read, so it is covered here against the real on-disk
 * layout. The other half of that story, picking *this* session's window out of a shared host
 * process, lives in `focusWindowPick.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../src/core/adapters/claude/adapter.ts';
import {
  SubagentActivityReader,
  subagentDirForTranscript,
} from '../../src/core/adapters/claude/subagentFiles.ts';
import { resolveClaudePaths } from '../../src/core/adapters/claude/paths.ts';
import { DEFAULT_THRESHOLDS } from '../../src/core/model/settings.ts';
import { deriveStatus } from '../../src/core/state/machine.ts';
import { T0, assistant, makeFixtureTree, toJsonl } from '../fixtures/builders.ts';

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
