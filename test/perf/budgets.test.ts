/**
 * The 2 s budgets of CONCEPT.md §10 N4/N5. They run alone (`npm run test:perf`) so nothing
 * shares the runner, and they block nothing: the functional side lives in test/unit/.
 */

import { appendFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ControlEngine } from '../../src/core/engine.ts';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/core/model/settings.ts';
import {
  FakeProbe,
  LIVE_PID,
  assertColdStartPremise,
  budgetMessage,
  historyDone,
  makeAdapter,
  treeSize,
  writeColdStartTree,
} from '../fixtures/engine.ts';
import {
  agentLaunchedResult,
  assistant,
  makeFixtureTree,
  registryEntry,
  toJsonl,
  toolResult,
} from '../fixtures/builders.ts';

// Real clock throughout: the point is wall-clock latency with the real watcher.
const stamp = (record: Record<string, unknown>): Record<string, unknown> => ({
  ...record,
  timestamp: new Date().toISOString(),
});

describe('timing budgets', () => {
  it('observes a status change within 2 s of an append (N4)', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(LIVE_PID, registryEntry({ pid: LIVE_PID, sessionId: 'sess-live-2', name: 'cc-live-2' }));
    const path = await tree.writeTranscript(
      'c--development-Hantsch-claude-control',
      'sess-live-2',
      toJsonl([stamp(assistant({ uuid: 'a1', at: 0, tools: [{ id: 't1', name: 'Bash' }] }))]),
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
        stamp(assistant({ uuid: 'a2', at: 2_000, stopReason: 'end_turn', text: 'Done.' })),
      ]),
      'utf8',
    );

    const elapsed = (await observed) - appendedAt;
    await engine.stop();
    expect(elapsed, budgetMessage('N4 append to status change', elapsed)).toBeLessThan(2_000);
  });

  it("a delegating session's registry flip is seen within 2 s", async () => {
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

    let flippedAt = 0;
    const observed = new Promise<number>((resolve) => {
      engine.on('transitions', (batch) => {
        const toDone = batch.some((transition) => transition.to === 'done' && !transition.seeded);
        if (toDone && flippedAt !== 0) resolve(Date.now());
      });
    });

    await engine.start();
    expect(engine.getSnapshot().sessions[0]!.status).toBe('working');

    flippedAt = Date.now();
    await tree.writeRegistry(LIVE_PID, registry('idle'));

    const elapsed = (await observed) - flippedAt;
    await engine.stop();
    expect(elapsed, budgetMessage('registry flip to done', elapsed)).toBeLessThan(2_000);
  });

  it('resolves the live tier under 2 s against a ~250 MB tree (N5)', async () => {
    const totalMb = Number(process.env.CC_COLDSTART_MB ?? 250);
    const tree = await makeFixtureTree('cc-coldstart-');
    const { liveIds, livePids } = await writeColdStartTree(tree, totalMb);

    // The tree really is of the measured order of magnitude.
    expect(await treeSize(tree.projectsDir)).toBeGreaterThan(0.9 * totalMb * 1024 * 1024);

    // The real watcher on purpose: start() awaits chokidar's initial scan of all roots, so
    // that scan is on the cold-start path and inside the budget.
    const engine = new ControlEngine({
      adapter: makeAdapter(tree, new FakeProbe(new Set(livePids))),
      settings: mergeSettings({ ...DEFAULT_SETTINGS, indexHistoryOnStart: true }),
    });

    // Subscribed before start() so an event emitted while it is still running is not missed.
    const done = historyDone(engine);
    const started = Date.now();
    await engine.start();
    // start() fires history indexing without awaiting it; the budget covers that too.
    await done;
    const elapsed = Date.now() - started;

    assertColdStartPremise(engine.getSnapshot(), engine.listHistory().entries, liveIds.length);
    await engine.stop();
    expect(elapsed, budgetMessage('N5 cold start', elapsed)).toBeLessThan(2_000);
  }, 180_000);
});
