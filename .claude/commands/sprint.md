---
description: Runs a sprint (sprints/SNN/sprint.md) autonomously — branch, refine + build every story, one commit per story, then review doc + test plan.
argument-hint: <sprint-id>
model: sonnet
effort: medium
---

<!-- ai-scrum:managed 2.1.1 - plugin-owned, written by /ai-scrum:setup. Do not edit:
     setup diffs this file on update and asks before replacing it. Project facts go in .claude/ai-scrum.md. -->

Run sprint **$1**.

## Project profile

Read `.claude/ai-scrum.md` first — paths, verify commands, branching, auto-commit,
acceptance policy, `changelog-path` and doc language come from there. If it is missing, stop
and say: run `/ai-scrum:setup` first. Below, `<sprints>` and `<requirements>` mean the
corresponding paths from the profile.

## Core principle

You are the sprint orchestrator. The sprint runs **largely autonomously**: no stops for
small things, no question on every detail decision.

**Exception — deliberately open decisions belong to the user.** Whatever a story lists under
`## Open Questions` was left open on purpose — **never** decided by an agent. You (the
orchestrator) resolve those, bundled, via `AskUserQuestion` in the clarification round
(phase 1a) and in the follow-up after refine. Subagents cannot reach the user — that is why
every user question goes through you.

All **other** detail decisions are made by the agents themselves, **verified against the
spec** (story file, roadmap + the concept it links for the milestone, guardrails in
`CLAUDE.md`) and written down — in the story under `## Decisions (Sprint)` or in the Done
section. Only a real blocker that only the user can resolve, and that surfaces in the build
phase, stops the **affected story** (not the sprint) — it is marked as blocked and the rest
continues.

All state lives in files (`sprint.md`, story files, commits) — after a context reset
`/sprint $1` is **resumable** and continues at the first open spot.

## Precondition

1. Open `<sprints>/$1/sprint.md`. If it does not exist: abort and point at
   `<sprints>/_TEMPLATE/sprint.md`.
2. Sprint status: `planned` → start normally. `in-progress` → **resume** (skip finished
   stories, continue at the first open spot). `done` → abort.
3. `git status` must be clean. Foreign uncommitted changes → abort and ask the user.

## Phase 0 — Setup

- Create and check out the sprint branch from `branch-base` in the profile, named after
  `sprint-branch-pattern` (e.g. `sprint/$1`); if it already exists (resume): just check out.
- In `sprint.md`: set `status: in-progress` and the `branch:` line.

## Phase 1a — Clarification round (orchestrator ↔ user)

Before any refine agent starts:

1. From every story in the sprint list with status `draft`, read `## Open Questions`. Skip
   entries already marked as answered (resume).
2. If open entries exist: put them to the user **bundled** via `AskUserQuestion` (max. 4
   questions per call, as many calls as needed). Per question: one sentence of story
   context, sensible answer options derived from spec/concept doc, one marked as
   recommended. Do NOT ask questions the story explicitly defers to refine, or pure
   balancing placeholders — those belong to the agents.
3. Write each answer into the affected story immediately: under `## Decisions (Sprint)` as
   `- **(User)** <short form of the question>: <decision>`, and mark the entry under
   `## Open Questions` as `~~…~~ answered → Decisions (Sprint)`.
4. Phase 1b starts only once every question asked has been answered and recorded.

## Phase 1b — Refine (all stories, in parallel)

For every story in the sprint list whose requirement is still `draft`, ONE fresh `Agent`
(`subagent_type: "general-purpose"`, **`model: "opus"`**, **`run_in_background: false`**) —
all calls in ONE message. Several foreground calls in one message run concurrently *and*
block until all of them have returned, which is exactly what this phase wants; backgrounding
them instead buys nothing and costs you the completion notifications. Prompt (self-contained,
the agent does not know this session):

- Read the refine procedure — the file is
  `.claude/commands/refine.md` — and refine story **<id>** exactly along those
  steps, with the following **sprint deviations**:
  - **No questions to the user** (you cannot reach them). The deliberately open decisions
    are already answered under `## Decisions (Sprint)`, marked `(User)` — they are
    **binding** and are not re-decided or reinterpreted.
  - All **other** detail questions you decide yourself: against acceptance criteria, linked
    stories, the roadmap plus the concept linked for the milestone, and the guardrails in
    `CLAUDE.md` + the profile's context files. Document every decision with a one-sentence
    reason in the story under `## Decisions (Sprint)` (without the `(User)` marker).
  - **Triage "trivial":** do not wait for GO, do not implement anything directly — even
    trivial stories get a minimal plan + 1 deliverable and `status: ready`, so the build
    phase works uniformly.
  - If you hit a **new** decision that belongs to the user (design direction, a
    contradiction in the spec, a missing factual basis): leave status `draft`, phrase the
    question precisely with answer options in `## Open Questions`, and return
    `BLOCKED: user question`.
