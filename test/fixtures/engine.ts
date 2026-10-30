/** Shared engine-level test support: scripted probe, adapter factory, event waiters and the cold-start tree. */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import { ClaudeAdapter } from '../../src/core/adapters/claude/adapter.ts';
import { resolveClaudePaths } from '../../src/core/adapters/claude/paths.ts';
import type { ControlEngine } from '../../src/core/engine.ts';
import { DEFAULT_THRESHOLDS } from '../../src/core/model/settings.ts';
import type { ProcessProbe } from '../../src/core/registry/liveness.ts';
import {
  agentResult,
  assistant,
  fileHistorySnapshot,
  lastPrompt,
  prompt,
  registryEntry,
  toJsonl,
  type FixtureTree,
} from './builders.ts';

/** Probe whose answers are scripted, so tests do not depend on real processes. */
export class FakeProbe implements ProcessProbe {
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

export function makeAdapter(tree: FixtureTree, probe: ProcessProbe, now?: () => number): ClaudeAdapter {
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
export const LIVE_PID = process.pid;

/**
 * Resolves when the engine reports its history index as done — subscribed *before*
 * `engine.start()` is called, so an event emitted while `start()` is still running cannot be
 * missed. Use as `const done = historyDone(engine); await engine.start(); await done;`.
 *
 * The timeout is a fail-fast net well below vitest's own: an
 * event that never comes fails with this message instead of running into the test timeout.
 */
export function historyDone(engine: ControlEngine, timeoutMs = 10_000): Promise<void> {
  const waited = new Promise<void>((resolve, reject) => {
    const listener = (info: { count: number; done: boolean }): void => {
      if (!info.done) return;
      clearTimeout(timer);
      engine.off('history', listener);
      resolve();
    };
    const timer = setTimeout(() => {
      engine.off('history', listener);
      reject(new Error(`historyDone: no history 'done' event within ${timeoutMs}ms`));
    }, timeoutMs);
    engine.on('history', listener);
  });
  // The promise is created before `await engine.start()`, so a timeout could reject while
  // nothing awaits it yet; a no-op handler keeps that from surfacing as an unhandled
  // rejection instead of the readable failure at the `await done` site.
  waited.catch(() => {});
  return waited;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Total bytes of all files below `root`. */
export async function treeSize(root: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    total += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return total;
}

/**
 * Writes a synthetic tree of the measured shape: 300 history files across 23 project
 * directories plus 6 live sessions, each with a multi-KB subagent report in its tail.
 */
export async function writeColdStartTree(
  tree: FixtureTree,
  totalMb: number,
): Promise<{ liveIds: string[]; livePids: number[] }> {
  const fileCount = 300;
  const projects = 23;
  const perFile = Math.floor((totalMb * 1024 * 1024) / fileCount);

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

  // A multi-kilobyte subagent report: `finalTextOf` reads out of every agent result's
  // `content`, so the worst case is every live tail carrying one — the tree then exercises that
  // reading work, not just the byte count of the transcript.
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

  return { liveIds, livePids: liveIds.map((_, index) => LIVE_PID + index) };
}

/** Guards that the cold-start tree exercised the paths it exists for; throws on violation. */
export function assertColdStartPremise(
  snapshot: { sessions: ReadonlyArray<{ subagents: ReadonlyArray<{ finalText: string | null }> }> },
  historyEntries: ReadonlyArray<{ usage: { inputTokens: number } | null }>,
  liveCount: number,
): void {
  // Only sessions whose PID is alive resolve; the rest are reported as ended.
  expect(snapshot.sessions.length).toBe(liveCount);

  // finalText is clipped to the row limit (120) with the ellipsis marker.
  const finalTexts = snapshot.sessions.flatMap((session) =>
    session.subagents.map((node) => node.finalText),
  );
  const extracted = finalTexts.find((text): text is string => text !== null);
  expect(extracted).toBeDefined();
  expect(extracted).toMatch(/…$/);
  expect(extracted?.length).toBeLessThanOrEqual(120);
  expect(extracted?.length).toBeGreaterThan(100);

  const historyUsages = historyEntries
    .map((entry) => entry.usage)
    .filter((usage): usage is NonNullable<typeof usage> => usage !== null);
  expect(historyUsages.length).toBeGreaterThan(0);
  expect(historyUsages[0]!.inputTokens).toBeGreaterThan(0);
}

export function budgetMessage(label: string, measuredMs: number, budgetMs = 2_000): string {
  return `${label}: measured ${measuredMs} ms, budget ${budgetMs} ms`;
}
