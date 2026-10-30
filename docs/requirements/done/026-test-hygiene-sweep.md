---
id: 026
title: Test hygiene: fake timers, dead PIDs, shared helpers, one Node pin, tighter timeouts, timing artifact
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — The debounce/ceiling test uses `vi.useFakeTimers()`: `rg "sleep\(" test/unit/pipeline.test.ts`
      shows only the :1213 negative wait and the helper definition; the test still fails if the
      ceiling flush is removed (seeded defect in `FileWatcher`)
- [x] **AC2** — The debounce test derives its waits from the configured `debounceMs` / `maxWaitMs`:
      `rg "sleep\(400\)|advanceTimersByTime\(400\)" test/unit/pipeline.test.ts` returns nothing, and
      fake timers are restored in `afterEach` (a following real-fs test in the same file passes)
- [x] **AC3** — N5's fabricated sessions no longer use `LIVE_PID + index`:
      `rg "LIVE_PID \+ " test/unit/pipeline.test.ts` returns nothing for the N5 block, and its
      session count assertion matches its comment
- [x] **AC4** — One dedicated test still exercises the real signal-0 liveness path (`process.pid`
      reads alive, a clearly dead pid reads not alive)
- [x] **AC5** — `test/fixtures/http.ts` exports one `stubFetch` and `jsonResponse`;
      `rg "function stubFetch" test/unit` returns nothing, and updateSource.test.ts and
      windowSource.test.ts import it
- [x] **AC6** — One temp-dir helper replaces the 5 `mkdtemp` sites: `rg "mkdtemp" test` returns only
      the helper
- [x] **AC7** — The `view()`, `entry()` and `detail()` factories stay where they are:
      `rg "function view|function entry|function detail" test/unit` still finds all three
- [x] **AC8** — `.node-version` contains `22`; `rg "node-version: 22" .github/workflows` returns
      nothing, both workflows use `node-version-file: .node-version`, and CONTRIBUTING.md names the file
- [x] **AC9** — `vitest.config.ts` has `testTimeout: 15_000` and `hookTimeout: 60_000`, and `npm test`
      exits 0
- [x] **AC10** — Both workflows run the Test step with `--reporter=default --reporter=json` and an
      output file, followed by an `actions/upload-artifact` step with `if: always()` and a 14-day
      retention; `rg -c "upload-artifact" .github/workflows` shows both files
- [x] **AC11** — The helper moves lose no test: the suite's test count after the story equals the
      count before plus the tests this story adds explicitly (the real signal-0 test)

## Open Questions

- ~~**testTimeout 15 s from a measurement.**~~ answered → Decisions (Sprint)
- ~~**F10 mechanism.** Dead range, or inject through `FakeProbe`.~~ answered → Decisions (Sprint)
- ~~**F12 temp-dir lifecycle on Windows** and `globalThis.fetch` restore.~~ answered → Decisions (Sprint)
- ~~**Artifact scope.** Does validate.yml get the artifact in the same change?~~ answered → Decisions (Sprint)
- **Not in scope:** the view/entry/detail factories (judge and refuter), the 17 `LIVE_PID` engine
  sites, `hookTimeout`, per-test timeout hunting, and splitting pipeline.test.ts and
  derivations.test.ts (F11 rest; opportunistic, no story).

## Decisions (Sprint)

