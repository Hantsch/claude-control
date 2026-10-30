---
id: 023
title: Timing budgets leave the blocking suite
status: ready # draft -> ready -> in-progress -> done
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
- [ ] **AC10** — `.github/workflows/perf.yml` runs `npm run test:perf` on a weekly `schedule` and on
      `workflow_dispatch`, and no other workflow runs `test:perf` (the lane reports, it blocks nothing)

## Open Questions

- ~~**Tripwire or no number in the blocking test?**~~ answered → Decisions (Sprint)
- ~~**Perf lane: dispatch-only, or also scheduled?**~~ answered → Decisions (Sprint)
- ~~**Is CONCEPT.md:51 / :569-570 / IMPLEMENTATION.md:205 (N5 asserted against a ~250 MB tree)
  still met?**~~ answered → Decisions (Sprint)
- ~~**Retry in the perf lane?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Perf lane: scheduled run plus workflow_dispatch (weekly cron), not dispatch-only.
- **(User)** Tripwire: no timing number in the blocking tests; the perf lane guards the 2 s budget (N4/N5, 250 MB tree), which satisfies CONCEPT.md §10.
- Q3 (CONCEPT.md:51/:569-570, IMPLEMENTATION.md:205) is answered by the tripwire decision: the 250 MB N5 assert lives on in `test/perf/`, so those lines stay true.
- Perf-lane retry: strict single run (`retry: 0`) — a retry masks a budget that is creeping up, and the lane blocks nothing, so a red costs only a look.
- The weekly perf workflow gets its own criterion (AC10) — it makes the (User) schedule decision checkable; otherwise no D would carry it.
- The perf lane is a standalone `vitest.perf.config.ts`, not a `mergeConfig` of the base — `mergeConfig` concatenates `include` and would pull `test/unit` into the perf run.
- The blocking N4 / registry-flip tests wait on the event with no timer of their own; vitest's `testTimeout` fails a transition that never arrives — this follows the (User) "no number" decision.
- The blocking N5 premise tree is 20 MB (cap 50 MB) — the premise does not depend on size, and a smaller tree keeps `npm test` within its ≤ 30 s lane budget (review §3b).
- The cold-start tree writer takes its size as a required argument (no 250 default) — so the 250 MB value can only come from the perf file.
- The premise guards become one shared function used by the blocking premise test and the perf N5 test — the seeded-failure proof of AC6 then covers both, and a perf red caused by a broken premise says so.
- The perf copies of N4 / registry flip duplicate the scenario setup once instead of sharing a helper — two copies are within the refine rule (a third is not), and scenario helpers would widen the D for no gain.
- CONTRIBUTING.md's N4/N5 lines are left to story 025, whose AC covers them; this story touches no docs beyond test-file headers.

## Plan

Order: cleanup fix first (independent), then the blocking side, then the perf lane that takes over
the numbers. Nothing in `src/` changes.

1. **D1** `test/fixtures/builders.ts`: cleanup logs failures (`console.warn` path + error) instead of
   `.catch(() => {})`; the remover is injectable so a test can make it fail.
2. **D2** Blocking side:
   - Move `FakeProbe`, `makeAdapter`, `LIVE_PID`, `historyDone`, `sleep`, `treeSize` out of
     `test/unit/pipeline.test.ts` into `test/fixtures/engine.ts`, plus three new exports:
     `writeColdStartTree(tree, totalMb)`, `assertColdStartPremise(...)`, `budgetMessage(...)`.
   - N4 and registry-flip tests in pipeline.test.ts keep their functional asserts and lose the
     `toBeLessThan(2_000)` and the `Date.now()` arithmetic.
   - The N5 timing test leaves pipeline.test.ts; a blocking premise test on a 20 MB tree takes its
     place. New `test/unit/perfLaneGuards.test.ts` proves the premise function and the budget
     message fail on seeded bad input.
3. **D3** Perf lane: `vitest.perf.config.ts` (`test/perf/**/*.test.ts`, `fileParallelism: false`,
   `retry: 0`), `test:perf` script, `test/perf/budgets.test.ts` with the three strict 2 s asserts,
   tsconfig include, `.github/workflows/perf.yml` (weekly cron + dispatch).

Affected: `test/fixtures/{builders,engine}.ts`, `test/unit/{pipeline,fixtureCleanup,perfLaneGuards}.test.ts`,
`test/perf/budgets.test.ts`, `vitest.perf.config.ts`, `package.json`, `tsconfig.node.json`,
`.github/workflows/perf.yml`. Not touched: `docs/CONCEPT.md`, `vitest.config.ts` (its `include`
already stops at `test/unit/`), `validate.yml`, `release.yml`.

## Deliverables

