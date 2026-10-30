---
id: 017
title: The popover row says which project it is
status: done # draft -> ready -> in-progress -> done
created: 2026-08-23
---

## Requirement

The popover is the glance surface: it has to answer "which session needs me, and what for"
without a click ([010](done/010-popover-drilldown.md)). It currently answers the second half
and can drop the first. A row identifies its session by branch alone —
`session.branch ? session.branch : session.project.name`
([popover.tsx:924](../../src/renderer/popover.tsx)) — and the project name lives only in the
group head, which is rendered `groups.length > 1`
([popover.tsx:828](../../src/renderer/popover.tsx)).

So with one project live, the project name appears nowhere at all. Observed on 2026-08-23: a
single row reading `sprint/09`, with no way to tell it apart from the `sprint/S08` running in
another repo at the same moment — and branch names of that shape are what this project's own way
of working produces, one per sprint, in every repo. With several projects live the name is
present but positional: it belongs to a header that may have scrolled away, and the row itself
still carries nothing.

The tray menu already does this right —
`<label> — <status> · <project> · <branch>` ([tray.ts:114](../../src/main/tray.ts)) — so the
popover is the outlier among the surfaces, not the standard.

What the user should get: reading one popover row tells them which project it belongs to,
whether one project is live or five.

## Acceptance Criteria

- [x] With exactly one project group live, the popover names the project
- [x] A row identifies its project without depending on a group head being visible on screen
- [x] Two sessions on identically-named branches in different projects are distinguishable at a
      glance
- [x] Nothing else on line 1 loses its space: the context bar, the token figure, the model, the
      mute bell and the expand affordance keep working at the popover's width, and the two-line
      row layout 010 settled on is not turned back into an eight-column row
- [x] A session with no branch recorded shows the project once, not twice
- [x] The main window and the tray menu are unchanged — both already name the project

## Open Questions

- **Where does the name go?** Two candidates, and they are not equivalent: render the group head
  unconditionally (cheapest, keeps the row untouched, costs a line of height when there is only
  one project), or carry `project · branch` in the row itself (identifies the row wherever it
  has scrolled to, costs width on the line that 010's measurement already found
  over-subscribed). Judge against
  [assets/010-popover-drilldown-prototype.html](assets/010-popover-drilldown-prototype.html),
  which is the design of record for this row.
- **Does the branch stay primary?** Today branch wins and project is its fallback. If both are
  shown, which one is the emphasised half — the repo you are in, or the sprint you are on?
- **Group heads and keyboard nav.** A head rendered for a single group becomes another
  `data-nav-key` stop and another collapsible group; check that ← / → and the row-index numbering
  still behave when the only group can be collapsed to nothing.

<!-- S06: all three decided in refine, see Decisions (Sprint) -->

## Decisions (Sprint)

- The project goes **into the row**, in the trailing identity span that shows the branch today
  (`project · branch`), not into an unconditional group head. Reason: AC2 asks the row to
  identify itself wherever the head has scrolled to, and only the row can do that.
- The group head keeps its `groups.length > 1` condition. Reason: once every row names its
  project, a single-group head adds a line and a collapsible nav stop with no new information,
  so the keyboard-nav / row-index question does not come up.
- The session label (021's name) stays the bold, primary part of line 1. In the trailing span
  the **project comes first and gets the emphasis** (`--text-dim`), and the branch follows in a
  quieter colour (`--text-faint`). Reason: the project is what this story exists to show, and
  sprint branch names repeat across repos by design.
- No new grid column: the place stays inside the existing `.ident` cell (`minmax(0, 1fr)`), and
  its cap goes up from 45% to 55% of that cell. Reason: 021's long user-chosen labels ellipsize
  first, and at the popover's 620 px a typical `claude-control · sprint/S06` fits the larger cap.
- Inside the place, the branch gives up width before the project (`flex-shrink` 2 vs 1), and the
  full `project · branch` is always in the span's `title`. Reason: truncation must not cut the
  half that tells two repos apart.
- With no branch recorded, the span shows the project alone, with no separator. Reason: AC5.
- A pure helper in `src/renderer/lib/popoverModel.ts` computes the row text. Reason: vitest runs
  without jsdom, and that file is where the popover's row rules are already tested.
- A structural test on `styles.css` proves AC4: the `.l1` grid keeps its eight fixed-width
  tracks. Reason: the profile's e2e is `none`, so this is the check one level down (gap named
  under Acceptance tests).