- testTimeout is 15 s (judge's figure); D1 measures the slowest test first and stops if it is above 5 s, because a cap with less than 3x margin would trade slowness for cold-runner flakes.
- F10 uses a dead PID range, not an injected alive-check: the refuter showed the `FakeProbe` route needs a product change in `readStatus`, and this story changes no product code.
- Dead PIDs come from one helper `deadPids(count)` in `test/fixtures/pids.ts` that walks down from 0x7FFFFFFC in steps of 4 and keeps only PIDs `isAliveSync` reads as dead, because Windows PIDs are multiples of 4 (low bits ignored by OpenProcess) and a fixed number is never guaranteed dead.
- N5 keeps session 0 on `LIVE_PID` (alive) and moves sessions 1-5 to `deadPids(5)`, and asserts 6 listed / 5 `ended`, because that is today's real outcome on a runner where those PIDs are free, so the premise guards keep running on the path they run today.
- AC3 applies to every N5 site after 023 (the blocking premise test in `test/unit/pipeline.test.ts` and the perf test under `test/perf/`); the `LIVE_PID + 1` at the "huge name" discovery test is a registry file key outside N5 and stays.
- The AC4 signal-0 test lives in `describe('registry')` of `test/unit/derivations.test.ts`, which already imports `liveness.ts`, so no new file per story.
- The temp-dir helper replaces creation only: each file keeps its own `beforeEach`/`afterEach` placement and its own `rm`, and the helper also registers the dir with the setup file's `cleanupFixtureTrees` as a safety net, so no cleanup moves and no Windows cleanup timing changes.
- AC6's `rg "mkdtemp" test` is read as `rg "mkdtemp(Sync)?\(" test`, because `boundaries.test.ts:79` names `mkdtemp` inside a forbidden-call regex for product code, which is not a temp-dir site.
- The shared `stubFetch` installs through `vi.stubGlobal('fetch', spy)` and both files restore with `vi.unstubAllGlobals()` in their existing `afterEach`, so restore is vitest's job and no module-level `originalFetch` remains.
- The timing artifact goes into both workflows in this story, because AC10 already requires both and the second step is a copy of the first.
- If 024 moved the release lane's `npm test` into `ci-release.ps1`, the reporter flags go on that invocation and the upload step follows the Release step with `if-no-files-found: ignore`, because a push that releases nothing writes no report.
- No CHANGELOG entry: tests and CI only, nothing user-facing changes.

## Plan

Builds after 023 (N5 split into a blocking premise test plus a perf test under `test/perf/`, builders.ts
cleanup) and 024 (release.yml step order). Refer to tests by name, not line: 023 shifts lines.

1. **Baseline + timeout (D1):** one `npx vitest run --reporter=verbose` records total test count and
   slowest test; then `vitest.config.ts` `testTimeout: 15_000` (hookTimeout stays 60_000).
2. **Fake timers (D2):** "coalesces a burst of events and never waits longer than the ceiling" in
   `test/unit/pipeline.test.ts` switches to `vi.useFakeTimers()`, waits derived from named
   `debounceMs`/`maxWaitMs` constants, real timers restored in `afterEach`. The real-watcher
   `sleep(300)` negative wait stays.
3. **Dead PIDs (D3):** `test/fixtures/pids.ts` `deadPids(count)`; N5 sites use it; one signal-0 test
   in `derivations.test.ts`.
4. **Fetch helper (D4):** `test/fixtures/http.ts` with `stubFetch` + `jsonResponse`; two consumers.
5. **Temp-dir helper (D5):** `makeTempDir(prefix)` replaces the 5 `mkdtemp` sites; final test-count
   check (baseline + 1).
6. **CI (D6):** `.node-version`, `node-version-file` in both workflows, CONTRIBUTING.md, json reporter
   + `actions/upload-artifact` (14 days, `if: always()`).

No product code (`src/`) changes. No systems doc exists for tests/CI (`docs/systems` is absent).

## Deliverables

- [x] D1 — **Baseline and tighter test timeout.** Before touching anything, run
  `npx vitest run --reporter=verbose` and record (a) the total test count and (b) the slowest
  test with its duration; report both in your result (the build keeps the count as the AC11
  baseline). If the slowest test in `npm test` takes more than 5 s, stop and report instead of
  changing the timeout. Otherwise set `testTimeout: 15_000` in `vitest.config.ts`; keep
  `hookTimeout: 60_000` and any per-test override in a perf config/file untouched. Acceptance:
  `vitest.config.ts` shows `testTimeout: 15_000` and `hookTimeout: 60_000`; `npm test` exits 0.
  Files: `vitest.config.ts`.
- [x] D2 — **Debounce/ceiling test on fake timers.** In `test/unit/pipeline.test.ts`, the test
  "coalesces a burst of events and never waits longer than the ceiling" (drives a
  `FileWatcher` from `src/core/watch/watcher.ts` through its private `enqueue`, injected
  `now: () => clock`) today waits with real `sleep(400)` and 12 x `sleep(100)`. Change it to:
  `const debounceMs = 250; const maxWaitMs = 1_000;` passed to the watcher; `vi.useFakeTimers()`
  at the start; burst phase advances `vi.advanceTimersByTime(debounceMs + 1)` and expects
  `[1]`; stream phase advances `clock` and timers in steps shorter than `debounceMs` (e.g.
  `debounceMs / 2.5`) until past `maxWaitMs`, then expects at least one flush. Add
  `afterEach(() => { vi.useRealTimers(); })` in that test's `describe` scope (import
  `afterEach`, `vi` from vitest). Do not touch the `sleep(300)` negative wait in the real-watcher
  registry-flip test or the `sleep` helper. Seeded-defect check (do it, then revert, and report
  it): change `Math.min(debounce, deadline - at)` in `watcher.ts` `enqueue` to `debounce` — the
  test must fail; restore the file exactly. Acceptance: `rg "sleep\(" test/unit/pipeline.test.ts`
  shows only the negative wait and the helper definition;
  `rg "sleep\(400\)|advanceTimersByTime\(400\)" test/unit/pipeline.test.ts` is empty; the next
  test in the file ("changes no file after a full pipeline run (N2)", real fs) passes in the same
  run. Files: `test/unit/pipeline.test.ts`.
