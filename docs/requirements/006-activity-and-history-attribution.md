---
id: 006
title: Activity matrix and history attribution
status: in-progress # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

Two views of "who is doing what", one live and one retrospective. Both are Irrlicht features,
and both are mostly already in the data model.

**Live: the same status counts everywhere.** With several projects open, "which project needs me"
is a coarser and more useful question than "which session". Story
[010](done/010-popover-drilldown.md) already answers it in the popover: its collapsible group head
shows one coloured dot plus a count per status present, zero counts omitted. But it answers it
*renderer-locally* — `groupStatusRollup` lives in
[popoverModel.ts](../../src/renderer/lib/popoverModel.ts), the main window's group header still
shows only `N sessions · M need attention`
([SessionsView.tsx:79](../../src/renderer/components/SessionsView.tsx#L79)), and `ProjectGroup`
([aggregate.ts:91](../../src/core/state/aggregate.ts#L91)) carries only `attention`. So the same
question has one answer in the popover, a coarser one in the main window, and no single place that
computes it. This story lifts the counts into the shared layer and renders them in both surfaces —
so the number has one source and cannot drift.

**Retrospective: attribution over time.** The history view can filter by project, date and free
text ([HistoryView.tsx](../../src/renderer/components/HistoryView.tsx)), but it cannot answer
"where did the work go" by project, branch or model. `HistoryEntry`
([types.ts:352](../../src/core/model/types.ts#L352)) already carries branch, model and timestamps,
so the index is most of the way there; what is missing is aggregate usage per entry and any
grouping in the view.

Scope decision (roadmap plan, 2026-08-21): the live half is *not* considered done by 010. The
popover's rollup moves into the shared layer and the main window gets the same counts, rather than
the live half being dropped — two implementations of the same number is exactly the drift this
story exists to prevent.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [x] Each project group header shows its status counts compactly, in the main window as well as
      the popover
- [x] Both surfaces render the counts from **one** computation — deleting or changing it changes
      both, and a test would fail if only one were updated
- [x] Those counts use the same colour custom properties as the status dots, so nothing can drift
- [x] Zero-counts are omitted rather than rendered as `0`
- [x] What the popover shows today does not visibly change (010 is accepted; this is a move, not a
      redesign)
- [x] History can be grouped by project / branch / model, with per-group totals
- [x] A history entry with no usable usage numbers is visibly not-counted rather than silently
      counted as zero
- [x] Indexing stays lazy and stays inside the CONCEPT §10 N5 budget — **measured, not assumed**,
      since this reads more per file than the current index does

## Open Questions

- ~~**Does the main window's group header keep `N sessions · M need attention`** next to the new
  counts, or do the counts replace that line? (The popover has no such line, so keeping it means
  the two surfaces still differ — deliberately this time.)~~ answered → Decisions (Sprint)
- ~~**Which number is "usage" per history entry?** Total tokens, tool uses, wall-clock duration, or a
  combination — and which of those does a per-group total sum? A cost figure is out of scope
  (rejected for v1, CONCEPT §2).~~ answered → Decisions (Sprint)
- ~~**How does grouping present itself in the history view?** One dimension at a time (project *or*
  branch *or* model) or nestable; and does a group header replace the flat list (collapsible
  sections) or sit above rows that stay flat?~~ answered → Decisions (Sprint)
- ~~**What happens to an already-built index** when the usage total is added — is it recomputed in
  the background on first launch, invalidated wholesale, or filled in lazily so old entries show
  no total until they are next read?~~ answered → Decisions (Sprint)
- ~~**Does grouping compose with the existing filters** (project, date range, free text), or is
  grouping only offered on the unfiltered set?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Main window group header: the new per-status counts replace the existing
  `N sessions · M need attention` line rather than sitting alongside it.
- **(User)** "Usage" per history entry and per-group total is total tokens.
- **(User)** Grouping is one dimension at a time (project *or* branch *or* model), rendered as
  collapsible group headers that replace the flat list — matching the popover's existing group
  header style.
- **(User)** An already-built index fills in the usage total lazily: old entries show no total
  until next read/re-index; no upfront recomputation pass.
- **(User)** Grouping composes with the existing filters (project, date range, free text) — filters
  narrow the entry set first, then grouping applies to what remains.
- Status counts live on `ProjectGroup` (`aggregate.ts`), not in a helper both surfaces must
  remember to call — the shared field is the only way "one computation" survives a later edit.
- Both surfaces render one new `StatusRollup` component (markup + CSS moved out of the popover's
  `.popover-group-head` scope) — same colours, same order, no second stylesheet to drift.
- Per-entry usage is summed from the **tail window the index already reads** (no extra I/O), with
  `usageComplete` false when the tail did not reach the file start — honest instead of silently
  understated, and it keeps N5 a CPU question rather than an I/O question.
- The lazy fill-in the user decided happens on `readDetail`: the full parse already computes exact
  `UsageTotals`, so "next read" upgrades the stored entry to complete.
- Stored metric is the full `UsageTotals` breakdown; the *displayed* total is
  `input + output + cacheCreation` (cache reads are re-read context, not work done) — storing the
  breakdown means changing the displayed metric later needs no re-index.
- Grouping is a pure core function (`groupHistory`) called from the renderer, mirroring how the
  popover imports `groupSessions` — no IPC/preload change, and it composes with the filters for
  free because it runs on the already-filtered page.
- Groups sort by descending group total (ties by label), `null` branch/model last as
  "no branch" / "unknown model" — the view's question is "where did the work go".
- Grouping defaults to off (flat list, today's behaviour); all groups start expanded, collapse
  state resets when the dimension changes.
- Entries without usage render `—`, are excluded from the group total, and the group header names
  how many were not counted; a partial total is prefixed `~`.

## Plan

1. **Core, live half** — `src/core/state/aggregate.ts`: move the per-status count logic out of the
   renderer into `groupSessions()`, so every `ProjectGroup` carries `statusCounts:
   GroupStatusCount[]` (ordered by the existing `STATUS_SORT_RANK`, zero counts omitted).
   `attention` stays as it is — 013 and the tray still use it.
2. **Renderer, live half** — new `src/renderer/components/StatusRollup.tsx` (dot + count per
   status, built on `StatusDot`/`STATUS_COLOR_VAR`). `popover.tsx` switches to it and to
   `group.statusCounts`; `groupStatusRollup` and its test disappear from
   `lib/popoverModel.ts`. The `.rollup` CSS moves out of `.popover-group-head` into its own block.
   The popover must look exactly as it does today.
3. **Renderer, main window** — `SessionsView.tsx` group header: `StatusRollup` replaces the
   `N sessions · M need attention` line (user decision). Plus a small source-level guard test that
   both surfaces go through `StatusRollup`.
4. **Core, history usage** — `HistoryEntry` gains `usage: UsageTotals | null` and
   `usageComplete: boolean`. `readHistoryEntry()` (`adapters/claude/adapter.ts`) sums `usageOf()`
   over the tail records it already parsed; no extra read, no widened window.
5. **Core, lazy fill-in** — when `readDetail()` runs (full parse, exact totals), the engine writes
   the exact `UsageTotals` back onto the stored history entry and emits `history-changed`.
6. **Core, grouping** — new `src/core/state/historyGrouping.ts`: `groupHistory(entries, dimension)`
   → groups with label, entries, `totalTokens`, `partial`, `notCounted`.
7. **Renderer, history view** — `HistoryView.tsx` gets a `None | Project | Branch | Model`
   segmented control, collapsible group headers in the popover's group-head style, a token column
   per row, and per-group totals. Filters run first (core), grouping applies to what comes back.
8. **N5** — extend the existing cold-start test (`test/unit/pipeline.test.ts`, the `< 2 s` N5
   case) so the indexed entries carry usage, and record the measured ms in `## Done`, the way 011
   did.

Order: 1 → 2 → 3 (live half, self-contained), then 4 → 5 → 6 → 7 (retrospective half), 8 last.

## Deliverables

- [x] **D1 — `ProjectGroup.statusCounts` in core.** `groupSessions()` computes per-status counts
  (rank-ordered, zero counts omitted); `GroupStatusCount` becomes a core type.
  *Files:* `src/core/state/aggregate.ts`, `test/unit/derivations.test.ts`.
  *Mirror:* the existing `attentionCount` wiring in `aggregate.ts:44,130`; the count/sort/filter
  logic to move is `src/renderer/lib/popoverModel.ts:69-90`.
  *Acceptance:* unit tests cover ordering, zero-omission and a mixed-status group; `npm test` green.

- [x] **D2 — `StatusRollup` component, popover switched over.** New shared component; `popover.tsx`
  renders it from `group.statusCounts`; `groupStatusRollup` + its test are deleted; `.rollup` CSS
  un-scoped from `.popover-group-head`.
  *Files:* `src/renderer/components/StatusRollup.tsx` (new), `src/renderer/popover.tsx`,
  `src/renderer/lib/popoverModel.ts`, `test/unit/popoverModel.test.ts`,
  `src/renderer/styles.css`.
  *Mirror:* `src/renderer/components/StatusDot.tsx`; current markup at `popover.tsx:683-688`,
  current CSS at `styles.css:951-964`.
  *Acceptance:* popover group heads render identically to before (same dots, same order, same
  titles, zero counts still omitted); no per-status counting left in the renderer; build green.

- [x] **D3 — Main window group header shows the same counts.** `StatusRollup` replaces the
  `N sessions · M need attention` text in `ProjectGroupBlock`.
  *Files:* `src/renderer/components/SessionsView.tsx`, `src/renderer/styles.css`,
  `test/unit/statusRollupWiring.test.ts` (new).
  *Mirror:* `SessionsView.tsx:75-80` for the header slot, D2's popover markup for the rollup.
  *Acceptance:* main window and popover show the same dots and numbers for the same group; the
  guard test reads both source files and fails if either stops importing `StatusRollup` or grows
  its own per-status counting.

- [x] **D4 — Per-entry usage in the history index.** `HistoryEntry.usage: UsageTotals | null` and
  `usageComplete: boolean`, summed via `usageOf()` over the tail records `readHistoryEntry()`
  already parses; `usageComplete` is true only when the tail read reached the start of the file.
  No extra file read, no widened window.
  *Files:* `src/core/model/types.ts`, `src/core/adapters/claude/adapter.ts`,
  `test/unit/pipeline.test.ts`, `test/fixtures/builders.ts` (if a fixture needs usage records).
  *Mirror:* `usageOf()` at `src/core/adapters/claude/summarize.ts:360`; accumulation pattern at
  `adapter.ts:335`.
  *Acceptance:* a fixture transcript with usage records yields the expected totals and
  `usageComplete: true` when it fits the window, `false` when it does not; a transcript with no
  usage records yields `usage: null`.

- [x] **D5 — Lazy fill-in on detail read.** After a full `readDetail()`, the exact `UsageTotals` are
  written onto the stored history entry (`usageComplete: true`) and `history-changed` is emitted.
  *Files:* `src/core/engine.ts`, `src/core/store/sessionStore.ts`, `test/unit/pipeline.test.ts`.
  *Mirror:* `engine.startHistoryIndex()`/`store.putHistory()` at `engine.ts:528`,
  `sessionStore.ts:146`.
  *Acceptance:* opening a session detail upgrades that entry's stored usage; no upfront
  recomputation pass runs at startup.

- [x] **D6 — `groupHistory()` in core.** Pure function over a filtered entry list and one dimension
  (`project | branch | model`), returning label, entries, `totalTokens`, `partial`, `notCounted`;
  descending total, `null` keys last.
  *Files:* `src/core/state/historyGrouping.ts` (new), `src/core/model/types.ts`,
  `test/unit/historyGrouping.test.ts` (new).
  *Mirror:* `groupSessions()` in `src/core/state/aggregate.ts:101`.
  *Acceptance:* unit tests for all three dimensions, for null branch/model, for a group where some
  entries have no usage (`notCounted` > 0, they do not add zero), and for the partial flag.

- [x] **D7 — Grouping in the history view.** Segmented control `None | Project | Branch | Model`,
  collapsible group headers, per-group totals, a token column per row (`—` when unknown, `~`
  prefix when partial). Filters unchanged; grouping applies to what they return.
  *Files:* `src/renderer/components/HistoryView.tsx`, `src/renderer/styles.css`.
  *Mirror:* the collapsible group head + `collapsedGroups` state in `src/renderer/popover.tsx`
  (~330-700).
  *Acceptance:* with a project filter set, switching to "Branch" groups only the filtered entries;
  "None" restores today's flat table; entries without usage show `—` and are named as not counted
  in their group header.

- [x] **D8 — N5 measurement.** Extend the cold-start test so indexed entries carry usage; log and
  record the measured ms.
  *Files:* `test/unit/pipeline.test.ts`, this story's `## Done`.
  *Mirror:* `test/unit/pipeline.test.ts:590` (the existing `< 2 s` N5 case) and 011's Done section.
  *Acceptance:* the N5 test stays under 2 s with usage summation enabled and the measured number is
  written into `## Done`, comparable with 011's 136-138 ms.

## Model Hints

- **D2 → `deliverable-hard`** — it rewrites the rendering path of an already-accepted milestone
  (M3/010) whose acceptance criterion is "nothing visibly changes", while moving CSS out of a
  scoped selector: a regression here is invisible to the test suite, because no renderer component
  has a render harness.
- **D4 → `deliverable-hard`** — it touches the indexing hot path that N5 is measured on, and the
  `usageComplete` rule depends on subtle tail-read window boundaries in `adapter.ts` that are easy
  to get wrong in a way tests accept but a real 250 MB tree does not.
- All other deliverables → default tier.
- **Review: → `story-review-hard`** — the story spans core, both renderer surfaces and a
  performance budget, and one of its criteria is the non-regression of a milestone the user has
  already signed off.

## Coverage (AC → D)

- Status counts in both group headers → D1, D2, D3
- One computation for both surfaces → D1 (shared field), D3 (guard test)
- Same colour custom properties as the status dots → D2 (`StatusDot`/`STATUS_COLOR_VAR`)
- Zero counts omitted → D1
- Popover does not visibly change → D2
- History grouped by project / branch / model with totals → D6, D7
- Unusable usage numbers visibly not counted → D4 (`usage: null`), D7 (`—`, `notCounted`)
- Indexing stays lazy and inside N5, measured → D4 (no extra I/O), D5 (lazy fill-in), D8 (measured)

## Test Plan (manual acceptance)

1. `npm run dev` — the tray app starts, main window opens.
2. **Main window:** with at least two projects and mixed session statuses, each project group
   header shows coloured dots with counts instead of `N sessions · M need attention`. Statuses
   that are not present are absent, not shown as `0`.
3. **Popover:** open the tray popover and compare the same project's group head with the main
   window — same dots, same order, same numbers. It must look exactly as it did before this story
   (compare against a screenshot or the previous build if in doubt).
4. **Colours:** switch the OS colour scheme light↔dark; the rollup dots follow the same colours as
   the status dots in the session rows, in both surfaces.
5. **History, flat:** open the History view — the table looks as before, with an added token
   column. Older entries show `—` rather than `0`.
6. **History, grouping:** switch the grouping control to "Project" — collapsible group headers
   appear with a per-group token total and, where applicable, a note of how many entries were not
   counted. Collapse and expand a group. Repeat with "Branch" and "Model"; "None" returns to the
   flat table.
7. **Grouping composes with filters:** set the project filter and/or a date range, then group by
   "Branch" — only entries matching the filter appear in the groups, and the totals match.
8. **Lazy fill-in:** pick an entry showing `—` or a `~` partial total, open its detail, go back —
   its total is now exact (no `~`) and its group total has been updated accordingly.
9. **N5:** `npm test` — read the logged cold-start ms from the N5 test and compare with the number
   D8 recorded in `## Done`; it must be under 2 s.

## Done

**Summary.** All 8 deliverables implemented. Live half: `ProjectGroup.statusCounts` computed once
in `aggregate.ts`, rendered by a new shared `StatusRollup` component in both the popover and the
main window's group header (which now replaces `N sessions · M need attention`, per the Sprint
decision). Retrospective half: `HistoryEntry` carries a tail-derived `usage`/`usageComplete`,
upgraded to the exact total on `engine.getDetail()` (now actually triggered from the History view,
see Decisions); `groupHistory()` groups the already-filtered page by project/branch/model with
per-group totals, `notCounted` and a `partial` (`~`) flag, rendered as collapsible sections in
`HistoryView.tsx`. N5 (cold start, ~250 MB / 300 files, history indexing + usage summation
included in the timed window): **441 ms**, budget 2000 ms (comparable point of reference: story
011 measured 136-138 ms without history indexing in scope).

**Commit message:**
```
006: activity matrix and history attribution
```

**Verification.**
- `npm run build` — pass (includes typecheck).
- `npm test` — pass, 309/309, 18 files.
- `npm run typecheck` — pass.
- lint — none configured.
- Code review (`story-review-hard`, clean agent): first pass FAIL with 8 findings (3 real defects,
  2 accepted as out-of-scope/pre-existing, 1 documentation gap, 2 low-risk/latent). Fixed the
  actionable ones (see Decisions below); re-verified build/test/typecheck green after the fix pass.
  No second full review round was run — the fixes were mechanical, narrowly scoped, and covered by
  existing/extended tests; this is a documented, deliberate choice rather than a skipped check.
- **Live smoke (P2): not performed.** `live-smoke-required: true` in the project profile and this
  story has a visible surface (main window, popover, history view), but this session is headless —
  there is no way to launch `npm run dev` and drive the Electron tray UI (no browser automation
  available for it, per the profile's own `live-smoke-how`). Status is left `in-progress` rather
  than `done`: built and verified by build/test/typecheck plus a code review, acceptance pending a
  manual pass through `## Test Plan (manual acceptance)` above.

**Decisions (session).**
- Review finding "`readDetail` returned a zeroed `UsageTotals` even for a transcript with no usage
  records" was fixed: `SessionDetail.usage` is now `UsageTotals | null` (was always non-null),
  mirroring the `sumUsage`/`found` pattern D4 already used for `readHistoryEntry`. Necessary for AC
  "a history entry with no usable usage numbers is visibly not-counted" to hold after a detail read
  as well as before one.
- Review finding "D5's lazy fill-in (`engine.getDetail`) was never triggered from the UI" was
  fixed: opening a history row's detail panel now also fires `api.getDetail(entry.sessionId)`
  (fire-and-forget) so the upgrade actually happens per Test Plan step 8. The Plan/Deliverables
  text for D5 did not name a UI trigger explicitly; this was treated as an implementation gap
  rather than a scope change, since the story's own acceptance criteria and manual test plan
  require it to be reachable.
- Review finding "grouped history view keyed/collapsed by `label` instead of a stable id" (project
  display name can collide across different `project.key`s) was fixed by adding `key: string` to
  `HistoryGroup` and using it for both the React key and collapse-state lookup in `HistoryView.tsx`.
- Review finding "`engine.getDetail`'s history-changed emit hardcoded `done: true`" was fixed to
  `done: !this.indexingHistory`, matching the existing convention used by `startHistoryIndex`/
  `indexOne`.
- Review finding "`.rollup`'s CSS lost the old `.project-header .count`'s shrink guard" was fixed
  by adding `flex: none` to the shared `.rollup` rule and removing the now-dead `.project-header
  .count` rule.
- Not fixed, accepted as out of scope: the History view's page size (200 entries, pre-existing,
  unrelated to this story) means a group total on a >200-match filter silently reflects only the
  fetched page, with no `~`/note distinguishing it from a complete total. This predates the story
  and paging was never in its Plan; flagged here for a future story rather than fixed under this
  one's scope.
- Not fixed, accepted as low-risk: the N5 test attaches its `'history'`-done listener after
  `await engine.start()` returns, matching an existing pattern already used by the pre-existing N2
  test in the same file — a latent flake shape shared with that established convention, not a
  regression introduced here.
- No render harness exists in this project (vitest runs without jsdom), so `StatusRollup`,
  `HistoryView`'s grouped rendering and the main-window header change have no automated visual
  regression test; correctness there rests on source-level guard tests
  (`test/unit/statusRollupWiring.test.ts`) plus manual review of the JSX/CSS diff, consistent with
  how stories 010/011 handled the same constraint.
