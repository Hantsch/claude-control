---
id: 025
title: Test lanes are written down, and the story gate runs the whole suite
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

A developer or an AI-scrum agent who adds a test or a gate needs one project-level place that says
which lane runs what, what blocks, and how long each may take, so the next test is measured against
a written rule and not against YAML. Today the rule exists only inside the AI-scrum prompts, and it
contradicts the project-facing docs. The per-story gate should also run what the sprint gate runs,
so a story cannot pass its own gate and break a boundary test.

Today ([review 2026-10-30](../reviews/2026-10-30-tests-review.md), F08, F04):
- 0 documents give a lane table or a per-lane duration budget; no `CLAUDE.md` exists
  (`.claude/ai-scrum.md:145`: "no CLAUDE.md yet in this project") and `.claude/skills/` is absent.
- The rule is written, but only in the command prompts: `.claude/commands/build.md:177-179` (a test
  in `test` never compares elapsed time against a number; speed goes to a perf lane) and :341, and
  a flake policy at `.claude/commands/sprint.md:335-357` (flaky-first rerun, never silenced,
  quarantine list, follow-up story after two sprints), plus `docs/sprints/README.md:66`. The
  refuter corrected the review: the flake policy exists and must be surfaced, not duplicated.
- `CONTRIBUTING.md:55-58` still advertises N4/N5 inside `npm test`, contradicting build.md. The lane
  description is only at CONTRIBUTING.md:72-75. Severity medium.
- `.claude/ai-scrum.md:44` sets `test-story: npx vitest run --changed HEAD`. 17 of 38 test files
  read sources as text (`readFile`/`readFileSync`), which the module-graph selection cannot see
  (boundaries, detailWindowWiring, statusRollupWiring, theme). The refuter corrected the severity
  to low and the "empty after the story commit" claim: the gate runs before the commit, so the cost
  is a late catch at the sprint gate and a bisect. The whole suite takes 7.99 s, so the subset
  saves nothing.

This story follows 023 (the perf lane) and 024 (the release order), so the table records real
choices.

## Acceptance Criteria

- [x] **AC1** — `CLAUDE.md` exists at the repo root with a `## Test lanes` heading:
      `rg -n "^## Test lanes" CLAUDE.md` returns one line
- [x] **AC2** — The table has one row each for Story, PR, Release and Perf, with columns lane,
      trigger, runs, blocks and budget, matching review §3b / 4-lanes.md (Story `npm test` at most
      30 s, PR `npm test` at most 30 s, Release 0 s when nothing releases, Perf non-blocking)
- [x] **AC3** — Every command named in the table exists: `npm test` and `npm run test:perf` are
      keys in package.json `scripts`, and `.github/workflows/release.yml` and `validate.yml` exist
- [x] **AC4** — `CLAUDE.md` links to the flake policy in `.claude/commands/sprint.md` (the section
      carrying lines 335-357) and does not restate its steps: `rg -c "quarantine" CLAUDE.md`
      returns at most 1
- [x] **AC5** — `CONTRIBUTING.md` no longer says N4/N5 run in `npm test`: `rg "N4|N5" CONTRIBUTING.md`
      returns only lines that also name `test:perf`
- [x] **AC6** — `.claude/ai-scrum.md` has `test-story: npm test`; `rg "changed HEAD" .claude/ai-scrum.md`
      returns nothing
- [x] **AC7** — The "Context to read before coding" list in `.claude/ai-scrum.md` names `CLAUDE.md`,
      and `rg "no CLAUDE.md yet" .claude/ai-scrum.md` returns nothing
- [x] **AC8** — `docs/sprints/README.md` (around :55-61) says the per-story gate runs the full unit
      suite and the sprint gate adds e2e: `rg "full unit suite" docs/sprints/README.md` finds it

## Open Questions

