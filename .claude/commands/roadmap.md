---
description: Roadmap ritual — checks ROADMAP.md against the real repo state (check) and/or cuts the next sprint out of the current milestone with the user (plan).
argument-hint: [check|plan]
model: sonnet
effort: medium
---

<!-- ai-scrum:managed 3.0.0 - plugin-owned, written by /ai-scrum:setup. Do not edit:
     setup diffs this file on update and asks before replacing it. Project facts go in .claude/ai-scrum.md. -->

Run the roadmap ritual: **$1** (no argument: run `check` first, then offer `plan`).

## Project profile

Read `.claude/ai-scrum.md` first — `roadmap-path`, `requirements-path`, `sprints-path`,
`concepts-path`, `systems-path`, id formats and `doc-language` come from there. If it is
missing, stop and say: run `/ai-scrum:setup` (ai-scrum plugin) first.

## Role

The roadmap is THE one source of status and planning (milestone granularity). This command
keeps it honest and turns it into the next sprints. Story truth stays in `requirements-path`
— the roadmap never duplicates story status.

## Mode `check` — sync & drift

1. Read the roadmap.
2. Establish the real state cheaply (Glob/Grep + targeted reads, do not read everything):
   - `<requirements>/*.md` — open stories and their status; the last entry in
     `<requirements>/done/INDEX.md`.
   - `<sprints>/` — open sprints (`sprint.md` outside `done/`) and the most recent review
     under `done/`.
   - `<concepts>/` — are there concepts without a line in the roadmap? Are there concepts
     whose stories are all done (→ they belong in `<systems>/`)?
3. Correct every deviation directly in the roadmap. A milestone whose stories are all `done`
   is **`done`** — acceptance happened inside the sprint, through the tests each story wrote,
   so there is no separate "accepted" state waiting on the user. What a later walk-through
   finds belongs under "Gaps/notes" or into a new story, not into a milestone reopened after
   the fact. Do carry criteria that were only covered below the real surface, and every
   `manual residue` from the sprint reviews, into "Gaps/notes" — that is the honest remainder.
4. Report compactly: drift corrected, state of the current phase, what is waiting
   unprioritised.

## Mode `plan` — cut the next sprint (together with the user)

1. Precondition: `check` has run in this session (otherwise run `check` first).
2. Propose what comes next — default: the next open milestone of the current phase; name
   alternatives from "Open / unprioritised". Real direction decisions (which milestone,
   scope boundaries, deliberate omissions) via `AskUserQuestion` with a recommendation — no
   silent priority assumptions.
3. Cut the chosen milestone (or its first part) into stories:
   - Derive scope from the concept linked in the roadmap + its "Gaps/notes".
   - Cut small: one sprint = one playable/verifiable increment, 3–6 stories as a guideline.
   - One file per story from `<requirements>/_TEMPLATE.md` (`status: draft`, next free id per
     the profile's `story-id-format`, determined from `done/INDEX.md` + the open stories):
     requirement + acceptance criteria from the user's perspective, **numbered `AC1`, `AC2`,
     … and each one observable** — refine has to map every single one to an automated test, so
     a criterion phrased as an intention ("the screen feels calm") cannot be accepted by
     anyone and is cut as a fact instead ("the screen shows exactly one accent colour").
     Deliberately open decisions as concrete questions in `## Open Questions` (resolved by
     `/sprint` in its clarification round). **No** plan/deliverables and **no** test mapping —
     that is refine's job.
4. Create `<sprints>/<next free sprint id>/sprint.md` from the template: goal, stories in
   build order, `status: planned`, `milestone:` line.
5. Record the sprint under its milestone in the roadmap (status stays open until the sprint has
   built it).
6. Show the user the cut (sprint goal + one sentence per story) for correction. Then the user
   starts `/sprint <id>` themselves.

## Rules

- Do not commit, do not push. No implementation, no refine — only the roadmap, story drafts
  and `sprint.md`.
- Keep milestone granularity: never copy story status lists into the roadmap.
- Concepts stay timeless (what/why) — when/status lives only in the roadmap.
- Move fully implemented concepts to `<systems>/` (`git mv`, update the status line) — that
  is part of `check`.
- Write generated artifacts in the profile's `doc-language`; keep the existing language of
  files you are only editing.
