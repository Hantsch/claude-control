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
  pressureFor,
  usedTokens,
  windowForModel,
} from '../../src/core/state/contextPressure.ts';
import {
  STATUS_SORT_RANK,
  attentionCount,
  dismissibleCount,
  groupSessions,
  isDismissible,
  popoverGroupRank,
  selectTraySessions,
  trayIconFor,
  trayStateFor,
} from '../../src/core/state/aggregate.ts';
import type { ProjectGroup } from '../../src/core/state/aggregate.ts';
import { NotificationGate, decideNotification, firstSentence } from '../../src/core/state/notifications.ts';
import { cleanPromptText } from '../../src/core/adapters/claude/summarize.ts';
import { InMemorySessionStore } from '../../src/core/store/sessionStore.ts';
import { ControlEngine } from '../../src/core/engine.ts';
import type { AgentAdapter } from '../../src/core/adapters/types.ts';
import {
  DEFAULT_SETTINGS,
  DEFAULT_THRESHOLDS,
  SETTINGS_SCHEMA_VERSION,
  applyNotificationMode,
  mergeSettings,
  notificationMode,
} from '../../src/core/model/settings.ts';
import type { SessionStatus } from '../../src/core/model/status.ts';
import type { HistoryEntry, SessionView, StatusTransition, UsageTotals } from '../../src/core/model/types.ts';
import { T0, makeFixtureTree, registryEntry } from '../fixtures/builders.ts';

