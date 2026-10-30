---
id: 018
title: A hidden session says it is hidden
status: ready # draft -> ready -> in-progress -> done
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

### Update 2026-10-30 — there is a third filter, and it hid the most

`list.hideDoneOnStart` ([engine.ts:233](../../src/core/engine.ts)) removes every session that
was `done` when the app started, until something happens in it. Measured on a cold start:
12 live sessions, **9 hidden by this filter alone**, 3 on screen. It is invisible in exactly
the same way as the other two, and it was missed when this story was written.

It is also the filter that turns [020](020-claude-codes-own-status-outranks-the-transcript.md)'s
bug into a disappearance. Two of the nine were running sprints that the transcript misread as
`done`; a misread `done` on a running session is a wrong colour, a misread `done` at app start
is no row at all. And the app restarts itself now — [019](done/019-the-app-updates-itself.md)
applies an update on next launch — so every update hides every finished session, running
delegators included until 020 lands.

A side observation from the same measurement: two sessions `interrupted` three hours earlier
*were* shown, while sessions `done` at the same time were not. Whether `hideDoneOnStart`
should cover `interrupted` too is a question for this story, since it decides what the
"N hidden" count is a count of.

## Acceptance Criteria

- [ ] With a live session hidden by `hideUnusedSessions`, `hideOrphanSessions` or
      `hideDoneOnStart`, the main window shows that something is hidden and how many
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

<!-- S06: the product questions below were answered by the user — see Decisions (Sprint) -->

- **Count, or a way in?** The cheapest honest version is a number with a tooltip. The more useful
  one lets the user reveal the hidden rows for a moment (or jumps to the Settings toggle) without
  permanently turning the filter off. The second is more work and adds a UI state; decide before
  refine.
- **One number or three?** `hideUnusedSessions`, `hideOrphanSessions` and `hideDoneOnStart`
  remove different things for different reasons — an unused window is a non-event, an orphan is
  a process that may want killing, and a done-on-start session is finished work the user may
  well still want to read. Whether that distinction is worth separate counts or reads as noise
  is a product call.
- **(2026-10-30) Should a registry-`busy` session ever be hidden?** After 020 a running
  delegator is no longer `done`, so `hideDoneOnStart` cannot catch it — but say explicitly that
  no filter may hide a session Claude Code reports as `busy` or `waiting`.
- **(2026-10-30) `interrupted` on start.** See the update above: shown today, while `done` of
  the same age is hidden.
- **Where in the popover?** The header already carries session count, waiting count and the
  settled count. A fourth number in that line may be one too many — and the popover is the
  surface [010](done/010-popover-drilldown.md) already found over-subscribed.
- **Does the tray badge care?** The badge follows `traySessions`. A hidden session cannot be
  waiting on anything (an unused one has no turn, an orphan has no window to answer in), so
  presumably not — but state it rather than leaving it implied.

## Decisions (Sprint)

- **(User)** Hidden-sessions indicator: one number with a tooltip naming the causes; no reveal action, no per-filter counts. Still: no filter may hide a registry-`busy`/`waiting` session.
- The count is computed in the engine (`getSnapshot`) as `all live − shown`, plus the list of filters that removed at least one session — only the engine knows which filter fired, and the renderer stays derivation-free.
- A session matched by two filters counts once; `causes` lists every filter that removed something, in pipeline order (unused → doneOnStart → orphan) — the user asked for one number, and it must agree with "live − shown".
- The busy/waiting guard is keyed on the registry's word as 020 delivers it: `statusSource === 'reported'` with status `working`/`stale`/`queued`/`waiting` is exempt from all three filters — an *inferred* in-flight orphan stays hidden as 004 wanted (an abandoned process that died mid-tool looks exactly like that); only Claude Code's own `busy`/`waiting` is protected.
- `interrupted` stays outside `hideDoneOnStart` — an interrupted turn is unfinished work the user may want to resume, and widening a filter is out of scope for a story that makes filters visible; for that filter the count therefore counts `done` only.
- Popover: the number joins the existing header count as ` · N hidden`, after ` · N settled`, with its own tooltip — no new row on the surface 010 found over-subscribed, and a different word plus tooltip keeps it distinguishable from tray recency (AC2).
- Main window: a `· N hidden` hint right after the `Sessions (N)` tab, with the tooltip — the tab count is where the shortfall is read, so the explanation sits there.
- The tooltip names the filters by their Settings labels ("Hide unused sessions", "Hide sessions already done at start", "Hide abandoned sessions") and points to Settings › Session list — that is "leads to it" without the jump/reveal action the user ruled out.
- Tray badge, tray icon and tray menu are unaffected — with the guard a hidden session can never be registry-`waiting`, so the badge owes the user nothing for it.
- CLI is unchanged — the ACs name the main window and the popover only.
- With every filter off, or nothing removed, `hidden` is `{ count: 0, causes: [] }` and both surfaces render nothing (no "0 hidden", no empty span).
- No systems doc is updated — `docs/systems/` is empty in this repo.