- [x] D3 — **Dead PIDs for N5, plus one real signal-0 test.** New `test/fixtures/pids.ts`
  exporting `deadPids(count: number): number[]`: start at `0x7FFFFFFC`, step down by 4 (Windows
  ignores the low two PID bits), keep each pid for which `isAliveSync` from
  `src/core/registry/liveness.ts` returns false, until `count` are collected. In every N5 site
  — the blocking N5 premise test in `test/unit/pipeline.test.ts` and the N5 perf test under
  `test/perf/` (both from story 023; find them by "N5" / `liveIds`) — replace
  `LIVE_PID + index`: session 0 keeps `LIVE_PID`, sessions 1-5 take `deadPids(5)`, used both
  for `writeRegistry` and the `FakeProbe` alive set (discovery must still list them). Fix the
  comment above the count assertion so it states the truth: all six are listed, the five whose
  PIDs signal 0 reads as dead are `ended`; assert `sessions.length === 6` and exactly 5 with
  `status === 'ended'`. Leave the `LIVE_PID + 1` registry key in the "huge name" discovery test
  and all `new ControlEngine({` sites alone. Add one test inside `describe('registry')` in
  `test/unit/derivations.test.ts`: "signal 0 reads this process as alive and a dead pid as not
  alive" — `isAliveSync(process.pid)` true, `isAliveSync(deadPids(1)[0])` false. Acceptance:
  `rg "LIVE_PID \+ " test/unit/pipeline.test.ts test/perf` finds no N5 line; both N5 tests and
  the new test pass. Files: `test/fixtures/pids.ts`, `test/unit/pipeline.test.ts`,
  `test/perf/*` (023's N5 file), `test/unit/derivations.test.ts`.
- [x] D4 — **One shared fetch stub.** New `test/fixtures/http.ts` exporting
  `stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>)`,
  which builds `vi.fn(async (url, init) => handler(String(url), init))`, installs it with
  `vi.stubGlobal('fetch', spy)` and returns the spy, and `jsonResponse(payload, status = 200)`
  (copy the existing body from `test/unit/updateSource.test.ts`). In
  `test/unit/updateSource.test.ts` and `test/unit/windowSource.test.ts`: delete the local
  `stubFetch`, `jsonResponse` and `originalFetch`, import from `../fixtures/http.ts`, and replace
  `globalThis.fetch = originalFetch` in `afterEach` with `vi.unstubAllGlobals()`. windowSource's
  callers pass a zero-argument handler, which fits the signature. Acceptance:
  `rg "function stubFetch" test/unit` empty; both files import `stubFetch` from the fixture; both
  files' tests pass with the same count as before. Files: `test/fixtures/http.ts`,
  `test/unit/updateSource.test.ts`, `test/unit/windowSource.test.ts`.
- [x] D5 — **One temp-dir helper.** New `test/fixtures/tempDir.ts` exporting
  `makeTempDir(prefix: string): Promise<string>` (`mkdtemp(join(tmpdir(), prefix))`) that also
  registers the path with the fixture-tree cleanup list in `test/fixtures/builders.ts` (export a
  small `registerTempDir(path)` there, or move the list; `cleanupFixtureTrees` in
  `test/setup.ts` stays the single after-all cleanup). Replace the 5 sites: `makeFixtureTree` in
  `test/fixtures/builders.ts`, and the `beforeEach` creations in `test/unit/updateSource.test.ts`,
  `test/unit/windowSource.test.ts`, `test/unit/selfUpdate.test.ts`,
  `test/unit/detailWindowState.test.ts` (that one turns its `beforeEach` async and drops
  `mkdtempSync`). Each file keeps its existing `afterEach` `rm` exactly where it is — only
  creation moves. Do not move the `view()`/`entry()`/`detail()` factories. Add one line each for
  `http.ts`, `pids.ts`, `tempDir.ts` to `test/fixtures/README.md`. Acceptance:
  `rg "mkdtemp(Sync)?\(" test` finds only `tempDir.ts` (the `mkdtemp` name inside the regex in
  `boundaries.test.ts` is a forbidden-call pattern, not a site);
  `rg "function view|function entry|function detail" test/unit` still finds all three;
  `npx vitest run` total equals the D1 baseline + 1 (D3's signal-0 test). Files:
  `test/fixtures/tempDir.ts`, `test/fixtures/builders.ts`, `test/fixtures/README.md`, the four
  test files above.
- [x] D6 — **One Node pin and a timing artifact in CI.** Create `.node-version` containing `22`.
  In `.github/workflows/validate.yml` and `.github/workflows/release.yml`, replace
  `node-version: 22` with `node-version-file: .node-version` (keep `cache: npm`). In
  `CONTRIBUTING.md`, next to "Node 22+ required.", name `.node-version` as the pinned version
  CI uses. Test reporting: in validate.yml the `Test` step runs
  `npm test -- --reporter=default --reporter=json --outputFile.json=test-results/vitest.json`,
  followed by `- uses: actions/upload-artifact@v4` with `if: always()`, `name: vitest-timings`,
  `path: test-results/vitest.json`, `retention-days: 14`, `if-no-files-found: ignore`. In
  release.yml do the same at the release lane's test run as story 024 left it: if it is a
  workflow `Test` step, identical change; if 024 moved `npm test` into `scripts/ci-release.ps1`,
  put the reporter flags on that invocation and the upload step after the `Release` step.
  `test-results/` is already in `.gitignore`. Acceptance: `rg "node-version: 22" .github/workflows`
  empty; `rg -c "node-version-file: .node-version" .github/workflows` and
  `rg -c "upload-artifact" .github/workflows` list both files; the json reporter line runs
  locally (`npm test -- --reporter=default --reporter=json --outputFile.json=test-results/vitest.json`
  exits 0 and writes the file). Files: `.node-version`, both workflows, `CONTRIBUTING.md`,
  possibly `scripts/ci-release.ps1`.

## Model Hints

All Ds default tier: each is a bounded test/CI edit with an explicit acceptance check.

Review: → default

## Acceptance Tests

- AC1 → unit `test/unit/pipeline.test.ts` › "coalesces a burst of events and never waits longer
  than the ceiling" (D2), plus D2's seeded-defect run (ceiling removed in `watcher.ts` → red,
  reverted) and the `rg "sleep\("` check
- AC2 → unit `test/unit/pipeline.test.ts` › "coalesces a burst of events and never waits longer
  than the ceiling" and the following › "changes no file after a full pipeline run (N2)" passing
  in the same run (D2), plus the `rg "sleep\(400\)|advanceTimersByTime\(400\)"` check
- AC3 → unit: the N5 premise test in `test/unit/pipeline.test.ts` (023's name, asserting 6 listed
  / 5 `ended`) and the N5 perf test under `test/perf/` (D3), plus the `rg "LIVE_PID \+ "` check
- AC4 → unit `test/unit/derivations.test.ts` › "signal 0 reads this process as alive and a dead pid
  as not alive" (D3)
- AC5 → unit: the existing `test/unit/updateSource.test.ts` and `test/unit/windowSource.test.ts`
  suites passing on the shared stub (D4), plus the `rg "function stubFetch" test/unit` check
- AC6 → unit: the existing suites of the four files and every `makeFixtureTree` consumer passing
  on `makeTempDir` (D5), plus the `rg "mkdtemp(Sync)?\(" test` check
- AC7 → check: `rg "function view|function entry|function detail" test/unit` finds all three (D5)
- AC8 → check: `.node-version` content, `rg "node-version: 22"` empty, `node-version-file` in both
  workflows, CONTRIBUTING.md names the file (D6)
- AC9 → check: `vitest.config.ts` values and `npm test` exit 0 (D1; re-confirmed by the build gate)
- AC10 → check: reporter flags, `upload-artifact` with `if: always()` and `retention-days: 14` in
  both workflows, plus the local json-reporter run (D6)
- AC11 → check: `npx vitest run` total = D1 baseline 592 + 2 explicit adds (D3 signal-0 test, review-fix guard test for the ended count) = 594

No e2e: every criterion is about tests and CI, nothing the user does in the app.

## Done

Fake timers for the debounce/ceiling test, dead-PID range for N5 (shared `writeColdStartTree`/`assertColdStartPremise` in `test/fixtures/engine.ts`, so blocking and perf N5 both covered) plus a real signal-0 test, shared `stubFetch`/`jsonResponse` (`test/fixtures/http.ts`), one `makeTempDir` (`test/fixtures/tempDir.ts`), `.node-version` pin, `testTimeout` 15 s, vitest JSON timing artifact in both workflows. No `src/` change, no CHANGELOG entry.

Commit message: `026: test hygiene sweep - fake timers, dead PIDs, shared fetch/tempdir helpers, .node-version, 15 s timeout, timing artifact`

Verification (narrow gate: `npm run build`, `npm run typecheck`, `npm test` as test-story; no e2e): all green, 42 files, 594 tests (baseline 592 + signal-0 test + ended-count guard test). Seeded defect (`Math.min` removed in `watcher.ts`) turned the ceiling test red, reverted. Review: PASS, 4 findings fixed in one cycle (ciRelease negative filters, detached comment, stale N5 title, missing negative test for the ended count). AC1-AC11 all mapped to the tests named above and passed; no manual residue.

Decisions: perf.yml also moved to `node-version-file` (AC8's workflow-wide check); temp-dir list lives in `tempDir.ts` (no import cycle) and `ciRelease.test.ts` (a sixth `mkdtempSync` site from 024) converted so AC6 holds; ciRelease assertions carry an `NPM_TEST` constant because `scripts/ci-release.ps1` now passes the reporter flags; `assertColdStartPremise` takes session `status` and expects `liveCount - 1` ended; AC3's `LIVE_PID + 1` huge-name key stays by decision.

tiers: D 6 / hard 0 · review default · cycles 1 · agents 9