function view(overrides: Partial<SessionView> & { sessionId: string; status: SessionStatus }): SessionView {
  return {
    name: overrides.sessionId,
    title: null,
    statusReason: 'test',
    statusSource: 'inferred',
    statusSince: 0,
    seen: false,
    dismissed: false,
    muted: false,
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

/** A usage total with everything but `inputTokens` at zero — used ≈ inputTokens. */
function usage(inputTokens: number): UsageTotals {
  return { inputTokens, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 };
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

  it('labels the estimate table as estimated when no exact lookup is wired', () => {
    const pressure = pressureFor('claude-opus-5', usage(100_000));
    expect(pressure.window).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(pressure.windowSource).toBe('estimated');
    expect(new ContextWindowEstimator().estimate('s1', 'claude-opus-5', usage(100_000))!.windowSource).toBe(
      'estimated',
    );
  });

  it('keeps the estimate when the lookup has no entry for the model', () => {
    const pressure = pressureFor('claude-opus-5', usage(100_000), false, () => null);
    expect(pressure.window).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(pressure.windowSource).toBe('estimated');
  });

  it('uses the exact window over the estimate table and says so', () => {
    const estimator = new ContextWindowEstimator(() => 500_000);
    const pressure = estimator.estimate('s1', 'claude-opus-5', usage(100_000))!;
    expect(pressure.window).toBe(500_000);
    expect(pressure.ratio).toBeCloseTo(0.2);
    expect(pressure.widened).toBe(false);
    expect(pressure.windowSource).toBe('exact');
  });

  it('does not widen while the usage still fits the exact window', () => {
    // 250k exceeds the 200k *estimate* but not the exact 500k, so the old widening is gone.
    const pressure = new ContextWindowEstimator(() => 500_000).estimate('s1', 'claude-opus-5', usage(250_000))!;
    expect(pressure.widened).toBe(false);
    expect(pressure.window).toBe(500_000);
    expect(pressure.windowSource).toBe('exact');
  });

  it('reports a widened session as estimated even when an exact window was available', () => {
    const estimator = new ContextWindowEstimator(() => 500_000);
    const over = estimator.estimate('s1', 'claude-opus-5', usage(600_000))!;
    expect(over.widened).toBe(true);
    expect(over.window).toBe(WIDE_CONTEXT_WINDOW);
    expect(over.windowSource).toBe('estimated');

    // Sticky: the session stays widened after a compaction, so it stays 'estimated' too —
    // an auto-widened guess is never re-labelled as the table's exact number.
    const after = estimator.estimate('s1', 'claude-opus-5', usage(10_000))!;
    expect(after.widened).toBe(true);
    expect(after.window).toBe(WIDE_CONTEXT_WINDOW);
    expect(after.windowSource).toBe('estimated');
  });

  it('follows the lookup live, so toggling the setting off falls back to the estimate', () => {
    let exact: number | null = 500_000;
    const estimator = new ContextWindowEstimator(() => exact);
    expect(estimator.estimate('s1', 'claude-opus-5', usage(100_000))!.window).toBe(500_000);
    exact = null; // what WindowSource returns once `setEnabled(false)` was called
    const off = estimator.estimate('s1', 'claude-opus-5', usage(100_000))!;
    expect(off.window).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(off.windowSource).toBe('estimated');
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

  it('lets an explicit dismissal beat the recency window', () => {
    const recentMs = 30 * 60_000;
    // Acknowledged and recent: rule 3 keeps it around, you were just in it.
    const justFinished = view({
      sessionId: 'fresh',
      status: 'done',
      seen: true,
      lastActivityAt: T0 - 60_000,
    });
    // The same row after "Mark as seen" in the popover — gone now, not in half an hour.
    const dismissed = { ...justFinished, sessionId: 'dismissed', dismissed: true };
    // A dismissal must not hide something that is still in flight: rule 1 outranks it, and the
    // stamp behind `dismissed` re-arms on the next status change anyway.
    const stillWorking = view({ sessionId: 'busy', status: 'working', seen: true, dismissed: true });

    const kept = selectTraySessions([justFinished, dismissed, stillWorking], T0, recentMs);
    expect(kept.map((s) => s.sessionId)).toEqual(['fresh', 'busy']);
  });

  it('counts what "mark all as seen" would actually remove', () => {
    const sessions = [
      view({ sessionId: 'a', status: 'done' }),
      view({ sessionId: 'b', status: 'unknown' }),
      // In flight, in any of its four shapes — a dismissal cannot touch these.
      view({ sessionId: 'c', status: 'working' }),
      view({ sessionId: 'd', status: 'waiting' }),
      view({ sessionId: 'e', status: 'stale' }),
      view({ sessionId: 'f', status: 'queued' }),
    ];
    expect(sessions.filter(isDismissible).map((s) => s.sessionId)).toEqual(['a', 'b']);
    expect(dismissibleCount(sessions)).toBe(2);
    expect(dismissibleCount([])).toBe(0);
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

  it('rolls each group up into per-status counts, ordered by urgency and zero counts omitted', () => {
    const groups = groupSessions([
      view({ sessionId: 'a', status: 'working' }),
      view({ sessionId: 'b', status: 'waiting' }),
      view({ sessionId: 'c', status: 'waiting' }),
      view({ sessionId: 'd', status: 'done' }),
    ]);
    const proj = groups.find((group) => group.project.name === 'proj')!;
    // Insertion order was working, waiting, waiting, done — the rollup must reorder to the
    // STATUS_SORT_RANK urgency order (waiting, done, working), not first-seen order.
    expect(proj.statusCounts).toEqual([
      { status: 'waiting', count: 2 },
      { status: 'done', count: 1 },
      { status: 'working', count: 1 },
    ]);
    // Statuses absent from the group (stale, queued, starting, unknown, ended) are omitted
    // entirely rather than reported with a zero count.
    expect(proj.statusCounts.some((entry) => entry.status === 'stale')).toBe(false);
  });

  it('gives a single-status group a single-entry rollup', () => {
    const groups = groupSessions([
      view({ sessionId: 'a', status: 'done' }),
      view({ sessionId: 'b', status: 'done' }),
    ]);
    expect(groups[0]!.statusCounts).toEqual([{ status: 'done', count: 2 }]);
  });
});

describe('popover group order', () => {
  const project = (name: string): SessionView['project'] => ({
    path: `c:\\dev\\${name}`,
    name,
    key: `c:/dev/${name}`,
  });

  /** Exactly the sort `popover.tsx` runs over `groupSessions`. */
  const popoverOrder = (groups: ProjectGroup[]): string[] =>
    [...groups]
      .sort((a, b) => {
        const rank = popoverGroupRank(a) - popoverGroupRank(b);
        if (rank !== 0) return rank;
        return a.project.name.localeCompare(b.project.name);
      })
      .map((group) => group.project.name);

  /** The pre-013 order: rank of the group's first row only, then project name. */
  const legacyOrder = (groups: ProjectGroup[]): string[] =>
    [...groups]
      .sort((a, b) => {
        const rank = STATUS_SORT_RANK[a.sessions[0]!.status] - STATUS_SORT_RANK[b.sessions[0]!.status];
        if (rank !== 0) return rank;
        return a.project.name.localeCompare(b.project.name);
      })
      .map((group) => group.project.name);

  it('sinks a project whose waiting session was already seen below one with unseen news', () => {
    const groups = groupSessions([
      view({ sessionId: 'a', status: 'waiting', seen: true, project: project('alpha') }),
      view({ sessionId: 'b', status: 'waiting', project: project('beta') }),
    ]);
    const alpha = groups.find((group) => group.project.name === 'alpha')!;
    const beta = groups.find((group) => group.project.name === 'beta')!;

    // Demoted below `ended`, keeping waiting-before-done inside the demoted band.
    expect(popoverGroupRank(alpha)).toBe(STATUS_SORT_RANK.ended + 1 + STATUS_SORT_RANK.waiting);
    expect(popoverGroupRank(beta)).toBe(STATUS_SORT_RANK.waiting);
    expect(popoverGroupRank(beta)).toBeLessThan(popoverGroupRank(alpha));
    expect(popoverOrder(groups)).toEqual(['beta', 'alpha']);
    // Both first rows are `waiting`, so the old sort tied and fell back to the name.
    expect(legacyOrder(groups)).toEqual(['alpha', 'beta']);
  });

  it('leaves the order exactly as it was when nothing has been seen', () => {
    const groups = groupSessions([
      view({ sessionId: 'a', status: 'working', project: project('alpha') }),
      view({ sessionId: 'b', status: 'done', project: project('alpha') }),
      view({ sessionId: 'c', status: 'waiting', project: project('beta') }),
      view({ sessionId: 'd', status: 'working', project: project('gamma') }),
    ]);

    expect(popoverOrder(groups)).toEqual(['beta', 'alpha', 'gamma']);
    expect(popoverOrder(groups)).toEqual(legacyOrder(groups));
  });

  it('demotes the group but not the rows inside it', () => {
    const groups = groupSessions([
      view({ sessionId: 'seen-waiting', status: 'waiting', seen: true, project: project('alpha') }),
      view({ sessionId: 'unseen-done', status: 'done', project: project('alpha') }),
      view({ sessionId: 'unseen-waiting', status: 'waiting', project: project('beta') }),
    ]);
    const alpha = groups.find((group) => group.project.name === 'alpha')!;

    // The group is ranked by its unseen `done` — scanning all sessions, not just the first row.
    expect(popoverGroupRank(alpha)).toBe(STATUS_SORT_RANK.done);
    expect(popoverOrder(groups)).toEqual(['beta', 'alpha']);
    // `compareSessions` is untouched: the seen `waiting` is still alpha's first displayed row.
    expect(alpha.sessions.map((session) => session.sessionId)).toEqual([
      'seen-waiting',
      'unseen-done',
    ]);
  });

  it('keeps a seen done below a seen waiting, both below ended', () => {
    const groups = groupSessions([
      view({ sessionId: 'a', status: 'done', seen: true, project: project('alpha') }),
      view({ sessionId: 'b', status: 'waiting', seen: true, project: project('beta') }),
      view({ sessionId: 'c', status: 'ended', project: project('gamma') }),
    ]);
    expect(popoverOrder(groups)).toEqual(['gamma', 'beta', 'alpha']);
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

  it('treats a session mute as an override, ahead of the global settings', () => {
    expect(decideNotification(transition('done', T0), null, settings, true)).toMatchObject({
      notify: false,
      reason: 'session-muted',
    });
    // Muted still beats a disabled-globally setting or a not-notifying status — 'session-muted'
    // is reported because the mute is what's actually silencing it here.
    expect(
      decideNotification(transition('waiting', T0), null, { ...settings, enabled: false }, true),
    ).toMatchObject({ notify: false, reason: 'session-muted' });
    // Unmuted (the default) behaves exactly as before.
    expect(decideNotification(transition('done', T0), null, settings, false).notify).toBe(true);
  });

  it('threads the mute flag through the gate the same way as the settings', () => {
    const gate = new NotificationGate();
    expect(gate.evaluate(transition('done', T0), settings, true)).toMatchObject({
      notify: false,
      reason: 'session-muted',
    });
    // Unmuting restores normal toasts immediately, with no cooldown residue from the muted
    // attempt (a muted decision never records `lastNotifiedAt`).
    expect(gate.evaluate(transition('done', T0 + 1_000), settings, false).notify).toBe(true);
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

  it('dismisses a session, and re-arms it only when real news arrives', () => {
    const store = new InMemorySessionStore();
    store.putLive([view({ sessionId: 's1', status: 'done' })], T0);

    expect(store.dismiss('s1')).toBe(true);
    // A dismissal is an acknowledgement too: the badge clears together with the row.
    expect(store.getLive('s1')).toMatchObject({ seen: true, dismissed: true });
    // Dismissing twice changes nothing, so the UI can skip a re-render.
    expect(store.dismiss('s1')).toBe(false);
    expect(store.acknowledge('s1')).toBe(false);

    // The 5 s tick re-derives the same status over and over; that must not bring the row back.
    store.putLive([view({ sessionId: 's1', status: 'done' })], T0 + 5_000);
    expect(store.getLive('s1')!.dismissed).toBe(true);

    // A new turn in the same status is news, so it comes back — a dismissal can never hide
    // something that happened after it.
    store.putLive(
      [view({ sessionId: 's1', status: 'done', lastActivityAt: T0 + 10_000 })],
      T0 + 10_000,
    );
    expect(store.getLive('s1')).toMatchObject({ seen: false, dismissed: false });
  });

  it('dismisses every live session at once and reports how many changed', () => {
    const store = new InMemorySessionStore();
    store.putLive(
      [
        view({ sessionId: 's1', status: 'done' }),
        view({ sessionId: 's2', status: 'waiting' }),
        view({ sessionId: 's3', status: 'working' }),
      ],
      T0,
    );
    expect(store.dismissAll()).toBe(3);
    expect(store.dismissAll()).toBe(0);
    // Every row is dismissed in the store; which of them that actually removes from the tray
    // surfaces is `isTrayWorthy`'s call, not the store's.
    expect(store.listLive().every((session) => session.dismissed && session.seen)).toBe(true);
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
        usage: { inputTokens: 2, cacheReadTokens: 100, cacheCreationTokens: 50, outputTokens: 9 },
        usageComplete: true,
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
        usage: null,
        usageComplete: false,
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

describe('orphan filter (§4: windowless sessions sharing a live one\'s folder)', () => {
  /** `getSnapshot()` never calls the adapter directly; only the constructor needs one. */
  const stubAdapter: AgentAdapter = {
    id: 'stub',
    discoverLiveSessions: async () => [],
    watchRoots: () => [],
    readStatus: async () => {
      throw new Error('not used');
    },
    indexHistory: async function* () {},
    readHistoryEntry: async () => null,
    readDetail: async () => {
      throw new Error('not used');
    },
    listIdeWindows: async () => [],
  };

  function engineWith(
    sessions: SessionView[],
    hasTerminalWindow?: (pid: number) => boolean | undefined,
    hideOrphanSessions = true,
  ): ControlEngine {
    const store = new InMemorySessionStore();
    store.putLive(sessions, T0);
    return new ControlEngine({
      adapter: stubAdapter,
      settings: { ...DEFAULT_SETTINGS, list: { ...DEFAULT_SETTINGS.list, hideOrphanSessions } },
      store,
      now: () => T0,
      hasTerminalWindow,
    });
  }

  const folderA = 'c:\\dev\\proj-a';
  const folderB = 'c:\\dev\\proj-b';

  it('drops the windowless session when another live session in the same folder has a window', () => {
    const windowless = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
    const windowed = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });
    const engine = engineWith([windowless, windowed], (pid) => pid === 2);
    expect(engine.getSnapshot().sessions.map((s) => s.sessionId)).toEqual(['w2']);
  });

  it('keeps both sessions when each has its own window, even in the same folder', () => {
    const a = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
    const b = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });
    const engine = engineWith([a, b], () => true);
    expect(engine.getSnapshot().sessions.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
  });

  it('keeps a lone windowless session — nothing else to be an orphan of', () => {
    const alone = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
    const engine = engineWith([alone], () => false);
    expect(engine.getSnapshot().sessions.map((s) => s.sessionId)).toEqual(['w1']);
  });

  it('drops nothing when no probe is wired up at all', () => {
    const windowless = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
    const windowed = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });
    const engine = engineWith([windowless, windowed], undefined);
    expect(engine.getSnapshot().sessions.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
  });

  it('drops nothing when the probe answers "not known yet" for either side', () => {
    const windowless = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
    const windowed = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });
    const unknownForBoth = engineWith([windowless, windowed], () => undefined);
    expect(unknownForBoth.getSnapshot().sessions.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);

    const unknownForOther = engineWith([windowless, windowed], (pid) => (pid === 1 ? false : undefined));
    expect(unknownForOther.getSnapshot().sessions.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
  });

  it('drops nothing when the setting is off, even with a decisive probe', () => {
    const windowless = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
    const windowed = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });
    const engine = engineWith([windowless, windowed], (pid) => pid === 2, false);
    expect(engine.getSnapshot().sessions.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
  });

  it('judges folders independently — two worktrees of one repo do not orphan each other', () => {
    const windowlessA = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
    const windowedB = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderB });
    const engine = engineWith([windowlessA, windowedB], (pid) => pid === 2);
    expect(engine.getSnapshot().sessions.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
  });

  describe('windowUnknown marker (story 012 D2)', () => {
    it('marks the session that survived only because the probe could not answer for it', () => {
      const unknown = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
      const windowed = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });
      const engine = engineWith([unknown, windowed], (pid) => (pid === 1 ? undefined : true));
      const sessions = engine.getSnapshot().sessions;
      // Shown on a guess: still there, but flagged.
      expect(sessions.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
      expect(sessions.find((s) => s.sessionId === 'w1')!.windowUnknown).toBe(true);
      // The mate got a decisive answer, so it is not a guess.
      expect(sessions.find((s) => s.sessionId === 'w2')!.windowUnknown).toBeFalsy();
    });

    it('still hides — and does not mark — a session the probe decisively calls windowless', () => {
      const windowless = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
      const windowed = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });
      const engine = engineWith([windowless, windowed], (pid) => pid === 2);
      const sessions = engine.getSnapshot().sessions;
      expect(sessions.map((s) => s.sessionId)).toEqual(['w2']);
      expect(sessions[0]!.windowUnknown).toBeFalsy();
    });

    it('raises no marker when the probe failed for the whole folder', () => {
      const a = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
      const b = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });
      const engine = engineWith([a, b], () => undefined);
      const sessions = engine.getSnapshot().sessions;
      // Nothing was ever at risk of being hidden, so there is nothing to warn about.
      expect(sessions.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
      expect(sessions.every((s) => !s.windowUnknown)).toBe(true);
    });

    it('raises no marker without a probe, or with the orphan filter switched off', () => {
      const unknown = view({ sessionId: 'w1', status: 'working', pid: 1, cwd: folderA });
      const windowed = view({ sessionId: 'w2', status: 'working', pid: 2, cwd: folderA });

      const noProbe = engineWith([unknown, windowed], undefined).getSnapshot().sessions;
      expect(noProbe.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
      expect(noProbe.every((s) => !s.windowUnknown)).toBe(true);

      // Same probe answers as the marking case, but with the filter off nothing could be
      // hidden, so the flag must stay away entirely.
      const filterOff = engineWith([unknown, windowed], (pid) => (pid === 1 ? undefined : true), false)
        .getSnapshot()
        .sessions;
      expect(filterOff.map((s) => s.sessionId).sort()).toEqual(['w1', 'w2']);
      expect(filterOff.every((s) => s.windowUnknown === undefined)).toBe(true);
    });
  });
});

describe('mute registry (§6.6, story 004 D4)', () => {
  const stubAdapter: AgentAdapter = {
    id: 'stub',
    discoverLiveSessions: async () => [],
    watchRoots: () => [],
    readStatus: async () => {
      throw new Error('not used');
    },
    indexHistory: async function* () {},
    readHistoryEntry: async () => null,
    readDetail: async () => {
      throw new Error('not used');
    },
    listIdeWindows: async () => [],
  };

  function engineWith(sessions: SessionView[]): ControlEngine {
    const store = new InMemorySessionStore();
    store.putLive(sessions, T0);
    return new ControlEngine({ adapter: stubAdapter, settings: DEFAULT_SETTINGS, store, now: () => T0 });
  }

  it('starts with nothing muted', () => {
    const engine = engineWith([view({ sessionId: 's1', status: 'working' })]);
    expect(engine.isMuted('s1')).toBe(false);
    expect(engine.getSnapshot().sessions[0]!.muted).toBe(false);
  });

  it('setMuted decorates the session in getSnapshot(), leaving status/statusSince/order untouched', () => {
    const engine = engineWith([
      view({ sessionId: 'a', status: 'waiting', statusSince: T0 - 1_000 }),
      view({ sessionId: 'b', status: 'working', statusSince: T0 - 2_000 }),
    ]);
    const before = engine.getSnapshot().sessions;
    const order = before.map((s) => s.sessionId);
    const statuses = before.map((s) => [s.status, s.statusSince]);

    engine.setMuted('b', true);
    expect(engine.isMuted('b')).toBe(true);

    const after = engine.getSnapshot().sessions;
    expect(after.map((s) => s.sessionId)).toEqual(order);
    expect(after.map((s) => [s.status, s.statusSince])).toEqual(statuses);
    expect(after.find((s) => s.sessionId === 'b')!.muted).toBe(true);
    expect(after.find((s) => s.sessionId === 'a')!.muted).toBe(false);
  });

  it('unmuting restores the unmuted view, and setMuted re-emits immediately like acknowledge()', () => {
    const engine = engineWith([view({ sessionId: 's1', status: 'done' })]);
    const emitted: boolean[] = [];
    engine.on('sessions', (snapshot) => {
      emitted.push(snapshot.sessions[0]!.muted);
    });

    engine.setMuted('s1', true);
    engine.setMuted('s1', false);
    expect(emitted).toEqual([true, false]);
    expect(engine.isMuted('s1')).toBe(false);
    expect(engine.getSnapshot().sessions[0]!.muted).toBe(false);
  });

  it('does not re-emit when setMuted has nothing to change', () => {
    const engine = engineWith([view({ sessionId: 's1', status: 'done' })]);
    let emits = 0;
    engine.on('sessions', () => {
      emits += 1;
    });
    engine.setMuted('s1', false); // already unmuted
    expect(emits).toBe(0);
  });

  it('clears the mute on a transition to ended, so a reappearing session id starts fresh', async () => {
    const facts: import('../../src/core/model/types.ts').TranscriptTailFacts = {
      last: null,
      pendingTool: null,
      pendingTools: [],
      stalledTools: [],
      queuedPrompt: false,
      branch: null,
      model: null,
      usage: null,
      aiTitle: null,
      lastPromptText: null,
      runStartedAt: null,
      lastAssistantText: null,
      subagents: [],
      subagentActivityAt: null,
      agentVersion: null,
      read: {
        fileSize: 0,
        mtimeMs: 0,
        windowBytes: 0,
        startOffset: 0,
        linesParsed: 0,
        linesSkipped: 0,
        exhausted: false,
        error: null,
      },
    };
    const ref: import('../../src/core/model/types.ts').LiveSessionRef = {
      sessionId: 's1',
      pid: 1,
      cwd: 'c:\\dev\\proj',
      name: 's1',
      entrypoint: 'claude-vscode',
      kind: 'cli',
      agentVersion: '2.1.222',
      startedAt: T0,
      procStart: null,
      transcriptPath: null,
      source: 'test',
      reportedStatus: null,
      waitingFor: null,
      reportedAt: null,
    };
    let refs = [ref];
    const adapter: AgentAdapter = {
      id: 'stub',
      discoverLiveSessions: async () => refs,
      watchRoots: () => [],
      readStatus: async (r) => ({
        sessionId: r.sessionId,
        ref: r,
        project: { path: 'c:\\dev\\proj', name: 'proj', key: 'c:/dev/proj' },
        alive: true,
        facts,
        readAt: T0,
      }),
      indexHistory: async function* () {},
      readHistoryEntry: async () => null,
      readDetail: async () => {
        throw new Error('not used');
      },
      listIdeWindows: async () => [],
    };

    const engine = new ControlEngine({
      adapter,
      settings: { ...DEFAULT_SETTINGS, indexHistoryOnStart: false },
      now: () => T0,
      createWatcher: () => ({ start: async () => {}, stop: async () => {} }),
    });

    await engine.start();
    engine.setMuted('s1', true);
    expect(engine.isMuted('s1')).toBe(true);

    refs = [];
    await engine.refreshNow();
    expect(engine.isMuted('s1')).toBe(false);

    await engine.stop();
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

describe('contextWindows setting (005)', () => {
  it('defaults useOnlineTable to false, so an empty file never triggers a fetch', () => {
    const merged = mergeSettings({});
    expect(merged.contextWindows.useOnlineTable).toBe(false);
  });

  it('round-trips an explicit true', () => {
    const merged = mergeSettings({ contextWindows: { useOnlineTable: true } });
    expect(merged.contextWindows.useOnlineTable).toBe(true);
  });

  it('falls back to false when the persisted value is garbage', () => {
    const merged = mergeSettings({ contextWindows: { useOnlineTable: 'yes' } });
    expect(merged.contextWindows.useOnlineTable).toBe(false);
  });
});