## Plan

Built last of the live-list stories (after 020, 016, 021, 017). Core first, renderer second.

1. **Engine** (`src/core/engine.ts` `getSnapshot`): run the three filters as today but record
   which filters removed something. Exempt registry-reported in-flight sessions
   (`statusSource === 'reported'`, status `working|stale|queued|waiting`) from all three.
   Add `hidden: { count, causes }` to `EngineSnapshot` and `AppState`; `count = all − shown`.
2. **Renderer**: one pure helper `hiddenIndicator(hidden)` → `{ text, title } | null` in
   `src/renderer/lib/hiddenSessions.ts`; the main window's tab bar and the popover header both
   render through it. Popover: ` · N hidden` after ` · N settled`, separate tooltip.
3. CHANGELOG entry under `## Unreleased`.

No render harness (`e2e: none`, vitest without jsdom): user-facing ACs are proven one level
down — engine behaviour in `pipeline.test.ts` / `derivations.test.ts`, the helper plus a
source-level wiring check (pattern of `statusRollupWiring.test.ts`) in a new
`hiddenSessions.test.ts`. Gap named under Acceptance tests.

## Deliverables

- **D1 — The engine counts what its filters removed, and never hides Claude Code's own `busy`/`waiting`.**
  Files: `src/core/engine.ts` (`EngineSnapshot`, `getSnapshot`), `src/shared/ipc.ts` (`AppState`),
  `src/main/index.ts` (`emptyState`), `src/renderer/api.ts` (`EMPTY_STATE`), tests in
  `test/unit/pipeline.test.ts` and `test/unit/derivations.test.ts`.
  - Add `hidden: HiddenSessions` to `EngineSnapshot` and `AppState`:
    `export interface HiddenSessions { count: number; causes: HiddenCause[] }`,
    `export type HiddenCause = 'unused' | 'doneOnStart' | 'orphan'` — defined in
    `src/core/engine.ts` next to `EngineSnapshot`, re-exported through `src/shared/ipc.ts` the
    way the other core types are. Both empty-state defaults get `hidden: { count: 0, causes: [] }`.
  - In `getSnapshot`, keep the filter order and semantics (`hideUnusedSessions` drops
    `starting`; `hideDoneOnStart` drops `wasDoneOnStart`; `hideOrphanSessions` drops `isOrphan`
    judged against `unstarting`). Add one private predicate `isReportedInFlight(s)` =
    `s.statusSource === 'reported' && status ∈ {working, stale, queued, waiting}`; no filter
    removes a session for which it is true (the orphan rule still sees it as a folder mate).
    `causes` = each filter that removed ≥1 session, order unused → doneOnStart → orphan;
    `count = all.length − sessions.length` (each session once). Do not change `traySessions`,
    `trayState`, `attention`, `groups`, `windowUnknown` or history. `interrupted` is **not**
    added to `hideDoneOnStart`.
  - Tests — `test/unit/pipeline.test.ts`, extend the existing fixtures instead of new trees:
    in "hides a session that has never exchanged a message, unless asked not to" assert
    `hidden` = `{ count: 1, causes: ['unused'] }` while `sessions` is empty, and
    `{ count: 0, causes: [] }` with the filter off; in "hides a session that was already done
    at start until it does something new" the same with `['doneOnStart']`, `hidden.count` back
    to 0 once the new turn brings the row back, and `historyCount` / `listHistory()` equal with
    the filter on and off. `test/unit/derivations.test.ts`, inside the orphan-filter describe
    (reuse its `engineWith` / `view` helpers): new test "counts an orphan it hid as hidden"
    (`causes: ['orphan']`, count 1) and new test "never hides a session Claude Code reports
    busy or waiting" (windowless folder mate with `statusSource: 'reported'` and status
    `working`, and one with `waiting`, are shown and not counted; an inferred `working`
    orphan is still hidden). Existing tests stay green unchanged.

