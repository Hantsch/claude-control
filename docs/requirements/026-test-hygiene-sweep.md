---
id: 026
title: Test hygiene: fake timers, dead PIDs, shared helpers, one Node pin, tighter timeouts, timing artifact
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The maintainer wants the remaining small causes of slow or confusing test runs removed, each in
the narrowest form the value judges accepted, with no product code change and without competing
with 023 for the release fix.

Today ([review 2026-10-30](../reviews/2026-10-30-tests-review.md), F06, F10, F12, F13, F15, F07),
all corrected to low:
- F06: the debounce/ceiling test (`pipeline.test.ts:1348-1384`) injects a clock
  (`now: () => clock`, :1355) but waits on real `sleep(400)` (:1371) and 12 x `sleep(100)`
  (:1377-1381), about 1.6 s of the 7.99 s run. The refuter refuted the false-red claim (the 250 ms
  timer fires before the test's timer), so the waste stands, not a flake. The `sleep(300)` at :1213
  is a negative wait in a test with a real watcher and stays.
- F10: N5 registers `LIVE_PID + index` (:1258-1259) as fabricated sessions and relies on them being
  dead (:1311-1313); a runner process owning that pid changes the result. The 17
  `new ControlEngine({` sites use the test's own, always-alive `process.pid` and are fine. The
  comment (:1311-1313) says non-alive PIDs are "ended" while the assertion expects all 6 sessions.
- F12: `function stubFetch` exists twice with different signatures (updateSource.test.ts:52,
  windowSource.test.ts:36) plus a duplicated `jsonResponse`, and `mkdtemp(join(tmpdir(), ...))`
  appears in 5 places (four test files and builders.ts:404). The `view()`, `entry()`, `detail()`
  factories are single-consumer and out of scope.
- F13: `node-version: 22` is pinned in `validate.yml:20` and `release.yml:50`; `.nvmrc` and
  `.node-version` are absent; `engines.node` is a floor (`>=22`).
- F15: `testTimeout: 30_000`, `hookTimeout: 60_000` (`vitest.config.ts:9-10`) against a 7.99 s
  suite. The 180 s N5 override (:1345) is deliberate and stays.
- F07: both workflows run `npm test` with the default reporter only and upload nothing; the
  refuter corrected the framing (441 ms local vs 2053 ms CI is a machine difference, not a drift),
  so this is a duration history for the future, not a defect.

This story follows 023, which moves N5 and its tree into the perf lane and touches the same file.

## Acceptance Criteria

- [ ] **AC1** — The debounce/ceiling test uses `vi.useFakeTimers()`: `rg "sleep\(" test/unit/pipeline.test.ts`
      shows only the :1213 negative wait and the helper definition; the test still fails if the
      ceiling flush is removed (seeded defect in `FileWatcher`)
- [ ] **AC2** — The debounce test derives its waits from the configured `debounceMs` / `maxWaitMs`:
      `rg "sleep\(400\)|advanceTimersByTime\(400\)" test/unit/pipeline.test.ts` returns nothing, and
      fake timers are restored in `afterEach` (a following real-fs test in the same file passes)
- [ ] **AC3** — N5's fabricated sessions no longer use `LIVE_PID + index`:
      `rg "LIVE_PID \+ " test/unit/pipeline.test.ts` returns nothing for the N5 block, and its
      session count assertion matches its comment
- [ ] **AC4** — One dedicated test still exercises the real signal-0 liveness path (`process.pid`
      reads alive, a clearly dead pid reads not alive)
- [ ] **AC5** — `test/fixtures/http.ts` exports one `stubFetch` and `jsonResponse`;
      `rg "function stubFetch" test/unit` returns nothing, and updateSource.test.ts and
      windowSource.test.ts import it
- [ ] **AC6** — One temp-dir helper replaces the 5 `mkdtemp` sites: `rg "mkdtemp" test` returns only
      the helper
- [ ] **AC7** — The `view()`, `entry()` and `detail()` factories stay where they are:
      `rg "function view|function entry|function detail" test/unit` still finds all three
- [ ] **AC8** — `.node-version` contains `22`; `rg "node-version: 22" .github/workflows` returns
      nothing, both workflows use `node-version-file: .node-version`, and CONTRIBUTING.md names the file
- [ ] **AC9** — `vitest.config.ts` has `testTimeout: 15_000` and `hookTimeout: 60_000`, and `npm test`
      exits 0
- [ ] **AC10** — Both workflows run the Test step with `--reporter=default --reporter=json` and an
      output file, followed by an `actions/upload-artifact` step with `if: always()` and a 14-day
      retention; `rg -c "upload-artifact" .github/workflows` shows both files
- [ ] **AC11** — The helper moves lose no test: the suite's test count after the story equals the
      count before plus the tests this story adds explicitly (the real signal-0 test)

## Open Questions

- **testTimeout 15 s from a measurement.** The judge: 15 s, not 10 s, after one verbose run of the
  slowest per-test durations; a 10 s cap risks new timeout flakes on cold runners. Confirm 15 s or
  derive it from the run.
- **F10 mechanism.** The refuter: a full "FakeProbe only" route needs an injectable alive-check in
  `readStatus` (adapter.ts:187), which is more than S. The judge's cut is N5 only, with fabricated
  PIDs from a clearly dead range. Decide: dead range, or inject through `FakeProbe`.
- **F12 temp-dir lifecycle on Windows.** Moving cleanup out of `beforeEach`/`afterEach` can leak
  dirs or break Windows cleanup, and both `stubFetch` copies mutate `globalThis.fetch`, so the
  shared helper needs restore handling.
- **Artifact scope.** The judge: release.yml first, because that run failed; JUnit, trend
  dashboards and retry logic stay out. Decide whether validate.yml gets the artifact in the same
  change.
- **Not in scope:** the view/entry/detail factories (judge and refuter), the 17 `LIVE_PID` engine
  sites, `hookTimeout`, per-test timeout hunting, and splitting pipeline.test.ts and
  derivations.test.ts (F11 rest; opportunistic, no story).

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 026` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 026`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 026`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 026`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build 026` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
