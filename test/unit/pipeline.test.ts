/**
 * End-to-end tests over `core/` with fixture trees (§10):
 *  - discovery, including the nasty cases from research (stale registry entry, mixed slug
 *    casing, bookkeeping tail, torn final line)
 *  - **latency check** (N4): append to a transcript, observe the status change under 2 s
 *  - **cold-start check** (N5): a synthetic tree of ~300 files / ~250 MB, live tier under 2 s
 *  - **read-only assertion** (N2): after the full pipeline, no file's content, size or
 *    mtime has changed. This is worth automating because N2 is the promise that makes the
 *    tool safe to leave running.
 */

import { createHash } from 'node:crypto';
import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../src/core/adapters/claude/adapter.ts';
import { resolveClaudePaths } from '../../src/core/adapters/claude/paths.ts';
import { ControlEngine } from '../../src/core/engine.ts';
import { FileWatcher } from '../../src/core/watch/watcher.ts';
import { DEFAULT_SETTINGS, DEFAULT_THRESHOLDS, mergeSettings } from '../../src/core/model/settings.ts';
import type { ProcessProbe } from '../../src/core/registry/liveness.ts';
import { epochMsToFileTime } from '../../src/core/registry/liveness.ts';
import type { StatusTransition } from '../../src/core/model/types.ts';
import {
  T0,
  agentResult,
  assistant,
  aiTitle,
  fileHistorySnapshot,
  ideLock,
  lastPrompt,
  makeFixtureTree,
  prompt,
  registryEntry,
  toJsonl,
  toJsonlWithTornTail,
  toolResult,
  type FixtureTree,
} from '../fixtures/builders.ts';

/** Probe whose answers are scripted, so tests do not depend on real processes. */
class FakeProbe implements ProcessProbe {
  constructor(
    private readonly livePids: Set<number>,
    private readonly stamps: Map<number, string> = new Map(),
  ) {}

  async alive(pids: readonly number[]): Promise<Set<number>> {
    return new Set(pids.filter((pid) => this.livePids.has(pid)));
  }

  async creationStamps(pids: readonly number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    for (const pid of pids) {
      const stamp = this.stamps.get(pid);
      if (stamp) out.set(pid, stamp);
    }
    return out;
  }
}

function makeAdapter(tree: FixtureTree, probe: ProcessProbe, now?: () => number): ClaudeAdapter {
  return new ClaudeAdapter({
    paths: resolveClaudePaths(tree.root),
    tailWindowBytes: 64 * 1024,
    maxTailWindowBytes: 1024 * 1024,
    probe,
    thresholds: DEFAULT_THRESHOLDS,
    ...(now ? { now } : {}),
  });
}

/** The current process is genuinely alive, which `readStatus` verifies with signal 0. */
const LIVE_PID = process.pid;

