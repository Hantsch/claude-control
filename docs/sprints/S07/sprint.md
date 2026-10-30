---
sprint: S07
status: in-progress
branch: dev
milestone: M9 — Trustworthy test lanes
---

# Sprint S07 — A release fails only on a real defect

## Goal

A merge to `main` releases unless the code is broken. The 2 s budgets (N4, N5) run in their own
non-blocking `npm run test:perf`, and a push that releases nothing runs no tests. A tag left
without a release is recovered by a re-run. The lanes are written down in `CLAUDE.md`, and the
suite is cleaner and less flaky behind them.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 023 — Timing budgets leave the blocking suite
- [x] 024 — The release lane tests only a due release and recovers a tag without a release
- [x] 025 — Test lanes are written down, and the story gate runs the whole suite
- [ ] 026 — Test hygiene: fake timers, dead PIDs, shared helpers, one Node pin, tighter timeouts, timing artifact
- [ ] 027 — Source-text wiring tests pruned to structural checks

## Notes

- Source: [test setup review 2026-10-30](../../reviews/2026-10-30-tests-review.md). It was
  triggered by a release that failed on `expected 2053 to be less than 2000`
  (pipeline.test.ts:1343, N5). The story map, the lane decision (§3b) and the findings are there.
- Scope was decided by the user on 2026-10-30: all five stories in one sprint, not just the two
  P1s. 023 and 024 are the P1 core. 025 needs both (it writes down the lanes they create), and
  026 needs 023 (fake timers and dead PIDs touch the tests 023 moves).
- **Deliberately left out:** F14 (double typecheck), F16 (rules tested at several layers), F17
  (pixel thresholds). The value judges said skip; the reasons are in the review §4. The rest of
  the pipeline.test.ts split beyond the timing cases (F11) is also left out.
- The 2 s requirement in CONCEPT.md §10 does not change: its guard moves to the perf lane and is
  not weakened.
- No e2e harness is needed: every criterion here is about tests, workflows or docs, not about
  something the user does in the app.

## Regression gate

<!-- Filled by `/sprint` phase 2b: the commands run, minutes taken, result, commit, and a verdict per failure. -->
