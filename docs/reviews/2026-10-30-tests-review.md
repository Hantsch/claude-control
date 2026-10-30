# Test setup review — 2026-10-30

Commit `5778747` on `dev`, clean tree. Scope: tests and tooling only. The review was triggered
by a release that failed in `release.yml`'s Test step:

```
FAIL test/unit/pipeline.test.ts > engine > resolves the live tier under 2 s against a ~250 MB tree (N5)
AssertionError: expected 2053 to be less than 2000   (pipeline.test.ts:1343)
```

Three reviewers produced 24 raw findings. They merged to 17, and 1 was dropped for missing
evidence. All 17 were checked by a refuter and a value judge (34 agents). The output is draft
stories **023–027**.

How to read it: act on the **story map** (§3) and the **lane decision** (§3b). The **findings
table** (§4) is the evidence behind them.

## 2. Verdict

**The release failure was not a defect.** N5 measured 441 ms when it was built (story 006) and
2053 ms on a shared `windows-latest` runner, 53 ms over a hard 2 s assert. The code is fine. The
test measures the machine.

**What is good.**
- The suite is small and fast: 38 files and 577 tests in 7.99 s wall.
- Nothing is hidden: 0 `.skip`, 0 `.only`, 0 retries, 0 snapshots.
- Every file is run: the vitest include and `find test` agree, so there are no orphan files.
- The core logic is tested against fixtures with a fake probe, and the status machine is table-driven.
- No test reads the real home directory, locale, timezone or registry.
- The PR lane is a real gate: typecheck, the full suite, the notes check and a real package build, on the one OS the app ships on.
- A failing release test leaves nothing committed or tagged.

**Three structural causes explain most findings:**

1. **Wall-clock budgets sit in the blocking suite** (F01, F05, F06). There are 3
   `toBeLessThan(2_000)` asserts on real time (pipeline.test.ts:1149, :1212, :1343), with no
   isolation, no retry and parallel file execution. The project's own rule forbids this:
   `.claude/commands/build.md:177-179` says "a test in `test` never compares elapsed time
   against a number … speed goes to the perf lane". There is no perf lane, and CONTRIBUTING.md
   advertises N4/N5 inside `npm test`. Commit 0c52067 ("race-proof N5/N2") fixed a lost-event
   hang, but its own comment says "the measured window below is unchanged".
2. **The release lane repeats the PR lane blindly** (F02, F03). `release.yml:55-56` runs the
   full suite before `ci-release.ps1` decides whether a release is due, so a docs-only push pays
   the flake exposure too. Further on, a failure between the tag push (`ci-release.ps1:184`) and
   `gh release create` (:194) leaves a tag with no release. A re-run then exits "nothing to
   release" as a success.
3. **Lane rules live only in the AI-scrum prompts** (F08, F04). There is no lane table, no
   per-lane budget and no `CLAUDE.md`. The written rule and the repo practice contradict each
   other, and the per-story gate (`--changed HEAD`) cannot see the 17 tests that read sources as
   text.

**Do first:** story 023 (move the timing budgets out of the blocking lanes). Until it lands,
every release can fail on a slow runner. Re-running the release job is the only workaround
today.

## 3. Story map

| # | Story | Findings | Prio | Effort | After |
|---|---|---|---|---|---|
| [023](../requirements/023-timing-budgets-leave-the-blocking-suite.md) | Timing budgets leave the blocking suite | F01, F05, F11 (part) | P1 | S–M | — |
| [024](../requirements/024-release-lane-tests-only-a-due-release.md) | The release lane tests only a due release and recovers a tag without a release | F02, F03 | P1 | S | — |
| [025](../requirements/025-test-lanes-are-written-down.md) | Test lanes are written down, and the story gate runs the whole suite | F08, F04 | P2 | S | 023, 024 |
| [026](../requirements/026-test-hygiene-sweep.md) | Test hygiene: fake timers, dead PIDs, shared helpers, one Node pin, tighter timeouts, timing artifact | F06, F10, F12, F13, F15, F07 | P3 | M | 023 |
| [027](../requirements/027-source-text-wiring-tests-pruned.md) | Source-text wiring tests pruned to structural checks | F09 | P3 | S–M | — |

**Suggested cut:**
- **Sprint A** = 023 + 024. It can be shown on its own: N4/N5 run only under
  `npm run test:perf`, a `docs:` push to main runs no tests, and the release job passes on
  `windows-latest`.
- **Sprint B, or opportunistic** = 025, then 026 and 027.

## 3b. Test lanes

| Lane | Trigger | Runs | Blocks | Budget (proposed) |
|---|---|---|---|---|
| Story (local) | `/build` | `npm test` (whole suite) | the story | ≤ 30 s |
| PR | `validate.yml` | typecheck, `npm test`, check-notes, package | the merge | `npm test` ≤ 30 s |
| Release | `release.yml` | plan, then, only when a release is due, `npm test` and ci-release | the release | same; 0 s when nothing releases |
| Perf | `npm run test:perf`, local plus `workflow_dispatch` | N4/N5 strict 2 s, `fileParallelism: false` | nothing; reports | — |