- [ ] **D1 — Fixture cleanup reports failures instead of swallowing them.**
      Files: `test/fixtures/builders.ts`, new `test/unit/fixtureCleanup.test.ts`.
      In `builders.ts` (~line 397) `cleanupFixtureTrees()` does
      `rm(root, { recursive: true, force: true }).catch(() => {})`. Extract an exported
      `removeTrees(roots: string[], remove = (root) => rm(root, { recursive: true, force: true }))`
      that awaits all removals and, on a rejection, calls `console.warn` with the root path and the
      error, never rethrowing; `cleanupFixtureTrees()` calls it with the spliced `createdTrees`.
      `test/setup.ts` stays as is.
      Test in `test/unit/fixtureCleanup.test.ts` › "a failing fixture cleanup warns with the path
      and does not throw": pass a remover that rejects for a fake path, spy on `console.warn`
      (`vi.spyOn`, restored afterwards), expect the call to resolve and the warning to carry the
      path and the error message.
      Acceptance: the test passes; `rg "catch\(\(\) => \{\}\)" test/fixtures/builders.ts` is empty.

- [ ] **D2 — The blocking suite keeps the functional checks and drops every time budget.**
      Files: new `test/fixtures/engine.ts`, `test/unit/pipeline.test.ts`, new
      `test/unit/perfLaneGuards.test.ts`.
      1. Move from `test/unit/pipeline.test.ts` into `test/fixtures/engine.ts` (exported, behaviour
         unchanged): `FakeProbe` (:47), `makeAdapter` (:67), `LIVE_PID`, `historyDone` (:1435),
         `sleep` (:1456), `treeSize` (:1461). pipeline.test.ts imports them; no test is lost.
      2. Add to `engine.ts`:
         - `writeColdStartTree(tree: FixtureTree, totalMb: number): Promise<{ liveIds: string[];
           livePids: number[] }>` — the tree-writing body of today's N5 test (:1227-1277: 300
           history files across 23 projects, 6 live sessions with the multi-KB agent report).
           `totalMb` is required, no default.
         - `assertColdStartPremise(snapshot, historyEntries, liveCount)` — the guards of today's
           N5 test (:1300, :1316-1331, :1333-1338): session count equals `liveCount`; one subagent
           `finalText` exists, ends with `…`, length in (100, 120]; at least one history entry has
           non-null usage with `inputTokens > 0`. Uses `expect`, so a violation throws.
         - `budgetMessage(label: string, measuredMs: number, budgetMs = 2_000): string`, e.g.
           `N5: measured 2053 ms, budget 2000 ms`.
      3. In pipeline.test.ts: the N4 test (:1097) and the registry-flip test (:1153) keep setup and
         functional asserts but drop the elapsed arithmetic (`(await observed) - appendedAt` / `- flippedAt`;
         `flippedAt` may stay as a "flip happened" flag) and the
         `toBeLessThan(2_000)`; they `await` the observed transition with no timer of their own
         (vitest's `testTimeout` fails one that never arrives). Rename N4 to "observes the status
         change an append causes (N4)". The flip test keeps `doneBeforeFlip`, the `sleep(300)`
         negative wait, one `done` and one notification. Update the file header (:5-6): the N4/N5
         budgets live in `test/perf/` (do not restate the tree size there; AC7's check greps it).
      4. Replace the N5 timing test (:1226-1345) with a blocking test "the cold-start tree resolves
         every live session with a clipped final text and summed usage (N5 premise)":
         `writeColdStartTree(tree, 20)`, assert `treeSize` > 0.9 × 20 MB **and** ≤ 50 MB, start the
         engine with `indexHistoryOnStart: true`, await `historyDone` (subscribed before
         `start()`), call `assertColdStartPremise(snapshot, engine.listHistory().entries,
         liveIds.length)`. No `Date.now()`, no `console.log`, no `CC_COLDSTART_MB`, default timeout.
      5. `test/unit/perfLaneGuards.test.ts`, tests that seed the failure:
         - "a budget overrun names the measured time and the budget":
           `expect(() => expect(2053, budgetMessage('N5', 2053)).toBeLessThan(2_000)).toThrow()`,
           and the thrown message contains `measured 2053 ms` and `budget 2000 ms`.
         - "the cold-start premise rejects a wrong session count" and "the cold-start premise
           rejects an unclipped final text": hand-built snapshot/history objects (no tree); a valid
           case passes, the seeded case throws.
      Acceptance: `npm test` green; `rg "toBeLessThan\(2_000\)" test/unit` and
      `rg "CC_COLDSTART_MB|250 MB|\?\? 250" test/unit/pipeline.test.ts test/fixtures/engine.ts` return nothing.

- [ ] **D3 — `npm run test:perf` holds the three strict 2 s budgets, weekly and on demand.**
      Files: new `vitest.perf.config.ts`, `package.json`, `tsconfig.node.json`, new
      `test/perf/budgets.test.ts`, new `.github/workflows/perf.yml`. Reuses
      `test/fixtures/engine.ts` (`FakeProbe`, `makeAdapter`, `LIVE_PID`, `historyDone`, `treeSize`,
      `writeColdStartTree`, `assertColdStartPremise`, `budgetMessage`) — do not copy helpers.
      1. `vitest.perf.config.ts`: a standalone `defineConfig` (do **not** `mergeConfig` the base
         `vitest.config.ts` — it concatenates `include`), `environment: 'node'`,
         `include: ['test/perf/**/*.test.ts']`, `setupFiles: ['test/setup.ts']`,
         `fileParallelism: false`, `retry: 0`, `testTimeout: 180_000`, `hookTimeout: 60_000`.
         Add the file to `tsconfig.node.json` `include` next to `vitest.config.ts`.
      2. `package.json` script `"test:perf": "vitest run --config vitest.perf.config.ts"`.
      3. `test/perf/budgets.test.ts` (header: the 2 s budgets of CONCEPT.md §10 N4/N5, run alone so
         nothing shares the runner, block nothing), three tests, each ending in
         `expect(elapsed, budgetMessage('<label>', elapsed)).toBeLessThan(2_000)` — literal `2_000`:
         - "observes a status change within 2 s of an append (N4)" — the N4 body as it is in
           `git show HEAD:test/unit/pipeline.test.ts` (:1097-1151), real clock, timing kept.
         - "a delegating session's registry flip is seen within 2 s" — the flip scenario from the
           same HEAD version (:1153-1218), timing kept; the functional extras may be dropped.
         - "resolves the live tier under 2 s against a ~250 MB tree (N5)":
           `writeColdStartTree(tree, Number(process.env.CC_COLDSTART_MB ?? 250))`, the
           `> 0.9 × totalMb` size guard, `historyDone` subscribed before `start()`, measure
           `start()` until history done, `assertColdStartPremise(...)` **before** the budget
           assert, then the budget assert. Per-test timeout 180_000.
      4. `.github/workflows/perf.yml`: `on:` `schedule` (one weekly cron, e.g. `'0 4 * * 1'`) and
         `workflow_dispatch`; one job on `windows-latest` (same reason as validate.yml), checkout,
         setup-node 22 with npm cache, `npm ci`, `npm run test:perf`. validate.yml and release.yml
         stay untouched.
      Acceptance: `npm run test:perf` exits 0 locally; `npm test` green and
      `npx vitest list --filesOnly` lists no `test/perf/` file; `npm run typecheck` green.

## Model Hints

All Ds default tier: the work moves tests and adds a config, and each risk has a named check (a
vacuous perf run is caught by AC1/AC3's file lists, a lost premise guard by the seeded tests).

Review: → default

## Acceptance Tests

Command checks below are run by `/build` as part of the story's acceptance, next to the tests.

- AC1 → perf `test/perf/budgets.test.ts` › the three tests, via `npm run test:perf` (exit 0), plus
  check `npx vitest list --config vitest.perf.config.ts --filesOnly` lists only `test/perf/` files (D3)
- AC2 → check `rg "toBeLessThan\(2_000\)" test/unit` returns nothing and
  `rg -c "toBeLessThan\(2_000\)" test/perf` counts 3 (D2, D3)
- AC3 → check `npx vitest list --filesOnly` contains no `test/perf/` path, and
  `rg -n "fileParallelism: false" vitest.perf.config.ts` returns one line (D3)
- AC4 → unit `test/unit/perfLaneGuards.test.ts` › "a budget overrun names the measured time and the budget" (D2)
- AC5 → unit `test/unit/pipeline.test.ts` › "observes the status change an append causes (N4)" and
  › "a delegating session turns done only when the registry goes idle, without waiting for the
  tick", plus check `rg -n "\) - (appendedAt|flippedAt)|toBeLessThan\(2_000\)" test/unit/pipeline.test.ts`
  returns nothing (D2)
- AC6 → unit `test/unit/pipeline.test.ts` › "the cold-start tree resolves every live session with a
  clipped final text and summed usage (N5 premise)"; unit `test/unit/perfLaneGuards.test.ts` ›
  "the cold-start premise rejects a wrong session count" and › "the cold-start premise rejects an
  unclipped final text" (D2)
- AC7 → the same N5 premise test (asserts tree ≤ 50 MB itself), plus check
  `rg "CC_COLDSTART_MB|250 MB|\?\? 250" test/unit/pipeline.test.ts test/fixtures/engine.ts` returns nothing and
  `rg -n "CC_COLDSTART_MB" test/perf` finds the perf N5 test (D2, D3)
- AC8 → unit `test/unit/fixtureCleanup.test.ts` › "a failing fixture cleanup warns with the path
  and does not throw", plus check `rg "catch\(\(\) => \{\}\)" test/fixtures/builders.ts` returns
  nothing (D1)
- AC9 → check `git diff --exit-code HEAD -- docs/CONCEPT.md` returns 0 before the story commit:
  no D touches CONCEPT.md (all Ds)
- AC10 → check `rg -n "schedule:|cron:|workflow_dispatch|npm run test:perf" .github/workflows/perf.yml`
  finds all four and `rg -l "test:perf" .github/workflows` returns only `perf.yml` (D3).
  **Manual residue:** that the cron actually fires is observable only on GitHub Actions after the
  file reaches the default branch (scheduled runs exist only there) — an external service, not
  runnable locally.

## Done

<Leave empty. Filled by `/build 023` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