- AC6 is a scope constraint, not a behaviour. The D1 review proves it with a diff-scope check:
  nothing under `src/main/` and no main-window component changes. Reason: a test that
  re-asserts tray.ts's format string would be padding.
- Subagent rows (`SubagentRow`) stay unchanged. Reason: they show no branch today, and their
  parent row now names the project.

## Plan

Renderer-only, one deliverable. The trailing identity span of a popover row changes from
`branch ?? project` to `project · branch`, or the project alone when there is no branch.

1. `src/renderer/lib/popoverModel.ts`: new pure `rowPlace(session)` returns
   `{ project, branch, title }`. Tests go in `test/unit/popoverModel.test.ts`.
2. `src/renderer/popover.tsx` (session row, `.ident`, ~line 1006): the `.branch` span becomes a
   `.place` span (project, then ` · branch` when there is one), with `title` from the helper.
3. `src/renderer/styles.css` (~lines 1192–1265): `.place` / `.proj` / `.sep` / `.branch` rules
   replace `.popover-row .branch`. The cap goes up to 55%, and the branch shrinks first. The
   `.l1` grid is not touched.
4. `test/unit/popoverRowLayout.test.ts` (new): the `.l1` grid keeps its eight tracks.
5. `CHANGELOG.md`: one line under `## Unreleased`.

Not touched: the group-head condition, keyboard nav, `SubagentRow`, `src/main/tray.ts`, the main
window.

## Deliverables

- [x] **D1: a popover row names its project.** Renderer only. Files:
  `src/renderer/lib/popoverModel.ts`, `src/renderer/popover.tsx`, `src/renderer/styles.css`,
  `test/unit/popoverModel.test.ts`, `test/unit/popoverRowLayout.test.ts` (new),
  `CHANGELOG.md`.
  - In `popoverModel.ts`, export a pure
    `rowPlace(session: { project: { name: string }; branch: string | null }): { project: string; branch: string | null; title: string }`.
    An empty or whitespace-only branch counts as no branch. `title` is `project · branch`, or
    just the project.
  - In `popover.tsx`, the session row's line 1 has this span inside `.ident` today:
    `<span className="branch" title={session.branch ?? session.project.name}>{session.branch ? session.branch : session.project.name}</span>`.
    Replace it with a `<span className="place" title={place.title}>` that holds
    `<span className="proj">` with the project. When there is a branch, add a
    `<span className="sep">·</span>` and a `<span className="branch">` after it. The project
    always renders; the separator and the branch render only when there is a branch. Leave the
    `.name` label span before it alone. Update the line-1 comment so it says
    "project · branch" instead of "branch". The group head keeps `groups.length > 1`. Do not
    change keyboard navigation or `SubagentRow`.
  - In `styles.css`, replace the `.popover-row .branch` rule with these rules:
    - `.popover-row .place`: `display: flex; align-items: baseline; gap: 4px; flex: 0 0 auto;
      max-width: 55%; min-width: 0; font-size: 11px`
    - `.place .proj`: `color: var(--text-dim); flex: 0 1 auto; min-width: 0`
    - `.place .sep`: `color: var(--text-faint); flex: none`
    - `.place .branch`: `color: var(--text-faint); flex: 0 2 auto; min-width: 0`

    `.proj` and `.branch` keep the ellipsis trio (`overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap`), so update the shared `.popover-row .name, .popover-row .branch, …`
    selector to match. Do **not** change `grid-template-columns` on `.popover-row .l1`. Update
    the `.ident` comment: the name leads, then project · branch, and the branch gives up width
    first.
  - Tests in `test/unit/popoverModel.test.ts`, in a new `describe('rowPlace')`:
    - "a row names its project when only one project is live"
    - "two sessions on the same branch in different projects get different places"
    - "a session without a branch shows its project once"

    New `test/unit/popoverRowLayout.test.ts`, which reads `styles.css` the way `theme.test.ts`
    does (lines 28–30): "the popover row's first line keeps its eight-track grid". It asserts
    `9px 13px 11px minmax(0, 1fr) 108px 92px 22px 18px`.
  - `CHANGELOG.md`: one short line under `## Unreleased` saying the popover row now names its
    project.
  - Acceptance: `npm test` and `npm run typecheck` pass, and the diff touches nothing under
    `src/main/` and no main-window component.

