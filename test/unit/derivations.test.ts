/**
 * Context pressure (§6.4), tray aggregation (§6.5), notification discipline (§6.6),
 * the registry cross-check (§4) and the store's repository behaviour (§5.4).
 */

import { describe, expect, it } from 'vitest';
import { parseRegistryEntry, readRegistry } from '../../src/core/registry/registry.ts';
import {
  epochMsToFileTime,
  fileTimeToEpochMs,
  procStartMatches,
} from '../../src/core/registry/liveness.ts';
import {
  ContextWindowEstimator,
  DEFAULT_CONTEXT_WINDOW,
  WIDE_CONTEXT_WINDOW,
  bandFor,
  usedTokens,
  windowForModel,
} from '../../src/core/state/contextPressure.ts';
import {
  attentionCount,
  groupSessions,
  selectTraySessions,
  trayIconFor,
  trayStateFor,
} from '../../src/core/state/aggregate.ts';
import { NotificationGate, decideNotification, firstSentence } from '../../src/core/state/notifications.ts';
import { cleanPromptText } from '../../src/core/adapters/claude/summarize.ts';
import { InMemorySessionStore } from '../../src/core/store/sessionStore.ts';
import {
  DEFAULT_SETTINGS,
  DEFAULT_THRESHOLDS,
  SETTINGS_SCHEMA_VERSION,
  applyNotificationMode,
  mergeSettings,
  notificationMode,
} from '../../src/core/model/settings.ts';
import type { SessionStatus } from '../../src/core/model/status.ts';
import type { HistoryEntry, SessionView, StatusTransition } from '../../src/core/model/types.ts';
import { T0, makeFixtureTree, registryEntry } from '../fixtures/builders.ts';

function view(overrides: Partial<SessionView> & { sessionId: string; status: SessionStatus }): SessionView {
  return {
    name: overrides.sessionId,
    title: null,
    statusReason: 'test',
    statusSource: 'inferred',
    statusSince: 0,
    seen: false,
    project: { path: 'c:\\dev\\proj', name: 'proj', key: 'c:/dev/proj' },
    branch: 'main',
    groupKey: 'c:/dev/proj::main',
    model: 'claude-opus-5',
    entrypoint: 'claude-vscode',
    pid: 1,
    alive: true,
    startedAt: T0,
    lastActivityAt: T0,
    run: null,
    pendingTool: null,
    context: null,
    subagents: [],
    lastAssistantText: null,
    transcriptPath: null,
    cwd: 'c:\\dev\\proj',
    agentVersion: '2.1.222',
    ...overrides,
  };
}