- ~~**CLAUDE.md or a `test-gates` skill?**~~ answered → Decisions (Sprint)
- ~~**Does the budget column stay "proposed"?**~~ answered → Decisions (Sprint)
- ~~**Drift.**~~ answered → Decisions (Sprint)
- ~~**Order.**~~ answered → Decisions (Sprint)
- **Not in scope (judge's cut):** `--changed <sprint base>`, CI timing collection, enforcement
  tooling, a full test-gates skill.

## Decisions (Sprint)

- **(User, via 023)** The perf lane runs on a weekly schedule plus `workflow_dispatch`; no timing
  number in blocking tests. The Perf row records exactly that.
- **(User, via 024)** The release lane keeps one `npm test` run for a due release and recovers a
  tag without a release by a re-run; `validate` is not a required check. The Release row records that.
- A hand-written `CLAUDE.md` (about 25-40 lines), no `test-gates` skill: AC1 names `CLAUDE.md`, and
  it reaches every agent via the profile's context list while a skill is not read by default.
- Budgets are written as targets, not limits: they rest on one local measurement (7.99 s) and no CI
  minutes, and enforcing a wall-clock number in a blocking lane is exactly what 023 removes; one
  line under the table says exceeding a budget opens a story.
- Drift is guarded by one unit test in `npm test` that checks the table's shape and that every
  command and workflow it names exists; no YAML-to-table comparison script, since enforcement
  tooling is out of scope and existence is what goes stale first.
- That drift test reads docs and config as text on purpose: it links one artifact to another
  (like `networkPromiseWording`, which 027 keeps), it does not pin copy or call shape.
- AC8 is proven by its `rg` command in the gate, recorded in Done, not by a permanent test:
  `docs/sprints/README.md` is generated by `/ai-scrum:setup`, and a test pinning it would go red on
  every plugin regeneration of a file the project does not own; the durable statement is in `CLAUDE.md`.
- Order confirmed: S07 builds 023 and 024 before 025, so the N5 flake fix lands before the
  per-story gate widens to `npm test`.
- Plugin-managed prompts (`.claude/commands/*.md`) are not edited; `CLAUDE.md` links to them.

## Plan

Triage: clear and ready (docs + profile + one drift test; no source code). Built after 023/024,
so `npm run test:perf`, the perf workflow and the reworked `release.yml` already exist.

1. **D1 — `CLAUDE.md` + drift test.** New `CLAUDE.md` at the repo root: one-line purpose, a
   `## Test lanes` table (Story / PR / Release / Perf × lane, trigger, runs, blocks, budget), a
   targets note, the clock rule in one line, one link to the flake policy section of
   `.claude/commands/sprint.md`. New `test/unit/testLanes.test.ts` guards shape and existence.
2. **D2 — the story gate runs the whole suite.** `.claude/ai-scrum.md`: `test-story: npm test`,
   context list names `CLAUDE.md`. `CONTRIBUTING.md:55-58`: N4/N5 move to `npm run test:perf`.
   `docs/sprints/README.md` (~:55-57): per-story gate = full unit suite. Same test file gets the
   profile and CONTRIBUTING checks.

Files: `CLAUDE.md` (new), `test/unit/testLanes.test.ts` (new), `.claude/ai-scrum.md`,
`CONTRIBUTING.md`, `docs/sprints/README.md`. No systems doc exists for testing; no CHANGELOG
entry (nothing user-facing).

## Deliverables

- [x] **D1 — `CLAUDE.md` with the lane table, guarded by a drift test.**
  Files: `CLAUDE.md` (new, repo root), `test/unit/testLanes.test.ts` (new; mirror the
  `ROOT`/`read()` shape of `test/unit/networkPromiseWording.test.ts`).
  `CLAUDE.md`, about 25-40 lines (it is pasted into every agent prompt, keep it short):
  - `# claude-control — project rules` plus one line pointing to `CONTRIBUTING.md` for setup.
  - `## Test lanes` with a markdown table, header exactly `| Lane | Trigger | Runs | Blocks | Budget |`,
    rows in this order (read `package.json`, `.github/workflows/validate.yml`, `release.yml` and
    the perf workflow first and write what they really do):
    - Story — `/build` (local) — `npm test` (whole suite) — the story — ≤ 30 s
    - PR — `.github/workflows/validate.yml` — typecheck, `npm test`, check-notes, package — the
      merge — `npm test` ≤ 30 s
    - Release — `.github/workflows/release.yml` — plan; only when a release is due (or a tag lacks
      its release, recovered by a re-run): `npm test`, then ci-release — the release — `npm test`
      ≤ 30 s; 0 s when nothing releases
    - Perf — `npm run test:perf` locally, plus the workflow under `.github/workflows/` that runs it
      (weekly schedule + `workflow_dispatch`; name the real file) — N4/N5 strict 2 s budgets,
      `fileParallelism: false` — nothing; reports — none (non-blocking)
  - One line under the table: budgets are targets from one local measurement (7.99 s); exceeding
    one opens a story, nothing enforces it.
  - One line: a test in `npm test` never compares elapsed time against a number; a speed budget
    goes to `test/perf/`, cost is proven by counting (bytes, calls).
  - One line linking the flake policy:
    `[flake policy](.claude/commands/sprint.md#phase-2b--regression-gate-mandatory-after-the-last-story-before-the-review)`
    — link only, do not restate its steps; the word "quarantine" appears at most once in the file.
  Tests in `test/unit/testLanes.test.ts`, `describe('test lanes in CLAUDE.md')`:
  - "the lane table has Story, PR, Release and Perf rows under lane, trigger, runs, blocks and
    budget" — exactly one `^## Test lanes` line; parse the first table after it; header cells are
    those five; first cells start with Story, PR, Release, Perf; Story and PR budget cells contain
    `30 s`, Release's contains `0 s`, Perf's Blocks cell says nothing blocks.
  - "every command and workflow the lane table names exists" — every `npm run <x>` in the table is
    a key in `package.json` `scripts`, `npm test` requires a `test` script, every
    `.github/workflows/*.yml` path named exists; also assert `test:perf`, `validate.yml` and
    `release.yml` are among the names found (so an emptied table cannot pass).
  - "the flake policy is linked, not restated" — `CLAUDE.md` holds a link to
    `.claude/commands/sprint.md#<anchor>`, that file has a heading whose GitHub slug (lowercase,
    drop chars other than letters/digits/space/hyphen, spaces → hyphens) equals the anchor, and
    `quarantine` occurs at most once in `CLAUDE.md`.
  Acceptance: `npm test` green; seeding `npm run test:nope` into the table, or a wrong anchor,
  turns the respective test red.

- [x] **D2 — The per-story gate runs the whole suite, and the docs say so.**
  Files: `.claude/ai-scrum.md`, `CONTRIBUTING.md`, `docs/sprints/README.md`,
  `test/unit/testLanes.test.ts` (extend D1's file).
  - `.claude/ai-scrum.md`: `test-story: npx vitest run --changed HEAD` → `test-story: npm test`;
    in `## Context to read before coding` replace the "no CLAUDE.md yet" placeholder with a line
    `- CLAUDE.md — project rules and the test lanes`. Touch nothing else.
  - `CONTRIBUTING.md:55-58`: `npm test` keeps N2; N4 and N5 run in `npm run test:perf` (the
    non-blocking perf lane, see `CLAUDE.md`). Every line that names N4 or N5 also names `test:perf`.
  - `docs/sprints/README.md` (~:55-57, the build bullet): the narrow verification runs
    `test-story`, which in this project is the full unit suite (`npm test`); the sprint gate adds
    e2e. The literal phrase `full unit suite` must appear. Change only that sentence.
  Tests added to `test/unit/testLanes.test.ts`, `describe('the story gate')`:
  - "the per-story gate runs the whole suite and agents read CLAUDE.md" — parse
    `.claude/ai-scrum.md`: the `test-story:` value is exactly `npm test` and `changed HEAD` is
    absent; the `## Context to read before coding` list has an item naming `CLAUDE.md`, and
    `no CLAUDE.md yet` is absent.
  - "CONTRIBUTING puts N4 and N5 in the perf lane" — every `CONTRIBUTING.md` line matching
    `/N4|N5/` contains `test:perf`, and at least one such line exists.
  Acceptance: `npm test` green; `rg "full unit suite" docs/sprints/README.md` finds the line.

## Model Hints

All deliverables default tier (docs, profile values and one small text-reading test; no source code).

Review: → default

## Acceptance Tests

- AC1 → unit `test/unit/testLanes.test.ts` › "the lane table has Story, PR, Release and Perf rows under lane, trigger, runs, blocks and budget"
- AC2 → unit `test/unit/testLanes.test.ts` › "the lane table has Story, PR, Release and Perf rows under lane, trigger, runs, blocks and budget"
- AC3 → unit `test/unit/testLanes.test.ts` › "every command and workflow the lane table names exists"
- AC4 → unit `test/unit/testLanes.test.ts` › "the flake policy is linked, not restated"
- AC5 → unit `test/unit/testLanes.test.ts` › "CONTRIBUTING puts N4 and N5 in the perf lane"
- AC6 → unit `test/unit/testLanes.test.ts` › "the per-story gate runs the whole suite and agents read CLAUDE.md"
- AC7 → unit `test/unit/testLanes.test.ts` › "the per-story gate runs the whole suite and agents read CLAUDE.md"
- AC8 → gate check (D2): `rg "full unit suite" docs/sprints/README.md` returns the line, recorded
  in Done; no permanent test because the file is regenerated by `/ai-scrum:setup` (see Decisions).

Coverage: AC1-AC4 → D1; AC5-AC8 → D2. No e2e: no criterion is a user action in the app.

## Done

Added `CLAUDE.md` with the Story/PR/Release/Perf lane table, budget-as-target note, clock rule and a link to the flake policy; `test/unit/testLanes.test.ts` guards table shape, named commands/workflows, the link and the profile/CONTRIBUTING wording. The profile now has `test-story: npm test` and lists `CLAUDE.md`; CONTRIBUTING moves N4/N5 to `npm run test:perf`; sprints README says the per-story gate is the full unit suite.

Commit message: `025: CLAUDE.md test-lane table + drift test, story gate runs npm test, CONTRIBUTING N4/N5 to perf lane`

Verification (narrow gate; `test-story` = `npm test` as in effect): `npm run build`, `npm run typecheck`, `npm test` green (42 files, 592 tests) after one typecheck fix; the review fixes were re-checked with typecheck + `npm test`. No e2e (`none`).
- AC1-AC3 -> lane-table and command-existence tests, passed. AC4 -> flake-policy test, passed. AC5 -> CONTRIBUTING test, passed. AC6/AC7 -> story-gate test, passed.
- AC8 -> `rg "full unit suite" docs/sprints/README.md` finds README.md:55 (gate check, no permanent test by decision).
- Review (default tier, 1 cycle): PASS; fixed a vacuous Release `0 s` assertion (also matched `30 s`) and an unconditional `npm test` check.

Decisions
- README sentence names the full unit suite only; the sprint gate's e2e is already stated in the existing Regression gate bullet (README.md:61), and "change only that sentence" held.
- Typecheck errors in the new test were fixed with explicit expects, not non-null assertions.
- No manual residue. No CHANGELOG entry (nothing user-facing).

tiers: D 2 / hard 0 · review default · cycles 1 · agents 6
