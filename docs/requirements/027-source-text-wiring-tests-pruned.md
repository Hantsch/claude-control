---
id: 027
title: Source-text wiring tests pruned to structural checks
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The maintainer wants a test that fails when the product is broken, not when a grid string or a
line of copy is reformatted. Seven renderer wiring tests read `src/renderer` source as text
because the project has no render harness (a documented decision: `.claude/ai-scrum.md` sets
`e2e: none`, and stories 006, 010, 012, 017 and 018 name the gap). The cheap cut is to delete what
only pins copy or call shape and keep what links one side of the app to the other. A jsdom harness
is out of scope.

Today ([review 2026-10-30](../reviews/2026-10-30-tests-review.md), F09, corrected to low):
- 8 files read `src/renderer/*.tsx|css` or README/CONCEPT as text; the 7 UI files total about 330
  lines, each 17-73 lines and committed once (no churn). The refuter: they are the sanctioned
  stand-in, not an oversight.
- Pinned strings: the exact grid `'9px 13px 11px minmax(0, 1fr) 108px 92px 22px 18px'`
  (`popoverRowLayout.test.ts:14-15`), call-shape regexes such as `/api\.getDetail\(targetId\)/`
  (`detailWindowWiring.test.ts:20-73`), a regex on
  `const target: NavigateTarget = { tab, sessionId }` (`showInMainWindow.test.ts:20-45`), UI copy
  (`hiddenSessions.test.ts:5-30`, `statusRollupWiring.test.ts:6-8, :25-40`) and a style string
  (`detailWindowStyles.test.ts:24`).
- The exceptions are justified and stay: `boundaries.test.ts` (:105; security boundary) and the N1
  wording pins in `networkPromiseWording.test.ts:30-55` (product promise).
- The 8 files, all under `test/unit/`: popoverRowLayout, statusRollupWiring, showInMainWindow,
  detailWindowWiring, detailWindowStyles, hiddenSessions, networkPromiseWording and boundaries.

## Acceptance Criteria

- [ ] **AC1** — `test/unit/popoverRowLayout.test.ts` no longer exists
- [ ] **AC2** — `test/unit/boundaries.test.ts` is unchanged (`git diff` empty), and
      `test/unit/networkPromiseWording.test.ts` still pins the N1 wording (a seeded edit of the N1
      sentence in the README fails it)
- [ ] **AC3** — `detailWindowWiring.test.ts`, `statusRollupWiring.test.ts`, `hiddenSessions.test.ts`
      and `detailWindowStyles.test.ts` contain no assertion on UI copy, a grid or style string, or a
      call-shape regex such as `api\.getDetail\(`: `rg "api\\\.getDetail" test/unit` returns nothing
      (the full list of removed assertions is fixed in refine)
- [ ] **AC4** — A structural link check remains: a test fails when an IPC channel used by the
      renderer is not declared in the preload or has no handler in main (seeded: rename one handler
      in `src/main`)
- [ ] **AC5** — The popover-to-main-window link of `showInMainWindow` stays checked structurally
      (seeded: removing the navigate call fails a test), without a regex on the `NavigateTarget`
      literal: `rg "NavigateTarget = " test/unit/showInMainWindow.test.ts` returns nothing
- [ ] **AC6** — `npm test` exits 0, and the Done section lists the removed assertions by name with
      the test count before and after
- [ ] **AC7** — No render harness is added: `rg "jsdom|testing-library" package.json` returns nothing

## Open Questions

- **Delete now or only when one breaks on a rename?** The value judge: opportunistic, never a
  dedicated sprint item, "prune only when a test actually breaks". The report scopes it P3 with no
  dependency; decide whether it runs in a sprint or rides along with the next UI story.
- **Which assertions are copy and which are structure?** The judge names popoverRowLayout (17
  lines) for deletion and the copy/regex parts of detailWindowWiring and statusRollupWiring; the
  rest is decided per file in refine, with a before/after list.
- **jsdom harness.** The judge: skip (effort L, new dependency, no UI-regression driver, poor ROI).
  The report's alternative (port 4-5 cases to jsdom plus testing-library) is rejected unless the
  user asks for it as its own story.
- **e2e gap.** The renderer's real behaviour stays unproven (`e2e: none`); this story does not
  change that and names it again.

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 027` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 027`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 027`: small pieces, each with its own acceptance
(scrum-like) and the files it touches. `/build` implements them in order, in one go.
Every acceptance criterion above must be covered by at least one deliverable **and** by the
test named for it in `## Acceptance Tests` — the test is part of the deliverable that
implements the behaviour, never a clean-up afterwards. Refine checks both before
`status: ready`, build refuses to start without them.>

- [ ] D1 — <smallest useful, individually acceptable result; names the files it touches>
- [ ] D2 — ...

## Model Hints

<Agent tier per deliverable. Default is the cheap tier with `/build`'s effort — leave
unmarked. If a step needs more brainpower: "D3 (balancing formula) → deliverable-hard" (Opus +
high effort, agent in `.claude/agents/`) plus a one-sentence risk justification.
Plus one line for the code review, default: "Review: → default".>

## Acceptance Tests

<Leave empty. Filled by `/refine 027`: one line per acceptance criterion above, naming the
automated test that proves it — level, file, and the test name it will carry. The tests are
written by the deliverables, not afterwards; `/build` re-checks this mapping and that the
tests pass before `status: done`. This section replaces the manual test plan: acceptance is
the suite, not a click list.

Example paths below; your real test layout and the commands that run it are in
`.claude/ai-scrum.md` (`e2e-story`, `test-story`).

- AC1 → e2e `tests/e2e/<flow>.spec.ts` › "<test name>" (real surface, per
  `ui-acceptance-required`)
- AC2 → unit `tests/core/<module>.test.ts` › "<test name>"
- AC3 → **manual residue:** <the real reason it cannot be automated — an OS dialog, a
  specific machine, a paid external service>. Goes into the sprint review; blocks nothing.>

## Done

<Leave empty. Filled by `/build 027` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