- Return: `ready` or `BLOCKED: <reason>` + max. 5 lines of plan essence + the list of
  decisions taken.

**Follow-up:** if a story came back with `BLOCKED: user question`, put the new questions to
the user (as in phase 1a), record the answers and start exactly ONE more refine round for
those stories. Stories still blocked afterwards are marked in their `sprint.md` line
(`(blocked: <reason>)`) — they are skipped in phase 2.

## Phase 2 — Build (all stories, sequentially in list order)

For every `ready` story ONE fresh `Agent` (`subagent_type: "general-purpose"`,
**`model: "sonnet"`**, **`run_in_background: false`**) — strictly one after another (later
stories build on earlier ones). Both parameters are written out on purpose: an unset `model`
inherits the *session* model rather than this command's frontmatter and re-tiers the entire
agent tree below it, and an unset `run_in_background` means **background**, which for a
story-long build is a coin flip on whether you ever hear back. Do **not** escalate the tier
on your own — the hard tier is chosen per deliverable inside `/build`, from `## Model Hints`.
Prompt (self-contained):

- Read the build procedure — the file is
  `.claude/commands/build.md` — and implement story **<id>** exactly along it:
  delegate deliverables one by one to fresh agents, honour `## Model Hints` (hard tier only
  where marked), verification with the commands from `.claude/ai-scrum.md`, clean-agent
  review over the diff, fill the Done section. **Sprint deviations:**
  - **No questions to the user.** Make decisions during implementation yourself, verify them
    against plan + acceptance criteria and document them in the Done section under
    "Decisions".
  - On a real blocker (plan has gaps, review-fix cycles exhausted, red tests you cannot
    fix): leave status `in-progress`, document the blocker honestly in the story file and
    return `BLOCKED: <reason>`. QA rules apply without exception — never weaken tests to go
    green.
  - Do not commit (the orchestrator does that).
  - **Progress trail:** get the real current timestamp by running a shell command
    (`date "+%Y-%m-%d %H:%M"` or the PowerShell equivalent `Get-Date -Format "yyyy-MM-dd
    HH:mm"`) — never guess or estimate it — both right before delegating a deliverable and
    right after it returns, and append one line each time to `<sprints>/$1/progress.md`
    (create the file if it is missing):
    `- <YYYY-MM-DD HH:MM> · <story id> · D<n> <short title> · started|done|blocked`. It costs
    almost nothing and it is the only thing that tells the user a long build is alive — they
    watch the working tree, where a running agent and a dead one look identical. The
    started/done pair per deliverable also gives a real duration instead of a guess.
- Return: `done` or `BLOCKED: <reason>`, the commit message from the Done section, changed
  files, findings/decisions as bullet points — **at most 20 lines**, no diffs and no pasted
  file contents. Everything it returns stays in your context for the rest of the sprint.

**After each story YOU commit** — but only if `auto-commit-per-story: true` in the profile,
and only on the sprint branch (never push, never on a `protected-branches` entry). If it is
`false`, leave the changes staged-free and tell the user at the end which commits to make.

- Story `done`: tick the checkbox in `sprint.md`, then `git add -A` and commit with the
  prepared message (story ID first, e.g. `042: finish team-based combat`).
- Story `BLOCKED`: commit the partial changes as `WIP <id>: blocked — <reason>` so they do
  not bleed into the next story's diff; mark the story in `sprint.md`. If a later story
  depends on the blocked one, skip it too (with a note) instead of building on a broken base.

## Phase 3 — Sprint review