- **D2 — Main window and popover say "N hidden" and name the filter.**
  Files: new `src/renderer/lib/hiddenSessions.ts`, `src/renderer/App.tsx` (tab bar, ~line 62),
  `src/renderer/popover.tsx` (header `.count` span, ~line 830), new
  `test/unit/hiddenSessions.test.ts`, `CHANGELOG.md`.
  - `hiddenIndicator(hidden: HiddenSessions): { text: string; title: string } | null` (types
    from `src/shared/ipc.ts`, which carries `AppState.hidden: { count; causes: ('unused' |
    'doneOnStart' | 'orphan')[] }`) — `null` when `count === 0`; else `text` = `"N hidden"`;
    `title` = one sentence naming every cause by its Settings label, as named constants:
    `unused` → "Hide unused sessions", `doneOnStart` → "Hide sessions already done at start",
    `orphan` → "Hide abandoned sessions", ending "— change it in Settings › Session list."
  - `App.tsx`: right after the `Sessions (N)` tab button, render
    `<span className="meta" title={title}>· {text}</span>` when the helper is non-null.
  - `popover.tsx`: inside the header count, after the existing `· N settled`, render
    `<span title={title}> · {text}</span>` when non-null; the settled count and its tooltip
    stay exactly as they are. No new row, no click action.
  - Tests in `test/unit/hiddenSessions.test.ts`: "nothing hidden renders nothing" (count 0 →
    `null`); "the tooltip names every responsible filter by its Settings label" (single and
    multiple causes, "1 hidden" / "3 hidden" text); "the hidden tooltip names filters, never
    tray recency" (title does not contain "settled"). Source-level wiring block, mirroring
    `test/unit/statusRollupWiring.test.ts`'s path helpers: "the main window and the popover
    render the hidden count through hiddenIndicator" (both files import `hiddenIndicator` and
    pass `state.hidden`); "the popover keeps the settled count and adds the hidden count
    beside it" (popover source still has the `settled` expression and the `hiddenIndicator`
    call as a separate one).
  - CHANGELOG: one short user-facing line under `## Unreleased` (Features).

## Model Hints

- D1 → default. D2 → default.
- Review: → default

## Test Plan (manual acceptance)

### Acceptance tests

No render harness exists (`e2e: none`, vitest without jsdom): the user-facing criteria are
proven one level down — engine behaviour, a pure view helper and a source-level wiring check.
**Gap for the sprint review:** no test sees the rendered tab bar or popover header.

- AC1 → unit `test/unit/pipeline.test.ts` › "hides a session that has never exchanged a message, unless asked not to" + › "hides a session that was already done at start until it does something new" (both extended with `hidden`); unit `test/unit/derivations.test.ts` › "counts an orphan it hid as hidden"; display via unit `test/unit/hiddenSessions.test.ts` › "the main window and the popover render the hidden count through hiddenIndicator"
- AC2 → unit `test/unit/hiddenSessions.test.ts` › "the popover keeps the settled count and adds the hidden count beside it" + › "the hidden tooltip names filters, never tray recency"
- AC3 → unit `test/unit/hiddenSessions.test.ts` › "the tooltip names every responsible filter by its Settings label"
- AC4 → unit `test/unit/hiddenSessions.test.ts` › "nothing hidden renders nothing"; filter-off branch of the two extended `pipeline.test.ts` tests (`{ count: 0, causes: [] }`)
- AC5 → unit `test/unit/pipeline.test.ts` › the two extended tests (`sessions` stays empty while counted); unit `test/unit/derivations.test.ts` › "never hides a session Claude Code reports busy or waiting" (the user's binding guard)
- AC6 → unit `test/unit/pipeline.test.ts` › "hides a session that was already done at start until it does something new" (extended: `historyCount` / `listHistory()` equal with filter on and off)

## Done
