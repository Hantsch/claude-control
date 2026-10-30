# Sprint S07 — Review

**Sprint goal:** a merge to `main` releases unless the code is broken. The 2 s budgets (N4, N5)
run in their own non-blocking `npm run test:perf`, a push that releases nothing runs no tests, a
tag left without a release is recovered by a re-run, the lanes are written down in `CLAUDE.md`,
and the suite is cleaner and less flaky behind them.

**Branch:** `dev` (`sprint-branch: false`, start commit `8f56aa7`) · **Milestone:** M9 — Trustworthy test lanes

## Overview

| Story | Status | Commit |
| --- | --- | --- |
| 023 — Timing budgets leave the blocking suite | done | `c721b99` timing budgets to perf lane (test:perf + weekly workflow), blocking N5 premise on 20 MB, cleanup warns |
| 024 — The release lane tests only a due release and recovers a tag without a release | done | `ab04bf6` release lane tests only a due release, re-run recovers tag without release |
| 025 — Test lanes are written down, and the story gate runs the whole suite | done | `d455eb6` CLAUDE.md test-lane table + drift test, story gate runs npm test, CONTRIBUTING N4/N5 to perf lane |
| 026 — Test hygiene sweep | done | `84dccf1` fake timers, dead PIDs, shared fetch/tempdir helpers, .node-version, 15 s timeout, timing artifact |
| 027 — Source-text wiring tests pruned to structural checks | done | `784c7e4` prune source-text wiring tests to structural links, generic ipcWiring test, navigate behaviour test |

Five of five done, none blocked. Regression gate green.

## Implemented stories

- **023** — The three 2 s budget asserts (N4, N5 against the 250 MB tree, registry flip) moved to
  `test/perf/budgets.test.ts`, run by `npm run test:perf` (own `vitest.perf.config.ts`, serial,
  `retry: 0`) and by `.github/workflows/perf.yml` (weekly cron + `workflow_dispatch`, non-blocking).
  The blocking suite keeps the functional checks with no timing number, plus an N5 premise test on
  a 20 MB tree. Engine helpers moved to `test/fixtures/engine.ts`; fixture cleanup now warns
  instead of swallowing errors.
- **024** — `npm test` left `release.yml` and runs inside `scripts/ci-release.ps1` after the
  "nothing to release" exit and before anything is committed. A HEAD that already carries a `v*`
  tag without a GitHub release is recovered on re-run (notes from CHANGELOG, build, sums, `gh
  release create`, no bump/commit/push). Proven by `test/unit/ciRelease.test.ts` against a temp
  repo with stubbed `npm`/`gh`, including a reproduction of the F03 failure.
- **025** — New root `CLAUDE.md` with the lane table (Story, PR, Release, Perf), budgets written
  as targets, guarded against drift by `test/unit/testLanes.test.ts`. The profile's `test-story`
  is now `npm test`; CONTRIBUTING.md points N4/N5 to the perf lane.
- **026** — `testTimeout: 15_000`; the debounce/ceiling test runs on fake timers; N5's fabricated
  sessions use dead PIDs from `test/fixtures/pids.ts`; shared `stubFetch`/`makeTempDir` helpers
  replace seven copies; one `.node-version` pin for all workflows; a JSON timing artifact is
  uploaded from validate and release runs.
- **027** — `popoverRowLayout.test.ts` deleted; four wiring tests cut down to cross-file links.
  New `test/unit/ipcWiring.test.ts` checks every renderer `api.X(` call against the real preload
  and `registerIpc`; the popover → main window navigate flow got a behaviour test in
  `detailWindow.test.ts`. Suite went from 594 to 587 tests.

## Findings & decisions

- **User decisions (phase 1a):** perf lane scheduled weekly plus dispatch; no timing number in
  the blocking tests (the perf lane carries CONCEPT §10's 2 s guard); keep one release-lane test
  run with the recovery branch, `validate` not made a required check; 027 run in this sprint.
- **The story gate is wider now.** `test-story: npm test` (025) — the full unit suite runs per
  story. It took 11 s at the gate, so the cost is small.
- **024's guard throws are untested:** the package.json-vs-tag mismatch and the missing/empty
  CHANGELOG section throw by decision but have no test → follow-up line in the roadmap.
- **`networkPromiseWording` pins less than it looks:** removing "no outbound requests" from the
  README does not fail it; only the "are the two exceptions" phrase is pinned (found in 027's
  seed run) → follow-up line in the roadmap.
- **`docs/sprints/README.md` is plugin-managed** and 025 edited one sentence of it ("full unit
  suite"). A future `/ai-scrum:setup` update may overwrite it; that's why AC8 was checked once in
  the gate rather than pinned by a test.
- **027 removed the only proof of some renderer behaviour** (main window selecting the navigated
  session, Escape closing the detail window, Copy/Show buttons and their text). It's named as a
  gap; it folds into the existing "no e2e harness" follow-up.
- The progress trail was monotonic; no typed timestamps.

## Blocked / open

Nothing blocked. Waiting on the user: push `dev` (the commits are on `dev` already).

## Regression gate

Ran once on `784c7e4`: `npm run build` (< 0.1 min), `npm run typecheck` (< 0.1 min), `npm test`
(0.2 min, 42 files / 587 tests) all green. `e2e` and `e2e-all` are `none`. No failures, nothing
attributed, no quarantine entries.

## Acceptance

All criteria are proven by automated tests or command checks that ran in the story gates. The
full mapping is in each story's Done section:

- **023** — AC1–AC3 `test:perf` run + `vitest list` checks + `rg` for literal budgets; AC4/AC6/AC7
  `perfLaneGuards.test.ts` + pipeline N5 premise test; AC5 pipeline N4/flip tests; AC8
  `fixtureCleanup.test.ts`; AC9 empty CONCEPT.md diff; AC10 `perf.yml` checks.
- **024** — AC1–AC8 `ciRelease.test.ts` (6 tests, real script, temp repo, stubbed `npm`/`gh`).
- **025** — AC1–AC7 `testLanes.test.ts`; AC8 `rg` check in the gate (by decision, see above).
- **026** — AC1–AC11 mapped to the touched tests; seeded `watcher.ts` defect turned the ceiling
  test red.
- **027** — AC1–AC7 by file deletion, `rg` checks, `ipcWiring.test.ts`, `detailWindow.test.ts`;
  seeds (channel renames, removed `cc:navigate` sends) turned the new tests red.

**Manual residue:** 023 AC10, part two: that the weekly cron actually fires can only be seen on
GitHub Actions once `perf.yml` is on the default branch.

**Covered below the real surface:** none of this sprint's criteria are user-facing. 027 leaves
the renderer half of the navigate/detail flows unproven (no e2e harness), see above.

No `testplan.md`: the one manual residue is a CI observation, not a walk-through.

## Tier record

| Story | Ds | hard Ds | review stages | cycles | agents | build min |
| --- | --- | --- | --- | --- | --- | --- |
| 023 | 3 | 0 | default | 1 | 6 | 6 |
| 024 | 2 | 1 | default | 1 | 6 | 10 |
| 025 | 2 | 0 | default | 1 | 6 | 8 |
| 026 | 6 | 0 | default | 1 | 9 | 8 |
| 027 | 3 | 0 | default | 1 | 5 | 5 |
| **Total** | **16** | **1** | **0 of 5 hard** | **5** | **32** | **37** |

No story was marked `story-review-hard`, so there is no second-stage review to compare. Refine
took 5 min for all five stories in parallel.