| Tests | From | To | Why | Seconds saved | Finding | Story |
|---|---|---|---|---|---|---|
| N5 `< 2_000` plus 250 MB tree (pipeline.test.ts:1226-1343) | PR, release | perf | runner-speed budget; blocked the release | 3–6 (estimate) | F01, F05 | 023 |
| N4 `< 2_000` (:1149) and registry flip `< 2_000` (:1212) | PR, release | perf; the blocking test keeps the functional check | same cause, next to fail | ~0 | F01 | 023 |
| N5 premise guards (:1297-1338) | inside the timing test | own test in `npm test`, tree ≤ 50 MB | a timing red must not read like a pipeline bug | (in the above) | F05 | 023 |
| Debounce/ceiling test (:1348-1384) | real `sleep()` | fake timers, still in PR | 150 ms real slack | ~1.6 | F06 | 026 |
| `npm test` in release.yml:55-56 | before plan | after plan, only when bump ≠ none | second flake exposure on non-release pushes | ~8 per non-release push | F02 | 024 |
| `test-story: --changed HEAD` | module-graph subset | `npm test` | misses the 17 text-reading tests | costs 8 s per story | F04 | 025 |

**Minutes before → after:**
- PR `npm test`: 7.99 s measured → about 2–4 s estimated.
- Release: always the full suite → the suite only when a release is due.
- Timing asserts in blocking lanes: 3 → 0.

CI job minutes are **not measured**: there is no `gh` CLI here and no earlier test-review report.

## 4. Findings

Check legend:
- `refuter`: survived the refuter. "partly" means the refuter corrected it, and the severity
  shown is the corrected one.
- `judged`: value judge only.
- `refuted`: the refuter disproved it.
- `reviewer-only`: unverified.

| Id | Sev | Finding | Check | Story |
|---|---|---|---|---|
| F01 | high | Three hard 2000 ms wall-clock asserts (pipeline.test.ts:1149/1212/1343) gate PR and release on runner speed | refuter (stands) | 023 |
| F02 | medium (was high) | release.yml runs the full suite before the plan can exit with bump=none | refuter (stands) | 024 |
| F03 | medium | A failure between `git push --follow-tags` and `gh release create` leaves a tag with no release; a re-run reports success | refuter (stands) | 024 |
| F08 | medium | No lane table or budgets; the existing rule (build.md:177-179, sprint.md:335-357) contradicts CONTRIBUTING.md and practice | refuter (partly: a flake policy exists in the prompts) | 025 |
| F04 | low (was medium) | `--changed HEAD` misses the 17 tests that read sources as text (the "empty after commit" claim was wrong: the gate runs before the commit) | refuter (partly) | 025 |
| F05 | low (was medium) | N5 writes ~262 MB per run, swallows cleanup errors and bundles premise guards into the timing test | refuter (partly) | 023 |
| F06 | low (was medium) | The debounce test mixes an injected clock with real `sleep()`; the false-red claim was refuted, the waste stands | refuter (partly) | 026 |
| F07 | low (was medium) | No per-test timing artifact in CI; the N5 number lives only in a console.log | refuter (partly) | 026 |
| F09 | low (was medium) | Eight source-text wiring tests assert JSX/CSS strings | refuter (partly) | 027 |
| F10 | low (was medium) | N5 fabricates `process.pid + k` as dead sessions | refuter (partly) | 026 |
| F11 | low (was medium) | pipeline.test.ts and derivations.test.ts hold 28.5 % of the suite's lines | refuter (partly) | 023 (timing half only) |
| F12 | low (was medium) | Two `stubFetch` copies and five temp-dir creators (the view/entry/detail factories are single-use) | refuter (partly) | 026 |
| F13 | low | `node-version: 22` pinned in two workflows, no `.node-version` | refuter (stands) | 026 |
| F15 | low | 30 s / 60 s / 180 s timeouts against a 7.99 s suite | refuter (partly) | 026 |
| F14 | low | Typecheck runs twice in validate and locally | refuter (stands) | — |
| F16 | low | Agent budget and registry-idle rules tested at several layers | refuter (partly) | — |
| F17 | low | Tray pixel thresholds are scattered literals | refuter (partly) | — |

**Left out on purpose:**
- **F14:** the value judge said skip. The duplicate `tsc` run costs seconds, and the early
  fail-fast typecheck is worth keeping.
- **F16:** skip. The layers test different things (the threshold rule, subagent-file evidence,
  end-to-end exactly-once notification), so pruning would lose coverage.
- **F17:** skip. The thresholds are loose black/white sanity bounds on deterministic mocked
  pixels, and naming them would add coupling.
- **F11, the rest of the split:** 023 moves the timing cases out. Splitting the remaining
  pipeline.test.ts and derivations.test.ts is opportunistic and has no story.
- **Dropped at merge:** the claim that the README promises for autostart, the global hotkey,
  toasts and settings persistence have no test in `npm test`. It had no `file:line` evidence.
  Re-raise it with line citations if it matters; it is also the known e2e gap in
  `.claude/ai-scrum.md`.

## 5. Method and limits

**Dimensions and models:**
- lanes and gates: sonnet
- suite value: sonnet
- runtime and flakiness: sonnet
- merge: opus
- refuter and value judge per finding: sonnet

**Agents and minutes per phase:**

| Phase | Agents | Minutes |
|---|---|---|
| Review | 3 | 3 (suite value re-asked once: its first write failed silently) |
| Merge | 1 | 5 (run twice for that reason) |
| Verify | 34, in 2 batches of 20 and 14 | 4 |
| Report and lanes | — | about 2 |
| Stories | 1 | 3 |

**Coverage and limits:**
- Unverified ids: none.
- Commit `5778747`, branch `dev`, tree clean at the start.
- Not covered:
  - CI history, because there is no `gh` CLI. Per-test durations are estimates from code, and
    the only measured figure is the user's failing run.
  - Whether `main` is a protected branch with `validate` as a required check. That lives in
    GitHub settings, not in the repo.
  - The renderer UI's real behaviour. There is no e2e or jsdom harness.
  - Any source file outside `test/`, the workflows, `scripts/` and the docs the reviewers cited.
- No reviewer ran a suite.
