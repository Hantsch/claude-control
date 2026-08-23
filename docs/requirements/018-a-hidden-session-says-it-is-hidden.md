---
id: 018
title: A hidden session says it is hidden
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-23
---

## Requirement

Two filters remove live sessions from every surface, and neither leaves a trace. Counting the
sessions on the machine against the sessions in the app therefore does not add up, and there is
nothing on screen that explains the difference — the user's own conclusion on 2026-08-23 was
"session detection is flaky", which it was not.

Measured the same day: `~/.claude/sessions/` held 10 registry files, 9 of those PIDs were alive,
and the app listed 8. The missing one was a real Claude Code window, open since 10:21, that had
never been given a prompt — so it is `starting`, and `hideUnusedSessions` drops it
([engine.ts:213](../../src/core/engine.ts)). `hideOrphanSessions` drops a second class the same
way ([engine.ts:219](../../src/core/engine.ts)). Both defaults are on, both are the right
behaviour ([004](done/004-session-noise-control.md) argued for exactly this), and both are
invisible: the main window's tab reads `Sessions (8)` off the already-filtered list
([App.tsx:62](../../src/renderer/App.tsx)), and the popover's "· N settled" count is computed
against `state.sessions` ([popover.tsx](../../src/renderer/popover.tsx)), which is post-filter
too — so it reports the tray's own recency filter and nothing else.

The app already knows how to do this. Story [012](done/012-s02-residuals.md) decided that a
session shown *only because* the window probe could not answer must be marked as such
(`windowUnknown`), on the grounds that the user should be able to see when a filter's verdict is
a guess. This story asks for the other half of the same principle: when a filter removes
something, say that it did. `getLiveSessions()` already returns the unfiltered list, so the
number exists — nothing has to be re-derived.

What the user should get: whenever the app is showing fewer live sessions than exist, it says so,
and says which filter is responsible — enough to either trust the number or go turn the filter
off in Settings.

## Acceptance Criteria

- [ ] With a live session hidden by `hideUnusedSessions` or `hideOrphanSessions`, the main window
      shows that something is hidden and how many
- [ ] The same is true of the popover, and it is distinguishable from the "· N settled" count
      that is already there — a session held back by tray recency and a session removed by a
      filter are not the same thing
- [ ] The indication names the filter (or leads to it), so the user can act on it instead of
      only knowing that a number is short
- [ ] With both filters off, or with nothing hidden, no indication appears at all — this must not
      become permanent furniture
- [ ] The hidden sessions themselves stay hidden: this story surfaces a *count*, it does not
      re-list what 004 deliberately removed
- [ ] History is unaffected, as it already is — both filters are live-surface presentation only

## Open Questions

- **Count, or a way in?** The cheapest honest version is a number with a tooltip. The more useful
  one lets the user reveal the hidden rows for a moment (or jumps to the Settings toggle) without
  permanently turning the filter off. The second is more work and adds a UI state; decide before
  refine.
- **One number or two?** `hideUnusedSessions` and `hideOrphanSessions` remove different things
  for different reasons — an unused window is a non-event, an orphan is a process that may want
  killing. Whether that distinction is worth two counts or reads as noise is a product call.
- **Where in the popover?** The header already carries session count, waiting count and the
  settled count. A fourth number in that line may be one too many — and the popover is the
  surface [010](done/010-popover-drilldown.md) already found over-subscribed.
- **Does the tray badge care?** The badge follows `traySessions`. A hidden session cannot be
  waiting on anything (an unused one has no turn, an orphan has no window to answer in), so
  presumably not — but state it rather than leaving it implied.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
