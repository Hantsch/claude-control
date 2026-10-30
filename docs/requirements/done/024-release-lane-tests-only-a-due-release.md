---
id: 024
title: The release lane tests only a due release and recovers a tag without a release
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The maintainer releases by merging to main and expects that a push which releases nothing costs
nothing, and that a release which stops half way can be finished by re-running the job.

Today ([review 2026-10-30](../reviews/2026-10-30-tests-review.md), F02, F03):
- `.github/workflows/release.yml:55-56` runs `npm test` (577 tests, 38 files) before
  `scripts/ci-release.ps1`, whose plan can end in `bump=none -> exit 0` (:86-91). A `chore:` or
  `docs:` only push to main pays the whole suite, and its flake exposure, then releases nothing.
  The reported N5 failure (expected 2053 to be less than 2000, pipeline.test.ts:1343) hit exactly
  this step. Nothing is committed, tagged or pushed before :181-184, so a failure is clean but has
  no skip path. No file says why the second run exists (the step came in with the first commit,
  f4938e0, without a comment); a valid reason is that the merge result is otherwise untested.
  Corrected severity: medium.
- `ci-release.ps1:181-184` commits, tags and runs `git push --follow-tags` before
  `gh release create` at :194. If :194 fails, a re-run plans from the new tag, gets `bump=none`
  (:86-91) and exits green with a tag and no release; the `[skip ci]` guard (release.yml:39) blocks
  any retrigger, and a forced bump would cut a new version instead of the stuck one. Recovery is a
  manual `gh release create`, although CONTRIBUTING.md:62 promises that merging releases. The
  in-app updater (019) would not see that version. Severity medium; the window is narrow (one `gh`
  call after a successful push).

## Acceptance Criteria

- [x] **AC1** — In `release.yml` (and the matching step order in `ci-release.ps1`), the plan runs
      before `npm test`: the `Test` step's line number is greater than the plan step's, checked by
      a script or `rg -n` in the story's acceptance test
- [x] **AC2** — A dry run of the release script with a push that yields `bump=none` (only `docs:`
      or `chore:` commits since the last tag) exits 0 without starting `npm test` (the script's
      output contains "nothing to release" and no vitest output)
- [x] **AC3** — A dry run with a due release (a `feat:` or `fix:` commit since the last tag) runs
      `npm test` exactly once before the commit/tag step
- [x] **AC4** — `release.yml` or `ci-release.ps1` carries a comment next to the remaining test run
      stating why it exists (the merge result is not otherwise tested); `rg -n -i "merge"` over
      the two files finds that comment
- [x] **AC5** — When HEAD carries a `v*` tag and `gh release view <tag>` fails, the script skips
      plan, version bump, commit, tag and push, and runs only build, SHA256SUMS, notes and
      `gh release create` for that tag; proven by a dry-run scenario (tag at HEAD, release absent)
      whose output names the recovery path and exits 0
- [x] **AC6** — When HEAD carries a `v*` tag and the release exists, the script still exits 0 with
      "nothing to release" and creates nothing
- [x] **AC7** — The recovery path takes its release notes from the CHANGELOG section of that
      version; a dry run prints that section's heading
- [x] **AC8** — The `Invoke-Git push` step in `ci-release.ps1` is safe to repeat: a second push of
      an already pushed commit and tag exits 0

## Open Questions