describe('context pressure', () => {
  it('sums input, cache read and cache creation tokens', () => {
    expect(
      usedTokens({ inputTokens: 2, cacheReadTokens: 22_753, cacheCreationTokens: 10_135, outputTokens: 268 }),
    ).toBe(32_890);
  });

  it('applies the §6.4 band thresholds', () => {
    expect(bandFor(0.1)).toBe('green');
    expect(bandFor(0.599)).toBe('green');
    expect(bandFor(0.6)).toBe('yellow');
    expect(bandFor(0.79)).toBe('yellow');
    expect(bandFor(0.8)).toBe('red');
    expect(bandFor(0.92)).toBe('red');
    expect(bandFor(0.93)).toBe('critical');
  });

  it('defaults to a conservative 200k window, including for unknown models', () => {
    expect(windowForModel('claude-opus-5')).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(windowForModel(null)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(windowForModel('some-future-model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('recognises an explicit 1M suffix if it ever appears', () => {
    expect(windowForModel('claude-opus-5[1m]')).toBe(WIDE_CONTEXT_WINDOW);
  });

  it('auto-widens a session whose usage exceeds the assumed window, and keeps it widened', () => {
    const estimator = new ContextWindowEstimator();
    const under = estimator.estimate('s1', 'claude-opus-5', {
      inputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
    })!;
    expect(under.window).toBe(200_000);
    expect(under.widened).toBe(false);

    const over = estimator.estimate('s1', 'claude-opus-5', {
      inputTokens: 250_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
    })!;
    expect(over.window).toBe(WIDE_CONTEXT_WINDOW);
    expect(over.widened).toBe(true);
    expect(over.ratio).toBeLessThan(1);

    // Usage drops after a compaction — the session must not flip back and forth.
    const after = estimator.estimate('s1', 'claude-opus-5', {
      inputTokens: 10_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
    })!;
    expect(after.window).toBe(WIDE_CONTEXT_WINDOW);
    expect(after.widened).toBe(true);
  });

  it('returns null when the tail carried no usage', () => {
    expect(new ContextWindowEstimator().estimate('s1', 'claude-opus-5', null)).toBeNull();
  });
});

describe('tray aggregation', () => {
  it('uses the order waiting > done > stale > working > none', () => {
    expect(trayStateFor([])).toBe('none');
    expect(trayStateFor([view({ sessionId: 'a', status: 'working' })])).toBe('working');
    expect(
      trayStateFor([view({ sessionId: 'a', status: 'stale' }), view({ sessionId: 'b', status: 'working' })]),
    ).toBe('stale');
    expect(
      trayStateFor([view({ sessionId: 'a', status: 'stale' }), view({ sessionId: 'b', status: 'done' })]),
    ).toBe('done');
    expect(
      trayStateFor([view({ sessionId: 'a', status: 'done' }), view({ sessionId: 'b', status: 'waiting' })]),
    ).toBe('waiting');
  });

  it('shows the mixed tile only for a finished turn with something still running', () => {
    const done = view({ sessionId: 'a', status: 'done' });

    expect(trayIconFor([done])).toBe('done');
    expect(trayIconFor([done, view({ sessionId: 'b', status: 'working' })])).toBe('mixed');
    // `stale` is a suspicion, not a running turn: it must not claim the working half.
    expect(trayIconFor([done, view({ sessionId: 'b', status: 'stale' })])).toBe('done');
    // Anything more urgent than `done` wins outright, as it does for the colour.
    expect(
      trayIconFor([done, view({ sessionId: 'b', status: 'working' }), view({ sessionId: 'c', status: 'waiting' })]),
    ).toBe('waiting');
    // An acknowledged `done` is no longer news, so there is no "finished" half left to mix.
    expect(
      trayIconFor([
        view({ sessionId: 'a', status: 'done', seen: true }),
        view({ sessionId: 'b', status: 'working' }),
      ]),
    ).toBe('working');
  });

  it('counts only waiting and done towards the badge', () => {
    expect(
      attentionCount([
        view({ sessionId: 'a', status: 'waiting' }),
        view({ sessionId: 'b', status: 'done' }),
        view({ sessionId: 'c', status: 'working' }),
        // `stale` is a hint, not a demand: it must never put a number on the tray icon.
        view({ sessionId: 'd', status: 'stale' }),
        view({ sessionId: 'e', status: 'queued' }),
      ]),
    ).toBe(2);
  });

  it('drops acknowledged sessions from the badge and the icon colour', () => {
    const seenDone = view({ sessionId: 'a', status: 'done', seen: true });
    const unseenDone = view({ sessionId: 'b', status: 'done' });

    expect(attentionCount([seenDone, unseenDone])).toBe(1);
    expect(attentionCount([seenDone])).toBe(0);

    // Acknowledged attention no longer lights the icon, but a session that is still
    // working keeps it on — "seen" is about news, not about the session being over.
    expect(trayStateFor([seenDone])).toBe('none');
    expect(trayStateFor([seenDone, view({ sessionId: 'c', status: 'working' })])).toBe('working');
    expect(trayStateFor([seenDone, unseenDone])).toBe('done');
  });

  it('keeps everything in flight in the tray, however old it is', () => {
    const ancient = 4 * 60 * 60_000;
    const ids = (sessions: SessionView[]): string[] => sessions.map((s) => s.sessionId);
    const old = (status: SessionStatus, sessionId: string): SessionView =>
      view({ sessionId, status, seen: true, lastActivityAt: T0 - ancient });

    expect(
      ids(
        selectTraySessions(
          [old('working', 'a'), old('stale', 'b'), old('queued', 'c'), old('waiting', 'd')],
          T0,
          30 * 60_000,
        ),
      ),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops settled sessions once they are old and acknowledged', () => {
    const recentMs = 30 * 60_000;
    const seenAndOld = view({
      sessionId: 'old',
      status: 'done',
      seen: true,
      lastActivityAt: T0 - 2 * 60 * 60_000,
    });
    // Unacknowledged is news at any age — dropping it would lose the result silently.
    const unseenAndOld = { ...seenAndOld, sessionId: 'unseen', seen: false };
    // Acknowledged but recent: you were just in it, so it stays reachable for a while.
    const seenAndRecent = { ...seenAndOld, sessionId: 'fresh', lastActivityAt: T0 - 60_000 };

    const kept = selectTraySessions([seenAndOld, unseenAndOld, seenAndRecent], T0, recentMs);
    expect(kept.map((s) => s.sessionId)).toEqual(['unseen', 'fresh']);
  });

  it('falls back to the start time for a session that never recorded activity', () => {
    const noActivity = view({
      sessionId: 'x',
      status: 'unknown',
      seen: true,
      lastActivityAt: null,
      startedAt: T0 - 2 * 60 * 60_000,
    });
    expect(selectTraySessions([noActivity], T0, 30 * 60_000)).toEqual([]);
  });

  it('groups by project, then by branch/worktree', () => {
    const groups = groupSessions([
      view({ sessionId: 'a', status: 'working' }),
      view({ sessionId: 'b', status: 'stale', branch: 'feature/x' }),
      view({
        sessionId: 'c',
        status: 'waiting',
        project: { path: 'c:\\dev\\other', name: 'other', key: 'c:/dev/other' },
      }),
    ]);
    expect(groups).toHaveLength(2);
    // The project with attention floats to the top.
    expect(groups[0]!.project.name).toBe('other');
    const proj = groups.find((group) => group.project.name === 'proj')!;
    expect(proj.branches.map((branch) => branch.branch).sort()).toEqual(['feature/x', 'main']);
  });
});

describe('notification discipline', () => {
  const settings = DEFAULT_SETTINGS.notifications;

  function transition(to: SessionStatus, at: number, seeded = false): StatusTransition {
    return {
      sessionId: 's1',
      from: 'working',
      to,
      at,
      seeded,
      view: view({ sessionId: 's1', status: to }),
    };
  }

  it('stays silent while seeding on startup', () => {
    expect(decideNotification(transition('done', T0, true), null, settings)).toMatchObject({
      notify: false,
      reason: 'seeded',
    });
  });

  it('fires on a transition into done or waiting', () => {
    expect(decideNotification(transition('done', T0), null, settings).notify).toBe(true);
    expect(decideNotification(transition('waiting', T0), null, settings).notify).toBe(true);
  });

  it('never fires for the non-notifying states', () => {
    for (const status of ['working', 'idle', 'queued', 'ended', 'unknown'] as SessionStatus[]) {
      expect(decideNotification(transition(status, T0), null, settings).notify).toBe(false);
    }
  });

  it('notifies once for done → working → done inside the cooldown', () => {
    const gate = new NotificationGate();
    expect(gate.evaluate(transition('done', T0), settings).notify).toBe(true);
    expect(gate.evaluate(transition('working', T0 + 1_000), settings).notify).toBe(false);
    expect(gate.evaluate(transition('done', T0 + 2_000), settings).notify).toBe(false);
    // Past the cooldown the next finished turn is worth announcing again.
    expect(gate.evaluate(transition('done', T0 + 61_000), settings).notify).toBe(true);
  });

  it('uses the first sentence of the assistant message as the toast body', () => {
    expect(firstSentence('Done. Anything else?')).toBe('Done.');
    expect(firstSentence('  multi\nline   text without punctuation ')).toBe(
      'multi line text without punctuation',
    );
    expect(firstSentence('x'.repeat(300))!.endsWith('…')).toBe(true);
    expect(firstSentence(null)).toBeNull();
  });

  it('honours the per-status toggles', () => {
    const muted = { ...settings, onDone: false };
    expect(decideNotification(transition('done', T0), null, muted).notify).toBe(false);
    expect(decideNotification(transition('waiting', T0), null, muted).notify).toBe(true);
    expect(decideNotification(transition('waiting', T0), null, { ...settings, enabled: false }).notify).toBe(
      false,
    );
  });
});

describe('fallback session titles', () => {
  it('strips slash-command machinery the user never typed', () => {
    expect(
      cleanPromptText('<command-name>/goal</command-name> <command-message>goal</command-message>'),
    ).toBe('/goal');
  });

  it('drops the local-command caveat paragraph', () => {
    const text =
      'Caveat: The messages below were generated by the user while running local commands. ' +
      'DO NOT respond to these messages or otherwise consider them in your response unless the ' +
      'user explicitly asks you to. Real prompt here';
    expect(cleanPromptText(text)).toBe('Real prompt here');
  });

  it('drops system reminders and IDE selection blocks', () => {
    expect(cleanPromptText('<system-reminder>noise</system-reminder> build it')).toBe('build it');
    expect(cleanPromptText('<ide_selection>code</ide_selection> fix this')).toBe('fix this');
  });

  it('returns null when nothing readable is left', () => {
    expect(cleanPromptText('<system-reminder>only noise</system-reminder>')).toBeNull();
    expect(cleanPromptText(null)).toBeNull();
  });
});

describe('registry', () => {
  it('parses an entry in the RESEARCH.md §1 shape', () => {
    const entry = parseRegistryEntry(
      JSON.stringify(registryEntry({ pid: 17_152, sessionId: 'abc', name: 'claude-control-d5' })),
      'sessions/17152.json',
      17_152,
      T0,
    );
    expect(entry).not.toBeNull();
    expect(entry!.pid).toBe(17_152);
    expect(entry!.name).toBe('claude-control-d5');
    expect(entry!.procStart).toBeTypeOf('string');
  });

  it('rejects entries without sessionId or cwd instead of inventing them', () => {
    expect(parseRegistryEntry('{"pid":1}', 'f', 1, T0)).toBeNull();
    expect(parseRegistryEntry('not json', 'f', 1, T0)).toBeNull();
  });

  it('ignores files that are not <pid>.json and never throws', async () => {
    const tree = await makeFixtureTree();
    await tree.writeRegistry(17_152, registryEntry({ pid: 17_152, sessionId: 'abc' }));
    await tree.writeIdeLock(1, { pid: 1 });
    const result = await readRegistry(tree.sessionsDir);
    expect(result.entries).toHaveLength(1);

    const missing = await readRegistry(`${tree.sessionsDir}-does-not-exist`);
    expect(missing.entries).toHaveLength(0);
    expect(missing.problems).toHaveLength(1);
  });

  it('detects PID reuse via procStart, and treats unknown as a pass', () => {
    const stamp = epochMsToFileTime(T0);
    expect(procStartMatches(stamp, stamp)).toBe(true);
    expect(procStartMatches(stamp, epochMsToFileTime(T0 + 500))).toBe(true);
    expect(procStartMatches(stamp, epochMsToFileTime(T0 + 10_000))).toBe(false);
    expect(procStartMatches(stamp, null)).toBe(true);
    expect(procStartMatches(null, stamp)).toBe(true);
    expect(procStartMatches('garbage', stamp)).toBe(true);
  });

  it('round-trips FILETIME conversions', () => {
    expect(fileTimeToEpochMs(epochMsToFileTime(T0))).toBe(T0);
    // The value observed in research decodes to a plausible timestamp, not to 1601.
    expect(fileTimeToEpochMs('134303945409015547')).toBeGreaterThan(Date.UTC(2020, 0, 1));
  });
});

describe('session store', () => {
  it('reports transitions and marks the first pass as seeded', () => {
    const store = new InMemorySessionStore();
    expect(store.isSeeding()).toBe(true);

    const first = store.putLive([view({ sessionId: 's1', status: 'working' })], T0);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ from: null, to: 'working', seeded: true });
    expect(store.isSeeding()).toBe(false);

    const same = store.putLive([view({ sessionId: 's1', status: 'working' })], T0 + 1_000);
    expect(same).toHaveLength(0);

    const changed = store.putLive([view({ sessionId: 's1', status: 'done' })], T0 + 2_000);
    expect(changed[0]).toMatchObject({ from: 'working', to: 'done', seeded: false });
    expect(store.getLive('s1')!.statusSince).toBe(T0 + 2_000);
  });

  it('keeps an acknowledgement across re-derivations of the same status', () => {
    const store = new InMemorySessionStore();
    store.putLive([view({ sessionId: 's1', status: 'done' })], T0);
    expect(store.getLive('s1')!.seen).toBe(false);

    expect(store.acknowledge('s1')).toBe(true);
    expect(store.getLive('s1')!.seen).toBe(true);
    // Acknowledging twice is a no-op, so the UI can skip a re-render.
    expect(store.acknowledge('s1')).toBe(false);

    // The 5 s tick re-derives the same status over and over; that must not re-arm the badge.
    store.putLive([view({ sessionId: 's1', status: 'done' })], T0 + 5_000);
    expect(store.getLive('s1')!.seen).toBe(true);
  });

  it('re-arms an acknowledged session when its status actually changes', () => {
    const store = new InMemorySessionStore();
    store.putLive([view({ sessionId: 's1', status: 'done' })], T0);
    store.acknowledge('s1');

    // done → working → done is news again, even though the state reads the same as before.
    store.putLive([view({ sessionId: 's1', status: 'working' })], T0 + 1_000);
    store.putLive([view({ sessionId: 's1', status: 'done' })], T0 + 2_000);
    expect(store.getLive('s1')!.seen).toBe(false);
  });

  it('acknowledges every live session at once and reports how many changed', () => {
    const store = new InMemorySessionStore();
    store.putLive(
      [
        view({ sessionId: 's1', status: 'done' }),
        view({ sessionId: 's2', status: 'waiting' }),
        view({ sessionId: 's3', status: 'working' }),
      ],
      T0,
    );
    expect(store.acknowledgeAll()).toBe(3);
    expect(store.acknowledgeAll()).toBe(0);
    expect(store.listLive().every((session) => session.seen)).toBe(true);
  });

  it('emits an ended transition for a session that left the registry', () => {
    const store = new InMemorySessionStore();
    store.putLive([view({ sessionId: 's1', status: 'working' })], T0);
    const gone = store.putLive([], T0 + 5_000);
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ to: 'ended', from: 'working' });
    expect(store.listLive()).toHaveLength(0);
  });

  it('filters history by project, text and date, and hides live sessions', () => {
    const store = new InMemorySessionStore();
    const entries: HistoryEntry[] = [
      {
        sessionId: 'h1',
        transcriptPath: 'a.jsonl',
        project: { path: 'c:\\dev\\proj', name: 'proj', key: 'c:/dev/proj' },
        branch: 'main',
        title: 'Add the tray icon',
        model: 'claude-opus-5',
        startedAt: T0 - 10_000,
        endedAt: T0,
        finalStatus: 'done',
        messageCountEstimate: 42,
        fileSize: 1024,
        mtimeMs: T0,
      },
      {
        sessionId: 'h2',
        transcriptPath: 'b.jsonl',
        project: { path: 'c:\\dev\\other', name: 'other', key: 'c:/dev/other' },
        branch: null,
        title: 'Unrelated work',
        model: null,
        startedAt: T0 - 100_000,
        endedAt: T0 - 90_000,
        finalStatus: 'unknown',
        messageCountEstimate: 3,
        fileSize: 256,
        mtimeMs: T0 - 90_000,
      },
    ];
    store.putHistory(entries);

    expect(store.listHistory()).toHaveLength(2);
    expect(store.listHistory({ projectKey: 'c:/dev/proj' })).toHaveLength(1);
    expect(store.listHistory({ search: 'tray' })).toHaveLength(1);
    expect(store.listHistory({ search: 'TRAY' })).toHaveLength(1);
    expect(store.listHistory({ from: T0 - 50_000 })).toHaveLength(1);
    // Newest first.
    expect(store.listHistory()[0]!.sessionId).toBe('h1');

    // A session that is live now belongs to the live list, not to history.
    store.putLive([view({ sessionId: 'h1', status: 'working' })], T0);
    expect(store.listHistory().map((entry) => entry.sessionId)).toEqual(['h2']);
  });
});

