---
id: 025
title: Test lanes are written down, and the story gate runs the whole suite
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — `CLAUDE.md` exists at the repo root with a `## Test lanes` heading:
      `rg -n "^## Test lanes" CLAUDE.md` returns one line
- [ ] **AC2** — The table has one row each for Story, PR, Release and Perf, with columns lane,
      trigger, runs, blocks and budget, matching review §3b / 4-lanes.md (Story `npm test` at most
      30 s, PR `npm test` at most 30 s, Release 0 s when nothing releases, Perf non-blocking)
- [ ] **AC3** — Every command named in the table exists: `npm test` and `npm run test:perf` are
      keys in package.json `scripts`, and `.github/workflows/release.yml` and `validate.yml` exist
- [ ] **AC4** — `CLAUDE.md` links to the flake policy in `.claude/commands/sprint.md` (the section
      carrying lines 335-357) and does not restate its steps: `rg -c "quarantine" CLAUDE.md`
      returns at most 1
- [ ] **AC5** — `CONTRIBUTING.md` no longer says N4/N5 run in `npm test`: `rg "N4|N5" CONTRIBUTING.md`
      returns only lines that also name `test:perf`
- [ ] **AC6** — `.claude/ai-scrum.md` has `test-story: npm test`; `rg "changed HEAD" .claude/ai-scrum.md`
      returns nothing
- [ ] **AC7** — The "Context to read before coding" list in `.claude/ai-scrum.md` names `CLAUDE.md`,
      and `rg "no CLAUDE.md yet" .claude/ai-scrum.md` returns nothing
- [ ] **AC8** — `docs/sprints/README.md` (around :55-61) says the per-story gate runs the full unit
      suite and the sprint gate adds e2e: `rg "full unit suite" docs/sprints/README.md` finds it

## Open Questions

- **CLAUDE.md or a `test-gates` skill?** The value judge: a hand-written CLAUDE.md of about 25
  lines; `/tech-rules:setup` only if house-rule skills are wanted anyway, since a skill is not read
  by default. Decide in refine.
- **Does the budget column stay "proposed"?** Budgets come from one measurement (7.99 s wall); CI
  job minutes are not measured. Decide whether to write them as limits or as targets.
- **Drift.** A lane table that drifts from the YAML misleads. Decide whether AC3's existence check
  is enough or a check script compares the table to the workflows.
- **Order.** The value judge: pair F04's per-story `npm test` with the N5 flake fix, or the
  stricter gate shows false reds. Hence "after 023 and 024"; confirm the sprint order.
- **Not in scope (judge's cut):** `--changed <sprint base>`, CI timing collection, enforcement
  tooling, a full test-gates skill.

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 025` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 025`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 025`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 025`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build 025` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