describe('discovery and status through the adapter', () => {
  it('lists live sessions, resolves transcripts and derives status', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-live', name: 'cc-live' }));
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-live',
      toJsonl([
        prompt('u1', 0),
        assistant({ uuid: 'a1', at: 1_000, stopReason: 'end_turn', text: 'Finished the work.' }),
        aiTitle('Fixture title', 1_100),
        lastPrompt('u1'),
      ]),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    expect(refs).toHaveLength(1);
    expect(refs[0]!.transcriptPath).not.toBeNull();

    const snapshot = await adapter.readStatus(refs[0]!);
    expect(snapshot.alive).toBe(true);
    expect(snapshot.facts.last?.stopReason).toBe('end_turn');
    expect(snapshot.facts.aiTitle).toBe('Fixture title');
    expect(snapshot.project.name).toBe('claude-control');
  });

  it('parses the optional agent-reported registry fields when present', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(
      LIVE_PID,
      registryEntry({
        pid: LIVE_PID,
        sessionId: 'sess-reported',
        status: 'Working',
        waitingFor: 'user-input',
        updatedAt: T0,
      }),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    expect(refs).toHaveLength(1);
    expect(refs[0]!.reportedStatus).toBe('working');
    expect(refs[0]!.waitingFor).toBe('user-input');
    expect(refs[0]!.reportedAt).toBe(T0);
  });

  it('parses an ISO-8601 `updatedAt` into epoch ms', async () => {
    const tree = await makeFixtureTree();
    const iso = new Date(T0).toISOString();
    await tree.writeRegistry(
      LIVE_PID,
      registryEntry({ pid: LIVE_PID, sessionId: 'sess-iso', updatedAt: iso }),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    expect(refs[0]!.reportedAt).toBe(T0);
  });

  it('leaves the optional agent-reported fields null when absent, same as today', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-plain' }));

    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    expect(refs[0]!.reportedStatus).toBeNull();
    expect(refs[0]!.waitingFor).toBeNull();
    expect(refs[0]!.reportedAt).toBeNull();
  });

  it('turns junk values for the optional fields into null instead of throwing', async () => {
    const tree = await makeFixtureTree();
    const entry = {
      ...registryEntry({ pid: LIVE_PID, sessionId: 'sess-junk' }),
      status: 123,
      waitingFor: { nope: true },
      updatedAt: 'not a date',
    };
    await tree.writeRegistry(LIVE_PID, entry);

    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    expect(refs).toHaveLength(1);
    expect(refs[0]!.reportedStatus).toBeNull();
    expect(refs[0]!.waitingFor).toBeNull();
    expect(refs[0]!.reportedAt).toBeNull();
  });

  it('drops a stale registry entry whose PID belongs to an unrelated process', async () => {
    const tree = await makeFixtureTree();
    // The PID is alive, but it was created 10 minutes after the session was registered.
    await tree.writeRegistry(
      4242,
      registryEntry({ pid: 4242, sessionId: 'sess-stale', procStartMs: T0 - 600_000 }),
    );
    await tree.writeTranscript('proj', 'sess-stale', toJsonl([prompt('u1', 0)]));

    const probe = new FakeProbe(new Set([4242]), new Map([[4242, epochMsToFileTime(T0)]]));
    const adapter = makeAdapter(tree, probe);
    expect(await adapter.discoverLiveSessions()).toHaveLength(0);
  });

  it('drops registry entries whose process is gone', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(4243, registryEntry({ pid: 4243, sessionId: 'sess-dead' }));
    const adapter = makeAdapter(tree, new FakeProbe(new Set()));
    expect(await adapter.discoverLiveSessions()).toHaveLength(0);
  });

  it('finds a transcript despite inconsistent slug casing', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(
      LIVE_PID,
      registryEntry({ pid: LIVE_PID, sessionId: 'sess-case', cwd: 'C:\\development\\Hantsch\\Browser-MMO' }),
    );
    // Directory on disk uses a different drive-letter case than the cwd.
    await tree.writeTranscript(
      'c--development-Hantsch-Browser-MMO',
      'sess-case',
      toJsonl([assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' })]),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    expect(refs[0]!.transcriptPath).toContain('sess-case.jsonl');
  });

  it('finds a transcript filed under an unrelated slug by scanning for the session id', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-moved' }));
    await tree.writeTranscript('totally-different-slug', 'sess-moved', toJsonl([prompt('u1', 0)]));
    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    expect(refs[0]!.transcriptPath).toContain('sess-moved.jsonl');
  });

  it('degrades to unknown instead of crashing when the transcript is missing', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-no-file' }));
    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    const snapshot = await adapter.readStatus(refs[0]!);
    expect(snapshot.facts.last).toBeNull();
  });

  it('survives a torn final line', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-torn' }));
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-torn',
      toJsonlWithTornTail([assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn' })]),
    );
    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const snapshot = await adapter.readStatus((await adapter.discoverLiveSessions())[0]!);
    expect(snapshot.facts.last?.uuid).toBe('a1');
  });

  it('indexes history without full-parsing, and reads detail on request', async () => {
    const tree = await makeFixtureTree();
    await tree.writeTranscript(
      'c--development-Hantsch-ai-diary',
      'sess-past',
      toJsonl([
        prompt('u1', 0),
        assistant({ uuid: 'a1', at: 1_000, tools: [{ id: 't1', name: 'Agent', input: { description: 'sub' } }] }),
        toolResult('u2', 20_000, { assistantUuid: 'a1', toolUseId: 't1' }),
        assistant({ uuid: 'a2', at: 21_000, stopReason: 'end_turn', text: 'All done.' }),
        aiTitle('Past session', 21_100),
        fileHistorySnapshot(21_200),
        lastPrompt('a2'),
      ]),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set()));
    const entries = [];
    for await (const entry of adapter.indexHistory(new AbortController().signal)) entries.push(entry);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('Past session');
    expect(entries[0]!.finalStatus).toBe('done');
    expect(entries[0]!.startedAt).toBe(T0);
    expect(entries[0]!.project.name).toBe('claude-control');

    const detail = await adapter.readDetail('sess-past', entries[0]!.transcriptPath);
    expect(detail.events).toHaveLength(4);
    expect(detail.subagents).toHaveLength(1);
    expect(detail.subagents[0]!.status).toBe('completed');
    expect(detail.usage!.cacheReadTokens).toBeGreaterThan(0);
    expect(detail.title).toBe('Past session');
  });

  it('sums per-entry usage from the tail records and marks it complete (D4)', async () => {
    const tree = await makeFixtureTree();
    const path = await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-usage',
      toJsonl([
        prompt('u1', 0),
        assistant({ uuid: 'a1', at: 1_000, usage: { input: 1, cacheRead: 2, cacheCreation: 3, output: 4 } }),
        assistant({
          uuid: 'a2',
          at: 2_000,
          stopReason: 'end_turn',
          text: 'done',
          usage: { input: 10, cacheRead: 20, cacheCreation: 30, output: 40 },
        }),
      ]),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set()));
    const entry = await adapter.readHistoryEntry(path);

    expect(entry!.usage).toEqual({
      inputTokens: 11,
      cacheReadTokens: 22,
      cacheCreationTokens: 33,
      outputTokens: 44,
    });
    // The whole file fits the tail window, so the sum is a total, not a lower bound.
    expect(entry!.usageComplete).toBe(true);
  });

  it('flags usage as incomplete when the tail window misses the start of the file (D4)', async () => {
    const tree = await makeFixtureTree();
    // Filler between the two assistant records, wide enough that the 64 KB tail window
    // cannot reach the first one — the boundary `usageComplete` is supposed to detect.
    const filler = `${JSON.stringify(fileHistorySnapshot(0))}
`.repeat(1_200);
    const path = await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-usage-partial',
      toJsonl([
        prompt('u1', 0),
        assistant({ uuid: 'a-old', at: 1_000, usage: { input: 900_000, cacheRead: 0, cacheCreation: 0, output: 900_000 } }),
      ]) +
        filler +
        toJsonl([
          assistant({
            uuid: 'a-new',
            at: 2_000,
            stopReason: 'end_turn',
            text: 'done',
            usage: { input: 7, cacheRead: 0, cacheCreation: 0, output: 5 },
          }),
        ]),
    );

    expect((await stat(path)).size).toBeGreaterThan(64 * 1024);

    const adapter = makeAdapter(tree, new FakeProbe(new Set()));
    const entry = await adapter.readHistoryEntry(path);

    expect(entry!.usageComplete).toBe(false);
    // Only the records inside the window are counted; the old one is out of reach.
    expect(entry!.usage).toEqual({
      inputTokens: 7,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 5,
    });
  });

  it('fills in exact usage on the stored history entry after a detail read (D5)', async () => {
    const tree = await makeFixtureTree();
    // Same shape as the "flags usage as incomplete" fixture above: the tail window can't
    // reach the old record, so the index only sees a partial sum until a full read happens.
    const filler = `${JSON.stringify(fileHistorySnapshot(0))}
`.repeat(1_200);
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-usage-lazy',
      toJsonl([
        prompt('u1', 0),
        assistant({ uuid: 'a-old', at: 1_000, usage: { input: 900_000, cacheRead: 0, cacheCreation: 0, output: 900_000 } }),
      ]) +
        filler +
        toJsonl([
          assistant({
            uuid: 'a-new',
            at: 2_000,
            stopReason: 'end_turn',
            text: 'done',
            usage: { input: 7, cacheRead: 0, cacheCreation: 0, output: 5 },
          }),
        ]),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set()));
    const engine = new ControlEngine({
      adapter,
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: true }),
    });

    await engine.start();
    await new Promise<void>((resolve) => {
      engine.on('history', (info) => {
        if (info.done) resolve();
      });
    });

    const indexed = engine.listHistory().entries.find((entry) => entry.sessionId === 'sess-usage-lazy');
    expect(indexed!.usageComplete).toBe(false);

    const historyEvents: { count: number; done: boolean }[] = [];
    engine.on('history', (info) => historyEvents.push(info));

    const detail = await engine.getDetail('sess-usage-lazy');

    // The full parse behind `getDetail` knows the exact totals — including the old record
    // the tail-only index couldn't reach — so the stored entry is upgraded in place.
    const upgraded = engine.listHistory().entries.find((entry) => entry.sessionId === 'sess-usage-lazy');
    expect(upgraded!.usage).toEqual(detail.usage);
    expect(upgraded!.usageComplete).toBe(true);
    // Consumers (the history view) learn about the upgrade the same way they learn about
    // fresh indexing: a `history-changed` broadcast, not a silent in-place mutation.
    expect(historyEvents).toContainEqual({ count: engine.listHistory().total, done: true });

    await engine.stop();
  });

  it('reports null usage for a transcript that carries no usage records (D4)', async () => {
    const tree = await makeFixtureTree();
    const path = await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-no-usage',
      toJsonl([prompt('u1', 0), prompt('u2', 1_000), lastPrompt('u2')]),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set()));
    const entry = await adapter.readHistoryEntry(path);

    // Null, not a zeroed total: "nothing reported" must not read as "zero tokens".
    expect(entry!.usage).toBeNull();
  });

  it('honours the abort signal while indexing', async () => {
    const tree = await makeFixtureTree();
    for (let i = 0; i < 5; i += 1) {
      await tree.writeTranscript('proj', `sess-${i}`, toJsonl([prompt(`u${i}`, i)]));
    }
    const adapter = makeAdapter(tree, new FakeProbe(new Set()));
    const controller = new AbortController();
    const seen = [];
    for await (const entry of adapter.indexHistory(controller.signal)) {
      seen.push(entry);
      controller.abort();
    }
    expect(seen).toHaveLength(1);
  });

  it('exposes IDE windows for the focus feature', async () => {
    const tree = await makeFixtureTree();
    await tree.writeIdeLock(41_000, ideLock({ pid: 25_196, folders: ['c:\\development\\Hantsch\\claude'] }));
    const adapter = makeAdapter(tree, new FakeProbe(new Set()));
    const windows = await adapter.listIdeWindows();
    expect(windows).toHaveLength(1);
    expect(windows[0]!.pid).toBe(25_196);
  });
});