1. **`<sprints>/$1/review.md`** you write yourself from the collected results (in the
   profile's `doc-language`):
   - **Overview:** sprint goal + table (story · status · short commit description).
   - **Implemented stories:** 1–3 lines each on what was built.
   - **Findings & decisions:** aggregated from the `## Decisions (Sprint)` sections, the
     build feedback and the review findings — input for the next sprint planning
     (corrections, direction decisions).
   - **Blocked / open:** blocked stories with their reason and the question the user has to
     decide.
2. **`<sprints>/$1/testplan.md`** — delegate to ONE fresh `Agent` (`model: "sonnet"`,
   `run_in_background: false`), prompt:
   - Read the sprint's story files (`## Acceptance Criteria`, `## Test Plan (manual
     acceptance)`) and check the surface that was actually built, in the code.
   - Write `<sprints>/$1/testplan.md`: per use case a step-by-step guide the user can follow
     without prior knowledge — **preparation** (how to start the app per the README, test
     content), **steps** (where to click, what to type), **expected result**. Only use cases
     from stories actually implemented in this sprint, no invented features.
   - **If `ui-acceptance-required: true` (P1):** steps for user-facing actions go
     exclusively through the real UI — never through a console command or a direct internal
     call (a console is fine for *starting* the app). If such an action cannot be performed
     through the UI, name it as a gap instead of writing a console workaround as a test
     step. Pure engine/backend stories without a surface are exempt (accepted via tests).
3. **Update the roadmap** (`roadmap-path`): record the sprint under its milestone and update
   the milestone status honestly ("accepted" is marked by the **user** after live
   acceptance — until then "built, acceptance pending"); add lasting gaps from the findings
   under the milestone's "Gaps/notes". If a concept is thereby fully implemented (all
   stories done): `git mv` it to `systems-path` and update its status line.
4. **If `changelog-path` is set in the profile:** check that every story done in this sprint
   with a user-facing change has its entry there, under `# Features` / `# Fixes` of the current
   version section. `/build` writes them per story; this is the sweep that catches the ones it
   missed. A missing entry is a finding in the review, not something you fix silently — add it,
   and say in the review that it was added late. When `changelog-path` is `none`, skip this.
5. `sprint.md`: `status: done` (blocked stories stay visibly marked).
6. Final commit: `$1: sprint review + testplan + roadmap`.

## Final report to the user

Short and complete: branch name, stories done/blocked, paths to `review.md` and
`testplan.md`, note that merging into `branch-base` is the user's decision after the sprint
review. A `protected-branches` entry is never the target of a sprint branch merge you make.

## Rules

- **Never push. Never commit on a protected branch. No merge** — that is the user's job.
- **Acceptance = UI (P1)**, if enabled: the generated `testplan.md` checks user-facing
  actions through the real UI. If a story lacks that path, it is named as a gap in the test
  plan **and** in `review.md`, not hidden behind a console workaround.
- **"done" ≠ live-verified (P2):** an autonomous sprint cannot perform manual UI acceptance.
  User-facing stories whose end-to-end path only ran on fake/unit level are listed in
  `review.md` explicitly as "built, live acceptance pending" — not presented as fully
  accepted. The user does the live acceptance after the sprint.
- Auto-commits apply only to `/sprint` on the sprint branch; elsewhere "never
  commit without being asked" still holds.
- **Never end a turn with "waiting".** A turn without a tool call ends your run — "I'll report
  back once the build agent returns" is not a pause, it is the end of the sprint, and the user
  finds out by noticing that the working tree stopped moving. Keep every delegation in the
  foreground and the question never comes up.
- **There is no working watchdog, so do not build the sprint on one.** `ScheduleWakeup` is
  rejected outside `/loop` mode, and `TaskOutput` cannot resolve a subagent id — both fail with
  an error rather than protecting you. Foreground delegation is the mechanism that makes this
  command reliable; polling, heartbeat agents and dummy "noop" agents are not substitutes for
  it and must not be improvised.
- **Do not switch the session model while a sprint runs**, and say so to the user if they ask
  mid-run. Every agent started without an explicit `model` inherits the session model and
  passes it down its whole subtree — flipping to Opus mid-sprint therefore re-tiers everything
  that follows, at roughly five times the price, with no visible change in behaviour.
- Context discipline: keep agent returns short; read story files only where needed — the
  state lives in `sprint.md` + story status, not in your memory. You are the orchestrator:
  reading source files yourself is an agent's job, and whatever you read is re-read on every
  turn you have left.
- If ALL stories are blocked or phase 0 fails: stop cleanly and report the state honestly.
- **Older story files** may use the previous German headings (`## Offene Fragen`,
  `## Entscheidungen (Sprint)`, `## Akzeptanzkriterien`, `## Modell-Hinweise`) — treat them
  as equivalent and keep each file's existing language.