describe('notification modes (the popover quick-switch)', () => {
  const base = DEFAULT_SETTINGS.notifications;

  it('reads the four modes off the booleans, and a fresh install as "all"', () => {
    expect(notificationMode(base)).toBe('all');
    expect(notificationMode({ ...base, enabled: false })).toBe('off');
    expect(notificationMode({ ...base, onDone: false })).toBe('waiting');
    expect(notificationMode({ ...base, onWaiting: false })).toBe('done');
    // Enabled with neither toggle delivers nothing, so it reads as off rather than throwing.
    expect(notificationMode({ ...base, onDone: false, onWaiting: false })).toBe('off');
  });

  it('writes each mode back onto the booleans', () => {
    expect(applyNotificationMode(base, 'waiting')).toMatchObject({
      enabled: true,
      onWaiting: true,
      onDone: false,
    });
    expect(applyNotificationMode(base, 'done')).toMatchObject({
      enabled: true,
      onWaiting: false,
      onDone: true,
    });
    expect(applyNotificationMode({ ...base, enabled: false }, 'all')).toMatchObject({
      enabled: true,
      onWaiting: true,
      onDone: true,
    });
  });

  it('keeps the on/off pair and the cooldown when switched off, and restores it', () => {
    const picked = applyNotificationMode({ ...base, cooldownMs: 5_000 }, 'done');
    const off = applyNotificationMode(picked, 'off');
    expect(off).toEqual({ ...picked, enabled: false });
    expect(notificationMode(off)).toBe('off');
    // Switching back on finds the previous pair untouched.
    expect({ ...off, enabled: true }).toEqual(picked);
  });

  it('never touches the shipped default', () => {
    applyNotificationMode(DEFAULT_SETTINGS.notifications, 'off');
    expect(DEFAULT_SETTINGS.notifications.enabled).toBe(true);
  });
});