describe('engine', () => {
  it('produces a view model with tray state, badge and grouping', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-a', name: 'cc-a' }));
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-a',
      toJsonl([assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn', text: 'Ready.' }), lastPrompt('a1')]),
    );

    const now = () => T0 + 2_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), now),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: false }),
      now,
      // No file watching in this test; the snapshot is what is under test.
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });

    const transitions: StatusTransition[] = [];
    engine.on('transitions', (batch) => transitions.push(...batch));
    await engine.start();

    const snapshot = engine.getSnapshot();
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]!.status).toBe('done');
    expect(snapshot.trayState).toBe('done');
    expect(snapshot.attention).toBe(1);
    expect(snapshot.groups[0]!.branches[0]!.branch).toBe('main');
    // The first pass is seeded, so no toast fires on startup.
    expect(transitions.every((transition) => transition.seeded)).toBe(true);

    await engine.stop();
  });

  it('hides a session that has never exchanged a message, unless asked not to', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-new', name: 'cc-new' }));
    // A freshly opened window: the registry knows it, the transcript holds bookkeeping only.
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-new',
      toJsonl([lastPrompt('none')]),
    );

    const now = () => T0 + 2_000;
    const makeEngine = (hide: boolean): ControlEngine =>
      new ControlEngine({
        adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), now),
        settings: mergeSettings({
          ...DEFAULT_SETTINGS,
          indexHistoryOnStart: false,
          list: { hideUnusedSessions: hide },
        }),
        now,
        createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
      });

    const hiding = makeEngine(true);
    await hiding.start();
    expect(hiding.getSnapshot().sessions).toHaveLength(0);
    expect(hiding.getSnapshot().groups).toHaveLength(0);
    expect(hiding.getSnapshot().trayState).toBe('none');
    await hiding.stop();

    const showing = makeEngine(false);
    await showing.start();
    expect(showing.getSnapshot().sessions.map((session) => session.status)).toEqual(['starting']);
    await showing.stop();
  });

  it('clears the badge for an acknowledged session and re-arms it on the next change', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-ack', name: 'cc-ack' }));
    const slug = 'c--development-Hantsch-claude-control';
    const path = await tree.writeTranscript(
      slug,
      'sess-ack',
      toJsonl([assistant({ uuid: 'a1', at: 0, stopReason: 'end_turn', text: 'Done.' })]),
    );

    let clock = T0 + 2_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), () => clock),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: false }),
      now: () => clock,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    await engine.start();
    expect(engine.getSnapshot().attention).toBe(1);
    expect(engine.getSnapshot().trayState).toBe('done');

    engine.acknowledge('sess-ack');
    expect(engine.getSnapshot().attention).toBe(0);
    expect(engine.getSnapshot().trayState).toBe('none');
    // Re-reading the same transcript must not bring the badge back.
    await engine.refreshNow();
    expect(engine.getSnapshot().attention).toBe(0);

    // A new turn is news again, even though it ends in the same status.
    clock = T0 + 60_000;
    await appendFile(
      path,
      toJsonl([
        prompt('u2', 30_000, 'one more thing'),
        assistant({ uuid: 'a2', at: 40_000, stopReason: 'end_turn', text: 'Also done.' }),
      ]),
      'utf8',
    );
    await engine.refreshNow();
    expect(engine.getSnapshot().attention).toBe(1);

    await engine.stop();
  });

  it('reports how long the current run has taken, and closes it when the turn ends', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-run', name: 'cc-run' }));
    const slug = 'c--development-Hantsch-claude-control';
    // Prompt, then a turn still in progress: one tool call with no result yet.
    await tree.writeTranscript(
      slug,
      'sess-run',
      toJsonl([
        prompt('u1', 0, 'do the long thing'),
        assistant({ uuid: 'a1', at: 1_000, tools: [{ id: 't1', name: 'Read' }] }),
      ]),
    );

    let clock = T0 + 4_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), () => clock),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: false }),
      now: () => clock,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    await engine.start();

    // Still working: the run has a start but no end, so the UI can keep counting.
    const running = engine.getSnapshot().sessions[0]!;
    expect(running.status).toBe('working');
    expect(running.run).toEqual({ startedAt: T0, endedAt: null });

    // The turn finishes 30 s after the prompt.
    await tree.writeTranscript(
      slug,
      'sess-run',
      toJsonl([
        prompt('u1', 0, 'do the long thing'),
        assistant({ uuid: 'a1', at: 1_000, tools: [{ id: 't1', name: 'Read' }] }),
        toolResult('u2', 2_000, { assistantUuid: 'a1', toolUseId: 't1' }),
        assistant({ uuid: 'a2', at: 30_000, stopReason: 'end_turn', text: 'Done.' }),
      ]),
    );
    clock = T0 + 45_000;
    await engine.refreshNow();

    const finished = engine.getSnapshot().sessions[0]!;
    expect(finished.status).toBe('done');
    expect(finished.run).toEqual({ startedAt: T0, endedAt: T0 + 30_000 });

    await engine.stop();
  });

  it('still finds the run start when the prompt is far outside the tail window', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-far', name: 'cc-far' }));
    // ~150 KB of turn traffic after the prompt, against a 64 KB tail window: this is the
    // normal case for an agent-heavy turn, and the whole reason for the backward scan.
    const noise = Array.from({ length: 400 }, (_, i) =>
      assistant({ uuid: `n${i}`, at: 1_000 + i, text: `tool traffic line ${i} `.repeat(10) }),
    );
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-far',
      toJsonl([
        prompt('u1', 0, 'the prompt that started it'),
        ...noise,
        assistant({ uuid: 'done', at: 90_000, stopReason: 'end_turn', text: 'Finished.' }),
      ]),
    );

    const now = () => T0 + 120_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), now),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: false }),
      now,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    await engine.start();

    expect(engine.getSnapshot().sessions[0]!.run).toEqual({ startedAt: T0, endedAt: T0 + 90_000 });
    await engine.stop();
  });

  it('re-derives elapsed-time transitions without re-reading the transcript', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-b', name: 'cc-b' }));
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-b',
      toJsonl([assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Read' }] })]),
    );

    let clock = T0 + 2_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), () => clock),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: false }),
      now: () => clock,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });

    const transitions: StatusTransition[] = [];
    engine.on('transitions', (batch) => transitions.push(...batch));
    await engine.start();
    expect(engine.getSnapshot().sessions[0]!.status).toBe('working');

    // Nothing happened in the file — only time passed. This is what the 5 s tick is for.
    clock = T0 + 30_000;
    await engine.refreshNow();
    expect(engine.getSnapshot().sessions[0]!.status).toBe('waiting');

    // …and then it stays there. Elapsed time alone produces exactly one transition: a status
    // describes what is going on, so nothing decays into a second state just by ageing.
    clock = T0 + 20 * 60_000;
    await engine.refreshNow();
    expect(engine.getSnapshot().sessions[0]!.status).toBe('waiting');

    expect(transitions.filter((transition) => !transition.seeded).map((transition) => transition.to)).toEqual([
      'waiting',
    ]);
    await engine.stop();
  });

  /** N4: detection latency for a status change under ~2 s. */
  it('observes a status change within 2 s of an append (N4)', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-live-2', name: 'cc-live-2' }));
    // Real clock here: the point of the test is wall-clock latency with the real watcher,
    // so the fixture records carry real timestamps rather than the fixed T0.
    const path = await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-live-2',
      toJsonl([
        {
          ...assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] }),
          timestamp: new Date().toISOString(),
        },
      ]),
    );

    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID]))),
      settings: mergeSettings({
        ...DEFAULT_SETTINGS,
        indexHistoryOnStart: false,
        // Keep the low-frequency timer out of the measurement; the append must be what
        // triggers the re-read.
        reading: { ...DEFAULT_SETTINGS.reading, tickIntervalMs: 60_000 },
      }),
    });

    await engine.start();
    expect(engine.getSnapshot().sessions[0]!.status).toBe('working');

    const observed = new Promise<number>((resolve) => {
      engine.on('transitions', (batch) => {
        if (batch.some((transition) => transition.to === 'done' && !transition.seeded)) {
          resolve(Date.now());
        }
      });
    });

    const appendedAt = Date.now();
    await appendFile(
      path,
      toJsonl([
        toolResult('u1', 1_000, { assistantUuid: 'a1', toolUseId: 't1' }),
        {
          ...assistant({ uuid: 'a2', at: 2_000, stopReason: 'end_turn', text: 'Done.' }),
          timestamp: new Date().toISOString(),
        },
      ]),
      'utf8',
    );

    const latency = (await observed) - appendedAt;
    expect(latency).toBeLessThan(2_000);
    await engine.stop();
  });

  /**
   * N5: cold start to a populated session list under ~2 s despite ~250 MB of transcripts.
   * The tree is synthetic but the shape is the measured one: ~300 files across ~23 project
   * directories. Override the size with CC_COLDSTART_MB when iterating locally.
   */
  it('resolves the live tier under 2 s against a ~250 MB tree (N5)', async () => {
    const totalMb = Number(process.env.CC_COLDSTART_MB ?? 250);
    const fileCount = 300;
    const projects = 23;
    const perFile = Math.floor((totalMb * 1024 * 1024) / fileCount);

    const tree = await makeFixtureTree('cc-coldstart-');
    // One padded record repeated until the file is big enough, then a real tail.
    const filler = `${JSON.stringify(fileHistorySnapshot(0))}\n`;
    const repeats = Math.max(1, Math.floor(perFile / filler.length));
    const bulk = filler.repeat(repeats);

    for (let i = 0; i < fileCount; i += 1) {
      const slug = `c--development-project-${i % projects}`;
      const tail = toJsonl([
        prompt(`u${i}`, 0),
        assistant({ uuid: `a${i}`, at: 1_000, stopReason: 'end_turn', text: 'ok' }),
        lastPrompt(`a${i}`),
      ]);
      await tree.writeTranscript(slug, `history-${i}`, bulk + tail);
    }

    // A multi-kilobyte subagent report, as D1's `finalTextOf` now reads out of every agent
    // result's `content` — worst case, every live tail carries one, so the extra reading work
    // is inside this budget too, not just the byte count of the transcript.
    const longReport = 'report line filling out a multi-kilobyte final message. '.repeat(80);

    // Six live sessions, as measured, each with its own big transcript.
    const liveIds = ['live-0', 'live-1', 'live-2', 'live-3', 'live-4', 'live-5'];
    for (const [index, sessionId] of liveIds.entries()) {
      const cwd = `c:\\development\\project-${index}`;
      await tree.writeRegistry(
        LIVE_PID + index,
        registryEntry({ pid: LIVE_PID + index, sessionId, cwd, name: `sess-${index}` }),
      );
      await tree.writeTranscript(
        `c--development-project-${index}`,
        sessionId,
        bulk +
          toJsonl([
            assistant({
              uuid: `x${index}`,
              at: 0,
              tools: [{ id: 't1', name: 'Bash' }, { id: `agent-${index}`, name: 'Agent' }],
              cwd,
            }),
            agentResult(`ar${index}`, 1, {
              assistantUuid: `x${index}`,
              toolUseId: `agent-${index}`,
              content: [{ type: 'text', text: longReport }],
            }),
            lastPrompt(`x${index}`),
          ]),
      );
    }

    // The real watcher on purpose: `ControlEngine.start()` awaits chokidar's initial scan
    // of all three roots before the tray appears, so that scan is on the cold-start path
    // and has to be inside the budget too.
    const engine = new ControlEngine({
      adapter: makeAdapter(
        tree,
        new FakeProbe(new Set(liveIds.map((_, index) => LIVE_PID + index))),
      ),
      // D8: history indexing (and its usage summation over each tail's assistant
      // records — see `readHistoryEntry` in the Claude adapter) now runs inside the
      // cold-start budget too, not just live-tier resolution.
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: true }),
    });

    // Guard the premise of the test: the tree really is of the measured order of magnitude.
    const bytes = await treeSize(tree.projectsDir);
    expect(bytes).toBeGreaterThan(0.9 * totalMb * 1024 * 1024);

    const started = Date.now();
    await engine.start();
    // `start()` fires history indexing in the background without awaiting it, so the
    // budget has to wait for the 'history' done event too, or it would only measure
    // live-tier resolution and never touch the usage-summation path at all.
    await new Promise<void>((resolve) => {
      engine.on('history', (info) => {
        if (info.done) resolve();
      });
    });
    const elapsed = Date.now() - started;
    const snapshot = engine.getSnapshot();

    // Only the live sessions with an alive PID resolve; readStatus verifies with signal 0,
    // so sessions whose fabricated PID is not running are reported as ended.
    expect(snapshot.sessions.length).toBe(liveIds.length);

    // Guard the premise of the multi-KB `longReport` above: at least one session's subagent
    // tree node must actually have extracted a `finalText` from it, clipped to `ROW_TEXT_CHARS`
    // (120) with the `…` marker — otherwise this timing measurement would silently go vacuous
    // if the extraction path (`finalTextOf`) broke or stopped being reached.
    const finalTexts = snapshot.sessions.flatMap((session) =>
      session.subagents.map((node) => node.finalText),
    );
    const extracted = finalTexts.find((text): text is string => text !== null);
    expect(extracted).toBeDefined();
    expect(extracted).toMatch(/…$/);
    expect(extracted?.length).toBeLessThanOrEqual(120);
    expect(extracted?.length).toBeGreaterThan(100);

    // Guard the premise of the D8 usage-summation timing: at least one indexed history
    // entry must actually carry non-null usage summed from its tail's assistant records
    // (default `assistant()` fixture usage, see builders.ts) — otherwise this measurement
    // would silently go vacuous if `readHistoryEntry`'s summation broke or was skipped.
    const historyUsages = engine
      .listHistory()
      .entries.map((entry) => entry.usage)
      .filter((usage): usage is NonNullable<typeof usage> => usage !== null);
    expect(historyUsages.length).toBeGreaterThan(0);
    expect(historyUsages[0]!.inputTokens).toBeGreaterThan(0);

    // eslint-disable-next-line no-console -- N5 budget is measured, not just asserted; the
    // number needs to be readable from test output for the story's Done section.
    console.log(`[N5] cold start with history indexing and usage summation: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(2_000);
    await engine.stop();
  }, 180_000);

  /** §5.3: a burst of appends must produce one re-read, and must still land inside N4. */
  it('coalesces a burst of events and never waits longer than the ceiling', async () => {
    const flushes: number[] = [];
    let clock = 0;
    const watcher = new FileWatcher({
      roots: [],
      debounceMs: 250,
      maxWaitMs: 1_000,
      now: () => clock,
      onChange: (changes) => flushes.push(changes.length),
    });

    const enqueue = (path: string): void => {
      // `enqueue` is private on purpose; the watcher is driven through its own chokidar
      // handlers in production. Reaching in keeps the timing behaviour testable.
      (watcher as unknown as { enqueue: (k: string, p: string, e: string) => void }).enqueue(
        'transcripts',
        path,
        'change',
      );
    };

    // Fifty appends to the same file inside one debounce window → exactly one flush.
    for (let i = 0; i < 50; i += 1) enqueue('a.jsonl');
    await sleep(400);
    expect(flushes).toEqual([1]);

    // A stream of events with gaps shorter than the debounce would reset the timer forever;
    // the ceiling has to break that. 12 × 100 ms = 1.2 s of continuous activity.
    flushes.length = 0;
    for (let i = 0; i < 12; i += 1) {
      clock += 100;
      enqueue(`file-${i}.jsonl`);
      await sleep(100);
    }
    expect(flushes.length).toBeGreaterThan(0);
    await watcher.stop();
  });

  /** N2: read-only with respect to all Claude Code data. */
  it('changes no file after a full pipeline run (N2)', async () => {
    const tree = await makeFixtureTree('cc-readonly-');
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-ro' }));
    await tree.writeIdeLock(41_000, ideLock({ pid: 25_196, folders: ['c:\\development\\Hantsch\\claude-control'] }));
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-ro',
      toJsonl([
        prompt('u1', 0),
        assistant({ uuid: 'a1', at: 1_000, tools: [{ id: 't1', name: 'Agent', input: { description: 'sub' } }] }),
        toolResult('u2', 5_000, { assistantUuid: 'a1', toolUseId: 't1' }),
        assistant({ uuid: 'a2', at: 6_000, stopReason: 'end_turn', text: 'Done.' }),
        lastPrompt('a2'),
      ]),
    );
    await tree.writeTranscript('other-project', 'sess-ro-2', toJsonl([prompt('u1', 0)]));

    const before = await fingerprint(tree.root);

    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const engine = new ControlEngine({
      adapter,
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: true }),
    });

    await engine.start();
    await new Promise<void>((resolve) => {
      engine.on('history', (info) => {
        if (info.done) resolve();
      });
    });
    // Detail reads are the only full parses; they must not touch the file either.
    for (const entry of engine.listHistory().entries) {
      await engine.getDetail(entry.sessionId);
    }
    await engine.refreshNow();
    await engine.stop();

    const after = await fingerprint(tree.root);
    expect(after).toEqual(before);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Total bytes of all files below `root`. */
async function treeSize(root: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    total += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return total;
}

/** Content hash + size + mtime of every file in a tree, keyed by relative path. */
async function fingerprint(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
        continue;
      }
      const [info, content] = await Promise.all([stat(full), readFile(full)]);
      result[rel] = `${info.size}:${info.mtimeMs}:${createHash('sha256').update(content).digest('hex')}`;
    }
  };
  await walk(root, '');
  return result;
}
