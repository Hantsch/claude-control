---
id: 024
title: The release lane tests only a due release and recovers a tag without a release
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — In `release.yml` (and the matching step order in `ci-release.ps1`), the plan runs
      before `npm test`: the `Test` step's line number is greater than the plan step's, checked by
      a script or `rg -n` in the story's acceptance test
- [ ] **AC2** — A dry run of the release script with a push that yields `bump=none` (only `docs:`
      or `chore:` commits since the last tag) exits 0 without starting `npm test` (the script's
      output contains "nothing to release" and no vitest output)
- [ ] **AC3** — A dry run with a due release (a `feat:` or `fix:` commit since the last tag) runs
      `npm test` exactly once before the commit/tag step
- [ ] **AC4** — `release.yml` or `ci-release.ps1` carries a comment next to the remaining test run
      stating why it exists (the merge result is not otherwise tested); `rg -n -i "merge"` over
      the two files finds that comment
- [ ] **AC5** — When HEAD carries a `v*` tag and `gh release view <tag>` fails, the script skips
      plan, version bump, commit, tag and push, and runs only build, SHA256SUMS, notes and
      `gh release create` for that tag; proven by a dry-run scenario (tag at HEAD, release absent)
      whose output names the recovery path and exits 0
- [ ] **AC6** — When HEAD carries a `v*` tag and the release exists, the script still exits 0 with
      "nothing to release" and creates nothing
- [ ] **AC7** — The recovery path takes its release notes from the CHANGELOG section of that
      version; a dry run prints that section's heading
- [ ] **AC8** — The `Invoke-Git push` step in `ci-release.ps1` is safe to repeat: a second push of
      an already pushed commit and tag exits 0

## Open Questions

- **Make `validate` a required check instead?** The report offered: drop the release-lane test and
  make `validate` a required status check on main. The value judge preferred keeping one run for
  real releases (a direct push to main has no PR, and the merge result is otherwise untested) and
  not adding required-check config in the same change. Whether `main` is protected is GitHub
  settings, not in the repo, and was not checked.
- **Draft-then-push reorder (F03's first option)?** The value judge preferred the recovery branch:
  `gh release create --draft` before the tag exists adds an orphan draft and a `--target` SHA that
  must be pushed first. Confirm the recovery branch is the chosen cut.
- **Where does the plan run?** A plan-only workflow step before `Test`, or `npm test` moved into
  `ci-release.ps1` after the `bump=none` exit (:86-91) and before :181-184. Decide in refine.
- **Test for the script?** `ci-release.ps1` has no test and `-DryRun` exits before
  `gh release create`, so the recovery branch is not covered by it. The value judge left a
  PowerShell harness out; decide how AC5-AC8 are proven (dry-run scenarios, or a manual residue).
- **CONTRIBUTING.md fallback note.** A short note on the manual `gh release create` fallback is P3
  and trivial; decide whether it rides along.

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 024` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 024`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 024`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 024`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build 024` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