- ~~**Make `validate` a required check instead?**~~ answered → Decisions (Sprint) (User)
- ~~**Draft-then-push reorder (F03's first option)?**~~ answered → Decisions (Sprint) (User: recovery branch)
- ~~**Where does the plan run?**~~ answered → Decisions (Sprint)
- ~~**Test for the script?**~~ answered → Decisions (Sprint)
- ~~**CONTRIBUTING.md fallback note.**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Release lane: keep one test run for a real release and recover a tag-without-release by a re-run (recovery branch); `validate` is not made a required check.
- **Plan location:** `npm test` moves into `ci-release.ps1`, after the version decision (the `bump=none` exit) and before `release.ps1` touches any file; `release.yml` loses its `Test` step. Reason: AC2/AC3 describe the script's own dry run skipping or running the suite, which only works if the script owns the call, and testing before the bump tests the merge result exactly as merged.
- **AC1 reading:** with the test inside the script, AC1 is checked as "release.yml has no `npm test` step, and in `ci-release.ps1` the `npm test` call comes after the `nothing to release` exit and before the first `Invoke-Git`". Reason: that is the same "plan before test" ordering the AC states, on the file that now holds both.
- **Tests run on every due path:** derived bump, `-ForceBump`, `-Version` and the first (bootstrap) release all run `npm test`; only `bump=none` and the recovery path skip it. Reason: the recovered commit was tested in the run that tagged it; every other path publishes new code.
- **HEAD-tag check runs first, regardless of `-Version`/`-ForceBump`, via `git tag --points-at HEAD --list 'v*'`, never `git describe`.** Reason: a tagged HEAD is a release commit, a forced bump from it would cut a new version over the stuck one (F03), and an older reachable tag must not count.
- **"Release absent" = any non-zero exit of `gh release view <tag>`.** Reason: on a real outage the following `gh release create` fails loudly anyway, and `create` cannot duplicate an existing release.
- **Recovery checks package.json:** its version must equal the tag's version, else the run throws. Reason: the recovery builds from the working tree and must not ship an EXE whose metadata disagrees with the tag.
- **Proof = a vitest harness over the real script:** `test/unit/ciRelease.test.ts` copies `scripts/*.ps1` into a temp git repo (bare origin + clone), puts stub `npm.cmd`/`gh.cmd` first on `PATH` that log their arguments, and runs `ci-release.ps1` with `pwsh` (fallback `powershell`). Reason: AC2-AC8 are behaviour of the script, `-DryRun` alone never reaches `gh release create`, and a manual residue has no real reason here (no OS dialog, no paid service).
- **AC5 is proven by a real (stubbed-`gh`) re-run as well as a dry run:** one scenario reproduces F03 end to end (create fails after the push, the re-run recovers). Reason: that is the failure the story exists for; the dry run alone would not show a release actually being created.
- **CONTRIBUTING.md note rides along** (the release job tests only a due release; a stuck tag is finished by re-running the job, a manual `gh release create` is the last resort). Reason: CONTRIBUTING.md:62 promises "merging releases" and would otherwise go stale; it is two sentences.
- **No CHANGELOG entry.** Reason: CI-internal; nothing changes for the app's user.

## Plan

1. **D1: test only a due release.** In `scripts/ci-release.ps1`, insert a `=== test ===` block
   after the version decision (after the `bump=none` `exit 0`, line ~93) and before
   `release.ps1` (line ~106): `npm test` in `$repoRoot`, throw on non-zero exit, with a comment
   saying it is the only test of the merge result on main (a direct push has no PR). Remove the
   `Test` step from `.github/workflows/release.yml`. Update the script's `.DESCRIPTION`/`-DryRun`
   help. Build the harness `test/unit/ciRelease.test.ts` with the first scenarios (bump=none dry
   run, feat dry run, structural order check).
2. **D2: recover a tag without a release.** At the top of `ci-release.ps1` (before the plan):
   if HEAD carries a `v*` tag, ask `gh release view <tag>`. Exists → "nothing to release",
   exit 0. Absent → recovery: notes from the CHANGELOG `## <version>` section, `npm run package`,
   SHA256SUMS + self-check, download hint, `gh release create` (printed in dry run). The
   build/sums/hint/create tail becomes functions both paths call, so there is no second copy.
   CONTRIBUTING.md "Releasing" gets the recovery sentences. Scenarios go into the same test file.

Affected files: `scripts/ci-release.ps1`, `.github/workflows/release.yml`, `CONTRIBUTING.md`,
`test/unit/ciRelease.test.ts` (new). `scripts/release.ps1` and `scripts/plan-release.ps1` stay
unchanged. Order: D1 then D2 (D2 extends D1's harness). No systems doc covers the release lane.
Cost note: each scenario spawns PowerShell (~1-2 s); keep to the scenarios listed, in one file.

## Deliverables

- [x] **D1 — The release job tests only a due release** (AC1, AC2, AC3, AC4).
  Files: `scripts/ci-release.ps1`, `.github/workflows/release.yml`, `CONTRIBUTING.md`,
  `test/unit/ciRelease.test.ts` (new).
  - `ci-release.ps1`: a new block `=== test ===` after the version decision (`if ($Version) …
    elseif (-not $hasTag) … else { … if ($bump -eq 'none') { … exit 0 } }`) and before the
    `=== version + notes ===` block that calls `release.ps1`. It runs `npm test` with
    `$repoRoot` as working directory (`Push-Location`/`Pop-Location` in `try/finally`) and
    throws `"npm test failed with exit code …"` on non-zero. It runs in `-DryRun` too. A comment
    directly above it must contain the word "merge" and say why it exists: the merge result on
    main is not otherwise tested (a direct push has no PR; `validate.yml` tests the PR head).
    Update `.DESCRIPTION` (new step "tests") and the `-DryRun` help (tests still run).
  - `release.yml`: delete the `- name: Test` / `run: npm test` step (lines 55-56). Nothing else.
  - `CONTRIBUTING.md` "### Releasing": one sentence that the release job runs `npm test` only
    when a release is due (a `docs:`/`chore:`-only merge runs no tests).
  - Harness in `test/unit/ciRelease.test.ts` (one file, helpers local to it): `makeFixture()`
    creates a temp dir with a bare `origin.git` and a clone; copies `scripts/ci-release.ps1`,
    `plan-release.ps1`, `release.ps1` into `<clone>/scripts/`; writes a minimal `package.json`
    (`"name": "claude-control"`, `"version": "1.0.0"`), a `package-lock.json` with the matching
    root (`"name": "claude-control", "version": "1.0.0"`), a `CHANGELOG.md` with a
    `## Unreleased` bullet and a `## 1.0.0 — 2026-01-01` section; sets `git config
    user.name/email`; commits, tags `v1.0.0` (annotated), pushes with tags. A `bin/` dir
    prepended to `PATH` holds `npm.cmd` and `gh.cmd` stubs (`@node "%~dp0stub.mjs" <name> %*`)
    that append `<name> <args>` to a log file; `npm run package` additionally creates
    `release/ClaudeControl-<package.json version>-portable.exe`; the exit codes of
    `gh release view` / `gh release create` come from env vars. Run the script with `pwsh` if
    on PATH, else `powershell`, args `-NoProfile -ExecutionPolicy Bypass -File
    scripts/ci-release.ps1 [...]`, `cwd` = clone; capture stdout+stderr and the exit code.
    Remove the temp dir in `afterEach`.
  - Tests (names carry the behaviour):
    - "a docs-only push releases nothing and runs no tests": add a `docs:` commit, `-DryRun` →
      exit 0, output contains "nothing to release", stub log has no `npm test`.
    - "a due release runs the suite once before anything is committed": add a `feat:` commit
      (tag `v1.0.0` stays on the earlier commit), `-DryRun` → exit 0, stub log has exactly one
      `npm test` line and it precedes `npm run package`; in the output `=== test ===` precedes
      the first `[dry-run] git commit` line.
    - "the release workflow leaves testing to the script and says why": `release.yml` contains
      no `npm test`; in `ci-release.ps1` the `npm test` line number is greater than the
      `nothing to release` line and smaller than the first `Invoke-Git @(` call line, and one of
      the 3 lines above it matches `/merge/i`.
- [x] **D2 — A tag without a release is finished by a re-run** (AC5, AC6, AC7, AC8).
  Files: `scripts/ci-release.ps1`, `CONTRIBUTING.md`, `test/unit/ciRelease.test.ts`.
  - `ci-release.ps1`, before `=== plan ===`: `$headTag` = first of
    `git -C $repoRoot tag --points-at HEAD --list 'v*' --sort=-v:refname` (never
    `git describe`: an older reachable tag must not count). The check runs regardless of
    `-Version`/`-ForceBump`. If a tag is found:
    - `& gh release view $headTag` (also in dry run: it is read-only; discard its output).
      Exit 0 → print `-> nothing to release: <tag> is already released`, the same step-summary
      line as the `bump=none` path, `exit 0`.
    - Non-zero → print `=== recover ===` and `-> <tag> has no GitHub release - recovering it`.
      Read package.json's version; throw if `v<version>` ≠ `$headTag`. Extract the CHANGELOG
      section whose heading matches `^##\s+\[?<escaped version>\]?(\s|$)` up to the next `^## `
      heading; throw if missing or empty; print `  notes from CHANGELOG: <heading line>`; write
      the section body (without the heading) to the temp notes file. Then run the shared tail
      and `exit 0`. No plan, no `release.ps1`, no `npm test`, no `Invoke-Git`.
  - Shared tail: move the existing build (`npm run package` + artifact check), SHA256SUMS
    write + self-check, download-hint append and `gh release create` (dry-run print) into
    functions (e.g. `Build-Artifact`, `Write-Sums`, `Add-DownloadHint`, `Publish-Release`)
    called by both the normal and the recovery path; the normal path keeps its
    commit/tag/push between hint and publish. No duplicated copy of these blocks.
  - `CONTRIBUTING.md` "### Releasing": if a release stops after the tag push (tag, no GitHub
    release), re-run the release job: it recognises the tag at HEAD and publishes the missing
    release from that version's CHANGELOG section; `gh release create` by hand is the last
    resort.
  - Tests in `test/unit/ciRelease.test.ts`, reusing D1's `makeFixture()`:
    - "a tag whose release creation failed is published by re-running the job": add a `feat:`
      commit; run **without** `-DryRun`, `gh release create` stubbed to fail → non-zero exit,
      `origin.git` has tag `v1.1.0` and the release commit. Then `git push --follow-tags` again
      in the clone → exit 0 (a repeated push is safe). Then re-run the script (no dry run) with
      `gh release view` failing and `create` succeeding → exit 0; output contains
      `=== recover ===` and `notes from CHANGELOG: ## 1.1.0`; the stub log of this run has no
      `npm test`, exactly one `npm run package` and exactly one `gh release create v1.1.0 …`;
      HEAD and the tags of `origin.git` are unchanged by the re-run.
    - "recovery in a dry run names the path and prints the version's notes heading": tagged
      state, `-DryRun`, `gh release view` failing → exit 0, output contains `=== recover ===`,
      `notes from CHANGELOG: ## 1.1.0` and the `[dry-run] gh release create v1.1.0` line.
    - "a tag that already has its release is left alone": tagged state, `gh release view`
      succeeding → exit 0, "nothing to release", stub log has no `npm` and no
      `gh release create`.
    - Reach the "tagged state" cheaply in the fixture: set package.json/package-lock/CHANGELOG
      to 1.1.0 by hand (`## 1.1.0 — 2026-02-01` with a bullet), commit
      `chore(release): 1.1.0 [skip ci]`, tag `v1.1.0` (annotated), push with tags.

## Model Hints

- D2 → deliverable-hard: the recovery branch runs only on `main` in CI and decides between
  "publish" and "do nothing" from git/gh state; a subtly wrong tag query (`describe` instead of
  `--points-at`), a swallowed `gh` exit code or a half-extracted shared tail would re-publish,
  silently skip a release, or break the normal path that D1's tests also drive.
- Review: → default

## Acceptance Tests

- AC1 → unit `test/unit/ciRelease.test.ts` › "the release workflow leaves testing to the script and says why"
- AC2 → unit `test/unit/ciRelease.test.ts` › "a docs-only push releases nothing and runs no tests"
- AC3 → unit `test/unit/ciRelease.test.ts` › "a due release runs the suite once before anything is committed"
- AC4 → unit `test/unit/ciRelease.test.ts` › "the release workflow leaves testing to the script and says why"
- AC5 → unit `test/unit/ciRelease.test.ts` › "a tag whose release creation failed is published by re-running the job" (real path) and › "recovery in a dry run names the path and prints the version's notes heading" (dry run)
- AC6 → unit `test/unit/ciRelease.test.ts` › "a tag that already has its release is left alone"
- AC7 → unit `test/unit/ciRelease.test.ts` › "recovery in a dry run names the path and prints the version's notes heading"
- AC8 → unit `test/unit/ciRelease.test.ts` › "a tag whose release creation failed is published by re-running the job" (the repeated `git push --follow-tags` step)

No e2e: nothing here is a user action in the app (sprint note), so the missing harness
(`e2e: none`) is no gap for this story.

## Done

The release job now tests only a due release: `npm test` moved from `release.yml` into `ci-release.ps1` after the `bump=none` exit. A tag at HEAD without a GitHub release is recovered by a re-run (notes from that version's CHANGELOG section, shared build/sums/hint/publish functions); with a release it exits "nothing to release". A vitest harness drives the real script in a temp repo with stubbed npm/gh.

Commit message: `024: release lane tests only a due release, re-run recovers tag without release`

Verification (narrow gate: `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD`; all green, 6 tests in ciRelease.test.ts; full gate pending in sprint). Review 1 (default) found weak tests (AC6, AC7, AC1 line lookup, AC8 repeated push); strengthened, re-run green.
AC -> test (all in `test/unit/ciRelease.test.ts`, passed): AC1/AC4 "the release workflow leaves testing to the script and says why"; AC2 "a docs-only push releases nothing and runs no tests"; AC3 "a due release runs the suite once before anything is committed"; AC5 "a tag whose release creation failed is published by re-running the job" + "recovery in a dry run names the path and prints the version's notes heading"; AC6 "a tag that already has its release is left alone"; AC7 dry-run recovery test; AC8 real-path test (repeats the script's own push args). No manual residue.

Decisions:
- The recovery path does no git writes, so AC8's repeat is proven by re-running the push args parsed from the script, not by re-running the script's push step.
- `makeFixture()` pushes with `-u` so the script's bare `git push --follow-tags` has a target (as in CI checkouts).
- `gh release view` check uses a local `ErrorActionPreference='Continue'` (PS 5.1 turns native stderr into a terminating error); missing `gh` throws rather than reading as "absent".
- Not covered by tests (decisions, not ACs): package.json-vs-tag mismatch throw, missing/empty CHANGELOG section throws.
- No CHANGELOG entry (CI-internal).

tiers: D 2 / hard 1 · review default · cycles 1 · agents 6
