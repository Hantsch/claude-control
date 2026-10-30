/**
 * End-to-end tests over `core/` with fixture trees (§10):
 *  - discovery, including the nasty cases from research (stale registry entry, mixed slug
 *    casing, bookkeeping tail, torn final line)
 *  - **latency check** (N4) and **cold-start check** (N5): the functional side only; their
 *    time budgets live in test/perf/
 *  - **read-only assertion** (N2): after the full pipeline, no file's content, size or
 *    mtime has changed. This is worth automating because N2 is the promise that makes the
 *    tool safe to leave running.
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../src/core/adapters/claude/adapter.ts';
import { resolveClaudePaths } from '../../src/core/adapters/claude/paths.ts';
import { ControlEngine } from '../../src/core/engine.ts';
import { sessionTitleOf } from '../../src/core/model/sessionTitle.ts';
import { NotificationGate } from '../../src/core/state/notifications.ts';
import { FileWatcher } from '../../src/core/watch/watcher.ts';
import { DEFAULT_SETTINGS, DEFAULT_THRESHOLDS, mergeSettings } from '../../src/core/model/settings.ts';
import { epochMsToFileTime } from '../../src/core/registry/liveness.ts';
import type { StatusTransition } from '../../src/core/model/types.ts';
import {
  FakeProbe,
  LIVE_PID,
  assertColdStartPremise,
  historyDone,
  makeAdapter,
  sleep,
  treeSize,
  writeColdStartTree,
} from '../fixtures/engine.ts';
import {
  T0,
  agentResult,
  agentLaunchedResult,
  assistant,
  aiTitle,
  customTitle,
  fileHistorySnapshot,
  ideLock,
  lastPrompt,
  makeFixtureTree,
  peerHandBack,
  prompt,
  registryEntry,
  toJsonl,
  toJsonlWithTornTail,
  toolResult,
  type FixtureTree,
} from '../fixtures/builders.ts';

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

  it('finds the generated title even when it sits outside the tail window', async () => {
    // What every long-running session looks like: `ai-title` is written once, early, and by
    // the time the popover asks it is far behind the tail window — the case that used to
    // leave every row labelled with the registry's derived slug instead.
    const tree = await makeFixtureTree();
    await tree.writeRegistry(
      LIVE_PID,
      registryEntry({ pid: LIVE_PID, sessionId: 'sess-titled', name: 'claude-control-7e' }),
    );
    const padding = Array.from({ length: 40 }, (_, index) =>
      assistant({ uuid: `pad${index}`, at: 2_000 + index, text: 'x'.repeat(400) }),
    );
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-titled',
      toJsonl([
        prompt('u1', 0),
        assistant({ uuid: 'a1', at: 1_000, text: 'Starting.' }),
        aiTitle('Sprint 14', 1_100),
        ...padding,
        lastPrompt('u1'),
      ]),
    );

    const adapter = new ClaudeAdapter({
      paths: resolveClaudePaths(tree.root),
      // Small enough that the title is provably behind it — 40 × 400 chars of padding follow.
      tailWindowBytes: 1024,
      maxTailWindowBytes: 1024,
      probe: new FakeProbe(new Set([LIVE_PID])),
      thresholds: DEFAULT_THRESHOLDS,
    });
    const snapshot = await adapter.readStatus((await adapter.discoverLiveSessions())[0]!);

    expect(snapshot.facts.read.startOffset).toBeGreaterThan(0);
    expect(snapshot.facts.aiTitle).toBe('Sprint 14');
  });

  it('a rename written while the app is watching reaches the next read', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-renamed', name: 'cc-renamed-7e' }));
    const padding = (from: number) =>
      Array.from({ length: 40 }, (_, index) =>
        assistant({ uuid: `pad${from + index}`, at: 2_000 + from + index, text: 'x'.repeat(400) }),
      );
    const path = await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-renamed',
      toJsonl([prompt('u1', 0), aiTitle('Generated title', 1_100), ...padding(0)]),
    );
    const adapter = new ClaudeAdapter({
      paths: resolveClaudePaths(tree.root),
      tailWindowBytes: 1024,
      maxTailWindowBytes: 1024,
      probe: new FakeProbe(new Set([LIVE_PID])),
      thresholds: DEFAULT_THRESHOLDS,
    });
    const ref = (await adapter.discoverLiveSessions())[0]!;
    expect(sessionTitleOf((await adapter.readStatus(ref)).facts)).toBe('Generated title');

    await appendFile(path, toJsonl([customTitle('Release train', 9_000)]), 'utf8');
    expect(sessionTitleOf((await adapter.readStatus(ref)).facts)).toBe('Release train');

    // Once the rename has scrolled out of the tail window, the label must not fall back.
    await appendFile(path, toJsonl(padding(100)), 'utf8');
    const later = await adapter.readStatus(ref);
    expect(later.facts.read.startOffset).toBeGreaterThan(0);
    expect(sessionTitleOf(later.facts)).toBe('Release train');
  });

  it('finds the custom title far outside the tail window, and from the sidecar beyond the scan budget', async () => {
    const tree = await makeFixtureTree();
    const slug = 'c--development-Hantsch-claude-control';
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-far-name', name: 'cc-far-7e' }));
    await tree.writeRegistry(LIVE_PID + 1, registryEntry({ pid: LIVE_PID, sessionId: 'sess-huge-name', name: 'cc-huge-7e' }));
    const padding = (count: number, chars: number) =>
      Array.from({ length: count }, (_, index) =>
        assistant({ uuid: `pad${index}`, at: 2_000 + index, text: 'x'.repeat(chars) }),
      );
    await tree.writeTranscript(
      slug,
      'sess-far-name',
      toJsonl([prompt('u1', 0), customTitle('Far rename', 500), ...padding(40, 400), aiTitle('Generated title', 9_000)]),
    );
    // Larger than the backward scan budget (4 MB): the rename at the start is out of its reach.
    await tree.writeTranscript(
      slug,
      'sess-huge-name',
      toJsonl([prompt('u1', 0), customTitle('Sidecar rename', 500), ...padding(1_200, 4_000), aiTitle('Generated title', 9_000)]),
    );
    await mkdir(join(tree.root, 'projects', slug, 'sess-huge-name'), { recursive: true });
    await writeFile(
      join(tree.root, 'projects', slug, 'sess-huge-name', 'custom-title.json'),
      JSON.stringify({ customTitle: 'Sidecar rename' }),
      'utf8',
    );

    const adapter = new ClaudeAdapter({
      paths: resolveClaudePaths(tree.root),
      tailWindowBytes: 1024,
      maxTailWindowBytes: 1024,
      probe: new FakeProbe(new Set([LIVE_PID])),
      thresholds: DEFAULT_THRESHOLDS,
    });
    const refs = await adapter.discoverLiveSessions();
    const labelOf = async (sessionId: string) =>
      sessionTitleOf((await adapter.readStatus(refs.find((ref) => ref.sessionId === sessionId)!)).facts);

    expect(await labelOf('sess-far-name')).toBe('Far rename');
    expect(await labelOf('sess-huge-name')).toBe('Sidecar rename');
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

  it('prefers `statusUpdatedAt` over `updatedAt` as the registry status stamp', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(
      LIVE_PID,
      registryEntry({
        pid: LIVE_PID,
        sessionId: 'sess-stamp',
        status: 'busy',
        // A later unrelated write (rename, heartbeat) must not make the status look fresher.
        updatedAt: T0 + 60_000,
        statusUpdatedAt: new Date(T0).toISOString(),
      }),
    );

    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])));
    const refs = await adapter.discoverLiveSessions();
    expect(refs[0]!.reportedStatus).toBe('busy');
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

    const done = historyDone(engine);
    await engine.start();
    await done;

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
  /**
   * For tests whose fixture session seeds as `done`: `hideDoneOnStart` (on by default) would
   * take that row off every surface, which is its own test below and not what these are about.
   */
  const SHOWING_SETTLED = {
    ...DEFAULT_SETTINGS,
    indexHistoryOnStart: false,
    list: { hideDoneOnStart: false },
  };

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
      settings: mergeSettings(SHOWING_SETTLED),
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
    expect(hiding.getSnapshot().hidden).toEqual({ count: 1, causes: ['unused'] });
    await hiding.stop();

    const showing = makeEngine(false);
    await showing.start();
    expect(showing.getSnapshot().sessions.map((session) => session.status)).toEqual(['starting']);
    expect(showing.getSnapshot().hidden).toEqual({ count: 0, causes: [] });
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
      settings: mergeSettings(SHOWING_SETTLED),
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

  it('hides a session that was already done at start until it does something new', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-old', name: 'cc-old' }));
    const slug = 'c--development-Hantsch-claude-control';
    // A turn that ended long before the app was started.
    const path = await tree.writeTranscript(
      slug,
      'sess-old',
      toJsonl([
        prompt('u1', 0, 'the thing from before'),
        assistant({ uuid: 'a1', at: 1_000, stopReason: 'end_turn', text: 'Done.' }),
      ]),
    );

    let clock = T0 + 10 * 60_000;
    const makeEngine = (hide: boolean): ControlEngine =>
      new ControlEngine({
        adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), () => clock),
        settings: mergeSettings({
          ...DEFAULT_SETTINGS,
          indexHistoryOnStart: false,
          list: { hideDoneOnStart: hide },
        }),
        now: () => clock,
        createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
      });

    // With the filter off it is an ordinary `done` row that lights the tray.
    const showing = makeEngine(false);
    await showing.start();
    expect(showing.getSnapshot().sessions.map((session) => session.status)).toEqual(['done']);
    expect(showing.getSnapshot().attention).toBe(1);
    expect(showing.getSnapshot().hidden).toEqual({ count: 0, causes: [] });
    const historyWhenShowing = { count: showing.getSnapshot().historyCount, entries: showing.listHistory() };
    await showing.stop();

    const engine = makeEngine(true);
    await engine.start();
    expect(engine.getSnapshot().sessions).toHaveLength(0);
    expect(engine.getSnapshot().hidden).toEqual({ count: 1, causes: ['doneOnStart'] });
    // Hiding is presentation only: history is the same with the filter on.
    expect(engine.getSnapshot().historyCount).toBe(historyWhenShowing.count);
    expect(engine.listHistory()).toEqual(historyWhenShowing.entries);
    expect(engine.getSnapshot().groups).toHaveLength(0);
    expect(engine.getSnapshot().trayState).toBe('none');
    expect(engine.getSnapshot().attention).toBe(0);
    // Re-reading the same transcript keeps it hidden — nothing happened since.
    await engine.refreshNow();
    expect(engine.getSnapshot().sessions).toHaveLength(0);

    // A new turn is news: the row comes back by itself, badge included.
    clock = T0 + 20 * 60_000;
    await appendFile(
      path,
      toJsonl([
        prompt('u2', 15 * 60_000, 'one more thing'),
        assistant({ uuid: 'a2', at: 16 * 60_000, stopReason: 'end_turn', text: 'Also done.' }),
      ]),
      'utf8',
    );
    await engine.refreshNow();
    expect(engine.getSnapshot().sessions.map((session) => session.sessionId)).toEqual(['sess-old']);
    expect(engine.getSnapshot().attention).toBe(1);
    expect(engine.getSnapshot().hidden.count).toBe(0);

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
      settings: mergeSettings(SHOWING_SETTLED),
      now,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    await engine.start();

    expect(engine.getSnapshot().sessions[0]!.run).toEqual({ startedAt: T0, endedAt: T0 + 90_000 });
    await engine.stop();
  });

  it('the run start skips hand-backs far outside the tail window', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-handback', name: 'cc-handback' }));
    // Both the human prompt and a later peer hand-back sit well behind the 64 KB tail window.
    const noise = (from: number, at: number) =>
      Array.from({ length: 400 }, (_, i) =>
        assistant({ uuid: `n${from + i}`, at: at + i, text: `tool traffic line ${i} `.repeat(10) }),
      );
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-handback',
      toJsonl([
        prompt('u1', 0, 'the prompt that started it'),
        ...noise(0, 1_000),
        peerHandBack('p1', 40_000),
        ...noise(1_000, 41_000),
        assistant({ uuid: 'done', at: 90_000, stopReason: 'end_turn', text: 'Finished.' }),
      ]),
    );

    const now = () => T0 + 120_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), now),
      settings: mergeSettings(SHOWING_SETTLED),
      now,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    await engine.start();

    expect(engine.getSnapshot().sessions[0]!.run).toEqual({ startedAt: T0, endedAt: T0 + 90_000 });
    await engine.stop();
  });

  it('a renamed session is labelled with its custom title even when a newer ai-title exists', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-rename', name: 'cc-rename-7e' }));
    // The rename is far behind the tail window; the generated title was rewritten since.
    const noise = Array.from({ length: 400 }, (_, i) =>
      assistant({ uuid: `n${i}`, at: 1_000 + i, text: `tool traffic line ${i} `.repeat(10) }),
    );
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-rename',
      toJsonl([
        prompt('u1', 0, 'the prompt that started it'),
        aiTitle('Old generated title', 100),
        customTitle('Release train', 200),
        ...noise,
        aiTitle('Newer generated title', 80_000),
        assistant({ uuid: 'done', at: 90_000, stopReason: 'end_turn', text: 'Finished.' }),
      ]),
    );

    const now = () => T0 + 120_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), now),
      settings: mergeSettings(SHOWING_SETTLED),
      now,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    await engine.start();

    expect(engine.getSnapshot().sessions[0]!.title).toBe('Release train');
    await engine.stop();
  });

  it('history labels a session with the name the live list gave it', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-same-name', name: 'cc-same-7e' }));
    const noise = Array.from({ length: 400 }, (_, i) =>
      assistant({ uuid: `n${i}`, at: 1_000 + i, text: `tool traffic line ${i} `.repeat(10) }),
    );
    const path = await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-same-name',
      toJsonl([
        prompt('u1', 0, 'the prompt that started it'),
        customTitle('Release train', 200),
        ...noise,
        peerHandBack('p1', 40_000),
        aiTitle('Newer generated title', 80_000),
        assistant({ uuid: 'done', at: 90_000, stopReason: 'end_turn', text: 'Finished.' }),
      ]),
    );

    const now = () => T0 + 120_000;
    const adapter = makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), now);
    const engine = new ControlEngine({
      adapter,
      settings: mergeSettings(SHOWING_SETTLED),
      now,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    await engine.start();

    const live = engine.getSnapshot().sessions[0]!.title;
    const history = (await adapter.readHistoryEntry(path))!.title;
    expect(live).toBe('Release train');
    expect(history).toBe(live);
    await engine.stop();
  });

  it('a session delegating to a background subagent stays live, current and silent until the subagent stops', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-bg', name: 'cc-bg' }));
    const slug = 'c--development-Hantsch-claude-control';
    await tree.writeTranscript(
      slug,
      'sess-bg',
      toJsonl([
        prompt('u1', 0, 'run the long job in the background'),
        assistant({ uuid: 'a1', at: 1_000, tools: [{ id: 'toolu_bg', name: 'Agent', input: { description: 'Long job' } }] }),
        agentLaunchedResult('r1', 2_000, { assistantUuid: 'a1', toolUseId: 'toolu_bg' }),
        assistant({ uuid: 'a2', at: 3_000, stopReason: 'end_turn', text: 'It is running in the background.' }),
      ]),
    );
    const subagent = await tree.writeSubagent({
      slug,
      sessionId: 'sess-bg',
      agentId: 'abg',
      toolUseId: 'toolu_bg',
      at: T0 + 4_000,
    });
    const touch = (at: number): Promise<void> => utimes(subagent, new Date(at), new Date(at));

    let clock = T0 + 5_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), () => clock),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: false }),
      now: () => clock,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    const transitions: StatusTransition[] = [];
    engine.on('transitions', (batch) => transitions.push(...batch.filter((transition) => !transition.seeded)));
    await engine.start();

    const session = () => engine.getSnapshot().sessions.find((entry) => entry.sessionId === 'sess-bg');
    // The timer's entry point: not forced, so an untouched parent transcript is not re-read.
    const runTick = (): Promise<void> =>
      (engine as unknown as { refresh(reason: 'tick'): Promise<void> }).refresh('tick');
    expect(session()?.status).toBe('working');
    expect(session()?.statusReason).toMatch(/subagent/);
    expect(session()?.lastActivityAt).toBe(T0 + 4_000);
    expect(engine.getSnapshot().trayState).toBe('working');

    // The parent transcript is never touched again; only the subagent's file moves.
    let wrote = T0 + 4_000;
    for (let tick = 1; tick <= 4; tick += 1) {
      clock += 5 * 60_000;
      wrote = clock - 1_000;
      await touch(wrote);
      await runTick();
      expect(session()?.status).toBe('working');
      expect(session()?.lastActivityAt).toBe(wrote);
      expect(engine.getSnapshot().trayState).toBe('working');
    }
    expect(transitions).toEqual([]);

    clock = wrote + 10 * 60_000 + 1_000;
    await runTick();
    expect(session()?.status).toBe('done');
    await runTick();
    clock += 60_000;
    await runTick();
    expect(transitions.map((transition) => transition.to)).toEqual(['done']);
    await engine.stop();
  });

  it('a re-tasked subagent kept working by SendMessage keeps its session working', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-sm', name: 'cc-sm' }));
    const slug = 'c--development-Hantsch-claude-control';
    await tree.writeTranscript(
      slug,
      'sess-sm',
      toJsonl([
        prompt('u1', 0, 'keep the helper busy'),
        assistant({ uuid: 'a1', at: 1_000, tools: [{ id: 'toolu_old', name: 'Agent', input: { description: 'Helper' } }] }),
        agentResult('r1', 2_000, { assistantUuid: 'a1', toolUseId: 'toolu_old', status: 'completed' }),
        assistant({ uuid: 'a2', at: 3_000, tools: [{ id: 'toolu_m1', name: 'SendMessage', input: { to: 'helper' } }] }),
        toolResult('r2', 4_000, { assistantUuid: 'a2', toolUseId: 'toolu_m1' }),
        assistant({ uuid: 'a3', at: 5_000, tools: [{ id: 'toolu_m2', name: 'SendMessage', input: { to: 'helper' } }] }),
        toolResult('r3', 6_000, { assistantUuid: 'a3', toolUseId: 'toolu_m2' }),
        assistant({ uuid: 'a4', at: 7_000, stopReason: 'end_turn', text: 'Handed over.' }),
      ]),
    );
    const helper = await tree.writeSubagent({
      slug,
      sessionId: 'sess-sm',
      agentId: 'ahelp',
      toolUseId: 'toolu_old',
      at: T0 + 8_000,
    });

    const clock = T0 + 9_000;
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID])), () => clock),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: false }),
      now: () => clock,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });
    await engine.start();
    const row = engine.getSnapshot().sessions[0]!;
    expect(row.status).toBe('working');
    expect(row.statusReason).toMatch(/subagent/);
    expect(row.lastActivityAt).toBe((await stat(helper)).mtimeMs);
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

  it('observes the status change an append causes (N4)', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-live-2', name: 'cc-live-2' }));
    // Real watcher and real clock: records carry current timestamps rather than the fixed T0.
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

    const observed = new Promise<void>((resolve) => {
      engine.on('transitions', (batch) => {
        if (batch.some((transition) => transition.to === 'done' && !transition.seeded)) resolve();
      });
    });

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

    await observed;
    await engine.stop();
  });

  it('a delegating session turns done only when the registry goes idle, without waiting for the tick', async () => {
    const tree = await makeFixtureTree();
    const registry = (status: string): Record<string, unknown> =>
      registryEntry({
        pid: LIVE_PID,
        sessionId: 'sess-deleg',
        name: 'cc-deleg',
        status,
        statusUpdatedAt: Date.now(),
      });
    await tree.writeRegistry(LIVE_PID, registry('busy'));
    const stamp = (record: Record<string, unknown>): Record<string, unknown> => ({
      ...record,
      timestamp: new Date().toISOString(),
    });
    await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-deleg',
      toJsonl([
        stamp(assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Agent' }] })),
        stamp(agentLaunchedResult('u1', 1_000, { assistantUuid: 'a1', toolUseId: 't1' })),
        stamp(assistant({ uuid: 'a2', at: 2_000, stopReason: 'end_turn', text: 'Delegated.' })),
      ]),
    );

    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set([LIVE_PID]))),
      settings: mergeSettings({
        ...DEFAULT_SETTINGS,
        indexHistoryOnStart: false,
        // Only the registry file event may trigger the re-read.
        reading: { ...DEFAULT_SETTINGS.reading, tickIntervalMs: 60_000 },
      }),
    });

    const gate = new NotificationGate();
    const settings = mergeSettings(DEFAULT_SETTINGS).notifications;
    let notified = 0;
    const toDone: StatusTransition[] = [];
    let flippedAt = 0;
    let doneBeforeFlip = 0;
    const observed = new Promise<void>((resolve) => {
      engine.on('transitions', (batch) => {
        for (const transition of batch) {
          if (gate.evaluate(transition, settings).notify) notified += 1;
          if (transition.to !== 'done' || transition.seeded) continue;
          toDone.push(transition);
          if (flippedAt === 0) doneBeforeFlip += 1;
          else resolve();
        }
      });
    });

    await engine.start();
    expect(engine.getSnapshot().sessions[0]!.status).toBe('working');

    flippedAt = 1;
    await tree.writeRegistry(LIVE_PID, registry('idle'));

    await observed;
    await sleep(300);
    expect(doneBeforeFlip).toBe(0);
    expect(toDone).toHaveLength(1);
    expect(notified).toBe(1);
    expect(engine.getSnapshot().sessions[0]!.status).toBe('done');
    await engine.stop();
  });

  it('the cold-start tree resolves every live session with a clipped final text and summed usage (N5 premise)', async () => {
    const tree = await makeFixtureTree('cc-coldstart-');
    const { liveIds, livePids } = await writeColdStartTree(tree, 20);

    const bytes = await treeSize(tree.projectsDir);
    expect(bytes).toBeGreaterThan(0.9 * 20 * 1024 * 1024);
    expect(bytes).toBeLessThanOrEqual(50 * 1024 * 1024);

    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set(livePids))),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: true }),
    });
    const done = historyDone(engine);
    await engine.start();
    await done;

    assertColdStartPremise(engine.getSnapshot(), engine.listHistory().entries, liveIds.length);
    await engine.stop();
  });

  /** §5.3: a burst of appends must produce one re-read, and no change may wait longer than the ceiling. */
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

    const done = historyDone(engine);
    await engine.start();
    await done;
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