describe('settings migration', () => {
  /** A v1 file: written in full, so every untouched default is in there verbatim. */
  function v1File(perToolWorkMs: Record<string, number>) {
    return {
      claudeDir: null,
      thresholds: { tWorkMs: 25_000, tIdleMs: 600_000, perToolWorkMs },
      list: { hideUnusedSessions: true },
    };
  }

  it('lifts subagent budgets that were never changed away from the old default', () => {
    const merged = mergeSettings(v1File({ Agent: 180_000, Workflow: 180_000, Bash: 120_000 }));
    expect(merged.thresholds.perToolWorkMs.Agent).toBe(DEFAULT_THRESHOLDS.perToolWorkMs.Agent);
    expect(merged.thresholds.perToolWorkMs.Workflow).toBe(DEFAULT_THRESHOLDS.perToolWorkMs.Workflow);
    // Untouched by this migration, and still the user's to keep.
    expect(merged.thresholds.perToolWorkMs.Bash).toBe(120_000);
    expect(merged.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it('keeps a budget the user actually chose', () => {
    const merged = mergeSettings(v1File({ Agent: 90_000 }));
    expect(merged.thresholds.perToolWorkMs.Agent).toBe(90_000);
  });

  it('does not re-run on a current file, so the new default is overridable', () => {
    const merged = mergeSettings({
      ...v1File({ Agent: 180_000 }),
      schemaVersion: SETTINGS_SCHEMA_VERSION,
    });
    expect(merged.thresholds.perToolWorkMs.Agent).toBe(180_000);
  });

  it('drops the retired T_idle without complaining', () => {
    const merged = mergeSettings(v1File({}));
    expect(merged).not.toHaveProperty('thresholds.tIdleMs');
    expect(merged.list.trayRecentMs).toBe(DEFAULT_SETTINGS.list.trayRecentMs);
  });

  it('fills in autostart and globalShortcut when a settings file predates them', () => {
    const merged = mergeSettings(v1File({}));
    expect(merged.ui.autostart).toBe(DEFAULT_SETTINGS.ui.autostart);
    expect(merged.ui.globalShortcut).toBe(DEFAULT_SETTINGS.ui.globalShortcut);
  });

  it('keeps a user-chosen autostart and globalShortcut, including an empty (disabled) shortcut', () => {
    const merged = mergeSettings({
      ...v1File({}),
      ui: { autostart: true, globalShortcut: '' },
    });
    expect(merged.ui.autostart).toBe(true);
    expect(merged.ui.globalShortcut).toBe('');
  });

  it('falls back to the defaults when autostart or globalShortcut are garbage', () => {
    const merged = mergeSettings({
      ...v1File({}),
      ui: { autostart: 'yes', globalShortcut: 42 },
    });
    expect(merged.ui.autostart).toBe(DEFAULT_SETTINGS.ui.autostart);
    expect(merged.ui.globalShortcut).toBe(DEFAULT_SETTINGS.ui.globalShortcut);
  });
});
