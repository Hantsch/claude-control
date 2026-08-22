---
id: 015
title: S04 residuals — a total that admits its page, and a test that cannot miss its event
status: in-progress # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

The two points [S04's review](../sprints/done/S04/review.md) recorded as "accepted as out of
scope, not fixed" — bundled the way [012](done/012-s02-residuals.md) and
[013](done/013-s03-residuals.md) bundled the sprints before them, because separately neither is
worth a sprint slot and carrying them forward is how they get forgotten.

**A — a group total that only covers the page it was given.** Story
[006](done/006-activity-and-history-attribution.md) added per-group usage totals to the history
view, and the view fetches a fixed 200-entry page. So a filter matching more than 200 entries
produces group totals that silently describe the first 200 and nothing marks them as partial. The
`~` prefix 006 introduced does not cover this: it means "some entries in this group had no usable
usage numbers", not "there are more entries than were counted". A user reading "where did my week
go" off a busy filter gets a number that is confidently wrong in the one direction that matters —
too low — and has no way to see it. The page size predates 006 and paging was never in its plan,
which is why the review left it; it is still a number the app should not print unqualified.

**B — a test that can miss the event it waits for.** The N5 cold-start test in
[pipeline.test.ts](../../test/unit/pipeline.test.ts) attaches its listener *after*
`await engine.start()` has resolved, so an event emitted during start is missed and the test
hangs to its timeout instead of failing fast. It has not flaked yet; the same shape already
exists in an N2 test in the same file. Nothing user-facing — this is the measurement the N5
budget rests on, and a latent flake in it costs a sprint's afternoon at the worst moment.

## Acceptance Criteria

- [x] When a filter matches more history entries than the view fetched, the view says so — the
      user can see that they are looking at part of the result, not all of it
- [x] A group total computed over a truncated result is visibly marked as partial, and that
      marker is not confusable with 006's existing "some entries had no usage" marker
- [x] A total that *is* complete stays unmarked — the marker has to mean something
- [x] Grouping, filtering and the marker still agree with each other after a filter change
- [x] The N5 and N2 timing tests observe every event their measurement depends on, regardless of
      when it is emitted, and fail fast rather than timing out when the event never comes
- [x] `npm test` stays green and the N5 measurement still reports a number against its 2000 ms
      budget

## Open Questions

- ~~**Honest marker, or real paging?**~~ answered → Decisions (Sprint)
- ~~**If a marker: is the page size still 200?**~~ answered → Decisions (Sprint)
- ~~**Where does the marker live?**~~ answered → Decisions (Sprint)
- ~~**Does the CLI show the same qualification?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Marker + count now, not real paging: ship the honest "showing 200 of 438"-style
  marker as this story's deliverable; real paging/"load more" is a separate, larger story for
  later.
- **(User)** Page size stays at 200 — no raise, no cap removal when filtered; the marker carries
  the honesty, the N5 read-time budget stays as-is.
- **(User)** Marker location: on each group's total, as a new symbol distinct from 006's `~` (not
  a header-level note).
- **(User)** CLI: `npm run cli` shows the same truncated-total qualification as the GUI history
  view.
- Marker symbol is `≥`, placed as a prefix on the group total (`≥ 1.2M tokens`) — it states
  exactly what a truncated sum is (a lower bound) and is visually and semantically distinct from
  006's `~`; both can appear together as `≥~` when a group is truncated *and* has inexact usage.
- Truncation marks **every** group, not a selected one — the unfetched entries could belong to any
  group, so no group's total can be claimed complete once the page is truncated.
- Truncation is detected as `page.total > page.entries.length` (`HistoryPage.total` already carries
  the pre-limit count of matches) — no new IPC field, no store change, no extra query.
- The `truncated` flag becomes a field of `HistoryGroup`, set by `groupHistory()` from an explicit
  argument — grouping stays the single place that decides what a group total means, and it stays
  unit-testable without a renderer.
- Marker symbol and the "Showing 200 of 438 sessions" wording live in `src/shared/presentation.ts`
  as one constant/formatter used by GUI and CLI — the user decision that both surfaces show the
  same qualification is then true by construction, not by two copies staying in sync.
- The count line also shows in the ungrouped ("None") flat table — AC 1 is about the view, not only
  about group totals, and a flat 200-of-438 list is just as silently partial.
- CLI shows the count line only, not group totals with `≥`: the CLI has no grouping feature at all
  today (it prints a flat list), so "the same qualification" means the same truncation statement in
  the surface the CLI actually has — inventing CLI grouping would be a different story.
- Marker gets a `title` and an `aria-label` on the total; 006's `~` has neither, so the same
  explanatory text names both symbols and closes that gap for `~` in passing (013's ARIA line).
- The timing tests get one shared local helper in `pipeline.test.ts` (listener attached *before*
  `start()`, rejecting with a named error after a timeout well below vitest's), applied to every
  site in the file with the same attach-after-start shape — not just N5 and N2 — since a helper
  that leaves siblings broken invites the next copy-paste.
- The N5 measurement keeps bracketing `start()` **plus** history indexing: only the listener moves
  before `start()`; `started = Date.now()` and the 2000 ms assertion stay exactly where they are.

## Plan

**Part A — truncated group totals (D1-D3)**

1. `src/shared/presentation.ts`: add `TRUNCATED_TOTAL_MARKER = '≥'`, `formatShownOf(shown, total)`
   ("Showing 200 of 438 sessions" / null when nothing is truncated) and the explanatory text used
   for the marker tooltip. Mirror the existing `HISTORY_FINAL_LABEL` export style.
2. `src/core/state/historyGrouping.ts`: `HistoryGroup.truncated: boolean`; third parameter
   `options?: { truncated?: boolean }` on `groupHistory()`, defaulting to `false` so existing call
   sites and tests stay valid. Only the flag is added — no change to sum, sort or `partial`.
3. `src/renderer/components/HistoryView.tsx`: pass `{ truncated: page.total > page.entries.length }`
   into `groupHistory`; render `≥` before 006's `~` in the group total, with `title`/`aria-label`;
   render the count line above the table/group list in both grouped and flat mode.
   `src/renderer/styles.css`: style the marker and the count line next to `.history-group-head`.
4. `src/cli/index.ts`: `printHistory` takes the pre-limit `total` and prints the same
   `formatShownOf` line; JSON mode carries `historyTotal` + `historyShown` alongside `history`.

**Part B — timing tests (D4)**

5. `test/unit/pipeline.test.ts`: local helper `historyDone(engine, timeoutMs)` that subscribes
   *before* `engine.start()` and rejects with an explicit message on timeout; rewrite N5 (~line 810),
   N2 (~line 922) and the other attach-after-start sites (~372, and any further `await
   engine.start()` immediately followed by `engine.on('history', ...)`) to `const done =
   historyDone(engine); await engine.start(); await done;`.

Order: D1 -> D2 -> D3 (D2/D3 both depend on D1's exports), D4 independent of all of them.

## Deliverables

**D1 — the truncated flag and the shared wording** [x]
- `src/shared/presentation.ts`: `TRUNCATED_TOTAL_MARKER`, `formatShownOf(shown, total): string | null`,
  marker explanation text (mirror `HISTORY_FINAL_LABEL`).
- `src/core/state/historyGrouping.ts`: `HistoryGroup.truncated` + optional `options` argument.
- Tests: `test/unit/historyGrouping.test.ts` (truncated true/false, defaults to false when the
  argument is omitted, orthogonal to `partial`), `test/unit/presentation.test.ts`
  (`formatShownOf` returns null when `shown === total`, the sentence when it is smaller).
- Acceptance: `npm test` + `npm run typecheck` green; no renderer touched.

**D2 — the history view says what it is showing** [x]
- `src/renderer/components/HistoryView.tsx`, `src/renderer/styles.css`.
- Count line rendered in grouped *and* flat mode; `≥` on every group total when the page is
  truncated, `~` unchanged, both explained in one `title`/`aria-label`; nothing shown when
  `page.total === page.entries.length`. `PAGE_SIZE` stays 200.
- Acceptance: build + typecheck green; behaviour verified live per Test Plan.

**D3 — the CLI qualifies its list the same way** [x]
- `src/cli/index.ts` (`printHistory` signature + JSON payload), optionally `src/cli/format.ts`.
- Text mode prints the `formatShownOf` line from D1 (not its own wording); JSON mode exposes the
  pre-limit total. Mirror `printHistory`'s existing header line style.
- Acceptance: `npm run cli -- --history` shows the line when the store holds more entries than the
  40-row text limit and shows no line when it does not.

**D4 — timing tests that cannot miss their event** [x]
- `test/unit/pipeline.test.ts` only.
- `historyDone()` helper; N5, N2 and every other attach-after-start site converted; a never-emitted
  event fails with a readable message instead of running into the 180 s timeout.
- Acceptance: `npm test` green, `[N5] cold start ...ms` still printed and still under 2000 ms; the
  N5 elapsed window is unchanged (still start -> history done).

## Model Hints

- `D4 → deliverable-hard` — the N5 budget is the one number the sprint reports; moving the
  subscription across `await engine.start()` can silently shrink or widen the measured window, or
  make the test pass vacuously, and that regression is invisible in a green run.
- D1, D2, D3 → default.
- `Review: → default` — bounded diff across four small files, every acceptance criterion is
  mechanically checkable against the diff.

## Test Plan (manual acceptance)

1. `npm run dev`, open the main window, go to **History**. Ensure the index has finished.
2. With no filter (or a broad one) that matches more than 200 sessions: the view shows
   "Showing 200 of N sessions". Switch **Group by** to *Project*: every group total is prefixed
   `≥`; hovering a total explains `≥` and `~`.
3. Narrow the filter (a single project or a short date range) until fewer than 200 sessions match:
   the count line disappears and no total carries `≥` any more; groups that had `~` keep it.
4. Switch **Group by** back and forth between *None*, *Project*, *Branch*, *Model* while the
   filter is truncated: the count line stays, the markers stay, and the sessions in the groups add
   up to the shown 200.
5. `npm run cli -- --history`: the printed history block carries the same "Showing X of N sessions"
   line when truncated, and no such line when everything matched fits.

## Done

**Summary.** Part A (D1-D3): `formatShownOf()` and the `≥` marker/explanation now live in
`src/shared/presentation.ts`; `groupHistory()` carries a `truncated` flag per group
(`src/core/state/historyGrouping.ts`); the GUI history view (`HistoryView.tsx`) shows a "Showing
X of Y sessions" line in both flat and grouped mode and prefixes truncated group totals with `≥`
(next to 006's `~`, both explained by one tooltip); the CLI (`src/cli/index.ts`) prints the same
line in text mode and exposes `historyShown`/`historyTotal` in JSON mode. Part B (D4): a shared
`historyDone()` helper in `test/unit/pipeline.test.ts` now subscribes to the engine's `'history'`
event *before* `engine.start()` at all three former attach-after-start sites (D5's usage-upgrade
test, N5, N2), rejecting with a readable message on a 10s internal timeout instead of running
into the suite's timeout.

**Decisions (implementation).**
- D4's fix (subscribing before `start()`) exposed a genuine pre-existing race in
  `src/core/engine.ts`: `start()` ran the initial `refresh('start')` before
  `startHistoryIndex()` set `this.indexingHistory = true`, so a session that transitioned to
  `ended` during that initial refresh could make `indexOne()` emit a spurious `'history'` event
  with `done: true` (since `indexingHistory` was still `false`) before the real background index
  had even begun. The old, buggy test code never saw this because it attached its listener too
  late to catch it; fixing the test attachment order (as D4's plan required) made the race
  observable as an intermittent N5 failure (confirmed ~3/13 runs under full-suite load by the
  first review pass). Fix: `start()` now sets `this.indexingHistory = this.settings.indexHistoryOnStart`
  synchronously before the initial refresh, so `indexOne()` reports `done: false` correctly during
  that window. This is a one-line, behavior-preserving change outside D4's originally scoped
  files (`src/core/engine.ts` rather than `test/unit/pipeline.test.ts` alone) — treated as a
  review-fix rather than a new deliverable, since AC 5/6 ("`npm test` stays green") already
  required it and the plan simply hadn't anticipated this specific hazard.
- CLI truncation surface is the count line only (no group totals with `≥`), per the story's own
  Decisions (Sprint) — the CLI has no grouping feature to attach a per-group marker to.

**Verification.**
- `npm run build` — green (typecheck + electron-vite build for main/preload/renderer).
- `npm test` — green, 371/371 tests across 21 files; re-run 3+ times after the engine.ts fix with
  no flake (previously ~3/13 runs failed on the N5 test before the fix).
- `npm run typecheck` — green.
- Live-checked `npm run cli -- --history` against the real data directory: prints
  `Showing 40 of 315 sessions` (the store holds far more history than the CLI's 40-row text
  limit), confirming D3's live behaviour.
- Code review: first pass FAILED on a real regression (the engine.ts race above, found via
  repeated full-suite runs); fix applied; second review pass PASSED — all 6 acceptance criteria
  verified PASS with file:line evidence, no scope creep, no weakened tests, `npm test` 3/3 green.
- **Open point — live GUI smoke pending.** `live-smoke-required: true` and this story has a
  visible GUI surface (`HistoryView.tsx`), but no browser/UI automation is available for the
  Electron tray app in this environment (per `.claude/ai-scrum.md`'s `live-smoke-how`). The CLI
  half of the truncation surface (D3) was live-verified above; the GUI half (D2 — the "Showing X
  of Y sessions" line and the `≥` marker in the History view) still needs the manual walk-through
  in `## Test Plan (manual acceptance)` above, run by a human against `npm run dev`. Status is
  left `in-progress` pending that manual acceptance, per project policy (P2).

**Commit message.**
```
015: truncated history totals (GUI + CLI) and race-proof N5/N2 timing tests
```
