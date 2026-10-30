---
id: 023
title: Timing budgets leave the blocking suite
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The maintainer releases by merging to main, and the release job must pass whenever the code is
fine. The three 2 s latency budgets (N4 append latency, the delegating-session registry flip, N5
cold start against a ~250 MB tree) are real requirements (CONCEPT.md:50-51) and stay. What has to
change is where they are enforced: a wall-clock number measured on a shared runner, inside the
blocking suite, makes the release depend on the speed of the machine. The project's own rule says
so (`.claude/commands/build.md:177-179`: a test in `test` never compares elapsed time against a
number; speed goes to a perf lane that `test` excludes). That lane does not exist yet.

Today ([review 2026-10-30](../reviews/2026-10-30-tests-review.md), F01, F05):
- 3 `toBeLessThan(2_000)` asserts on real time in `test/unit/pipeline.test.ts`: :1149 (N4),
  :1212 (registry flip), :1343 (N5). They are the only time-budget asserts in 577 tests across 38
  files. `vitest.config.ts` sets no `pool`, `fileParallelism`, `maxWorkers` or `retry`, so all files
  share the runner while N5 measures.
- A release was blocked by it: `FAIL ... resolves the live tier under 2 s against a ~250 MB tree
  (N5)`, `AssertionError: expected 2053 to be less than 2000` at pipeline.test.ts:1343. N5 measured
  441 ms when built (story 006); the code was fine, the test measured the runner. N4 (:1149, :1212)
  has about 4x margin and no CI value recorded; it is the next to fail.
- N5 is one 120-line test (:1226-1345) holding 1 timing assert and 3 premise guards (tree size
  :1297-1298, `finalText` clipped to 120 chars :1316-1331, non-null history usage :1333-1338), so a
  timing red reads like a read-pipeline bug. It writes 300 + 6 files, ~262 MB, per run, and
  cleanup swallows failures (`rm(...).catch(() => {})`, test/fixtures/builders.ts:399).
- Measured vs budget is only in a `console.log` (:1342), not in the assertion message.
- F11, timing half: pipeline.test.ts (1487 lines) holds the timing cases next to the engine cases;
  only the timing cases move here, splitting the rest is not part of this story.

The 2 s requirement in CONCEPT.md is not changed; the guard moves, it is not weakened.

## Acceptance Criteria

- [ ] **AC1** — `npm run test:perf` exists in package.json and exits 0 on a healthy tree; it runs
      the N4, registry-flip and N5 budget tests only (its own vitest project/config or files under
      `test/perf/`)
- [ ] **AC2** — `rg "toBeLessThan\(2_000\)" test/unit` returns nothing, and
      `rg "toBeLessThan\(2_000\)" test/perf` finds the three strict 2 s asserts
- [ ] **AC3** — The perf lane runs with `fileParallelism: false`, and `npm test` does not run any
      file under `test/perf/` (the `npm test` file list contains none)
- [ ] **AC4** — A perf test that exceeds its budget fails with a message carrying both numbers
      (measured and 2000), proven by a test that seeds a slow case and expects that message
- [ ] **AC5** — A blocking test fails if the status change after an append never arrives
      (N4 functional check), and another fails if the delegating session's registry flip never
      happens, each without any elapsed-time comparison
- [ ] **AC6** — A blocking N5-premise test, separate from the timing test, asserts tree size, session
      count, `finalText` clip and non-null usage on a tree of 50 MB or less; seeding a wrong
      session count or an unclipped `finalText` makes it fail
- [ ] **AC7** — No file written by `npm test` exceeds a 50 MB tree: the blocking N5 premise test
      sets a tree size of at most 50 MB (asserted in the test itself), and the 250 MB tree is
      created only under `test/perf/`
- [ ] **AC8** — A failing fixture cleanup is logged (`console.warn` with the path and error) and
      does not throw; `rg "catch\(\(\) => \{\}\)" test/fixtures/builders.ts` returns nothing
- [ ] **AC9** — `docs/CONCEPT.md` lines 50-51 are unchanged (`git diff` of that range is empty)

## Open Questions

- **Tripwire or no number in the blocking test?** The value judge suggested keeping a wide
  tripwire (about 10 s) with measured vs budget in the message; the lane decision says no number
  or at most a 10 s tripwire. Decide for refine: no number (pure functional check) or a 10 s
  tripwire that still catches a hang.
- **Perf lane: dispatch-only, or also scheduled?** The lane map says local plus
  `workflow_dispatch`, optionally scheduled. Without a schedule nobody looks at it (value judge:
  the risk is silently losing the budget guard). Decide whether a scheduled run is in scope.
- **Is CONCEPT.md:51 / :569-570 / IMPLEMENTATION.md:205 (N5 asserted against a ~250 MB tree) still
  met?** The refuter notes the 250 MB tree is a documented decision; the perf lane keeps it, the
  blocking suite does not. Confirm that this reading satisfies those lines.
- **Retry in the perf lane?** The value judge said do not retry-mask; the report allowed
  `retry: 2` as an alternative. Decide: strict single run, or a bounded retry.

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 023` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 023`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 023`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 023`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build 023` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