## Model Hints

- D1 → default. One pure helper, one span and one CSS rule, with no cross-module behaviour.

Review: → default. Every plausible wrong implementation (an unconditional group head, a new grid
column, the project shown twice without a branch) fails a named test.

## Test Plan (manual acceptance)

### Acceptance tests

- AC1 (one project live, the row names it) → unit `test/unit/popoverModel.test.ts` › "a row
  names its project when only one project is live"
- AC2 (the row identifies its project without the group head) → unit
  `test/unit/popoverModel.test.ts` › "a row names its project when only one project is live".
  The place is computed from the session alone and has no group input.
- AC3 (same branch in different projects, rows still distinguishable) → unit
  `test/unit/popoverModel.test.ts` › "two sessions on the same branch in different projects get
  different places"
- AC4 (line 1 keeps its columns and the two-line layout) → unit
  `test/unit/popoverRowLayout.test.ts` › "the popover row's first line keeps its eight-track
  grid"
- AC5 (no branch, project shown once) → unit `test/unit/popoverModel.test.ts` › "a session
  without a branch shows its project once"
- AC6 (main window and tray unchanged) → diff-scope check in the D1 review: nothing under
  `src/main/` and no main-window component changes, and the existing suite still passes.

Gap (`ui-acceptance-required: true` while `e2e: none`): AC1–AC5 are visible to the user but
proven one level down, through the pure view-model helper and the stylesheet structure, because
the project has no render or e2e harness. Nothing machine-checks how the row truncates at
620 px. Listed for the sprint review.

## Done

Popover rows now read `project · branch` in the trailing identity span (project emphasised, branch shrinks first, 55% cap; project alone when no branch). New pure `rowPlace` helper in `popoverModel.ts`; `.l1` grid untouched; group head, `SubagentRow`, tray and main window unchanged.

Commit message: `017: popover row names its project (project · branch place span, rowPlace helper)`

Verification: narrow gate — `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` all green (21 tests in the changed files; the deliverable agent also ran full `npm test`, 540/540). Review: stage 1 (default) FAIL once (styles.css carried a duplicated ~900-line block and the stale 45% `.branch` rule), repaired, layout test now also asserts exactly one `.popover-row .l1` rule; review 2 PASS.
AC → test (all passed): AC1/AC2 `popoverModel.test.ts` › rowPlace › "a row names its project when only one project is live"; AC3 › "two sessions on the same branch in different projects get different places"; AC5 › "a session without a branch shows its project once"; AC4 `popoverRowLayout.test.ts` › "the popover row's first line keeps its eight-track grid"; AC6 diff-scope check in review (nothing under `src/main/`, no main-window component) — PASS.
Open: no render/e2e harness, so truncation at 620 px is not machine-checked (named gap, for the sprint review). Stale pre-existing comment "branch column" at styles.css ~1117 left as is.

Decisions: (1) CHANGELOG has no `# Features` heading, only bullets under `## Unreleased`; bullet added at the top there. (2) Layout test reads the shared `.l1` rule (`.popover-row .l1, .popover-subagent-row .l1`) by selector match. (3) Placed `rowPlace` tests with inline objects, no fixtures needed.

tiers: D 1 / hard 0 · review default · cycles 1 · agents 6
