---
description: Refines a story (requirements/NNN-*.md) and writes plan + deliverables straight into the file.
argument-hint: <id>
model: opus
effort: high
---

<!-- ai-scrum:managed 2.0.0 - plugin-owned, written by /ai-scrum:setup. Do not edit:
     setup diffs this file on update and asks before replacing it. Project facts go in .claude/ai-scrum.md. -->

Refine the story with ID **$1**.

## Project profile

Read `.claude/ai-scrum.md` first — it holds this project's paths, verify commands,
acceptance policy, doc language and the files every agent must read before coding.
If it is missing, stop and say: run `/ai-scrum:setup` (ai-scrum plugin) first.

Below, `<requirements>` means `requirements-path` from the profile.

## Never use plan mode

The plan goes **into the story file**, not into an external `.claude/plans/` file and not
into memory. Everything has to be reviewable in the repository.

## Steps

1. **Load:** open `<requirements>/$1-*.md` (finished stories live in
   `<requirements>/done/` — if you only find the ID there, say "already done" and stop).
   Also read linked `[[...]]` stories and referenced documents (bug/review reports) as far
   as the scope needs. **Before planning**, additionally read `CLAUDE.md` and every file
   listed under `## Context to read before coding` in the profile — a plan that violates a
   guardrail is not a plan.

2. **Triage — pick exactly ONE of three paths and tell the user which:**
   - **Trivial / mechanical / low risk** (a text or config fix, a clearly bounded
     one-liner): **no ceremony plan.** Say plainly: "this is small enough — I'll just do it
     here in this session, say GO." On GO, implement it like a normal task (then `/build`
     is not needed). This pushback is wanted, not optional.
   - **Unclear / gaps / ambiguous requirement:** fill `## Open Questions` with concrete
     questions and ask the user (`AskUserQuestion` for real decisions). **Status stays
     `draft`.** Only continue to step 3 once they are answered.
   - **Clear and ready:** continue to step 3.

3. **Research (keep context small):** for code search and exploration call `Agent` with
   `subagent_type: "Explore"` (pure search, fast) or `"Plan"`/`"general-purpose"`
   (architecture trade-offs) — never grep broadly through the repo yourself. Give each
   agent a self-contained prompt (goal, what is already known, what to return — it cannot
   see this conversation). If a sub-question needs real architectural thinking rather than
   search, call that agent explicitly with `model: "opus"` instead of relying on the
   session model. Bring back the essence, not the raw material.

4. **Write into the file** (only the relevant sections, leave the rest of the structure
   untouched; write in the profile's `doc-language`):
   - **`## Plan`** — short and precise, **max. ~50 lines**: steps, affected files, order.
     The user should grasp it in one or two minutes. No essay.
   - **`## Deliverables`** — cut into small, individually acceptable pieces (scrum-like,
     not everything specified from A to Z). Each `D1/D2/...` is the smallest useful result
     with its own acceptance, and **names the files it touches** — plus the file to mirror,
     where it follows an existing pattern. `/build` hands that list to the
     implementing agent, which starts there instead of surveying the repo.

     **Size cap (cost lever #2):** a D that touches more than ~8 files, or spans more than
     one layer (core + IPC + renderer), is cut too coarsely — split it. Agent cost grows with
     turn count and turn count grows with the size of the D: two agents at 30 turns cost less
     than one at 65, and each returns a separately reviewable result.
   - **`## Model Hints`** — here you fix the **agent tier** per deliverable that
     `/build` will use. There are exactly two tiers:
     - **Default (leave unmarked):** the session/Sonnet tier with `/build`'s effort (`medium`).
     - **`deliverable-hard`** (agent definition in `.claude/agents/`, carries Opus +
       effort `high`) — for tricky Ds (regression risk, complex logic, subtle cross-module
       behaviour): a line `D3 → deliverable-hard` **plus a concrete risk justification**
       (which regression, which new path, which cross-file subtlety). `/build`
       passes that justification to the agent.

     **Tier discipline (cost lever #1):** `deliverable-hard` is ~5x more expensive and also
     thinks longer — subagents are >90% of the session bill and the tier decides it. So:
     - Mark **individual** Ds, never wholesale ("all architecture Ds → hard"). If you feel
       like marking more than half of them hard, the cut of the Ds is probably wrong, not
       the tier need.
     - Hard only when you can write the justification in one sentence.
     - Also fix the **review tier** — its own line, `Review: → default` or
       `Review: → story-review-hard` with a one-sentence justification.
       `/build` delegates the code review to a fresh agent that sees only spec +
       diff; this line decides its tier. Default is the cheap tier;
       `story-review-hard` (Opus + effort `high`) only for real risk.
   - **`## Test Plan (manual acceptance)`** — fill only if a human check is needed: exact
     steps to reproduce that the user can follow.
     **If `ui-acceptance-required: true` in the profile (P1):** steps that verify a
     *user-facing action* run through the actual UI — never through a console command or a
     direct internal call as a substitute for the real path. If that path does not exist
     yet, that is a story gap → plan it as a deliverable (the UI trigger) instead of
     papering over it with a console workaround. Pure engine/backend stories without a
     surface are exempt (accepted via tests).

5. **Coverage gate — every AC needs a D:** walk `## Acceptance Criteria` top to bottom and
   name, for each entry, the deliverable that delivers it. Only then set `status: ready`.

   An uncovered criterion is the most expensive failure this workflow has. It is invisible on
   the way through: every D ticks green, the build reports success, and only the code review
   at the very end finds that the story is incomplete. The fix cycle that follows is then
   routinely the single most expensive agent of the whole story — more than the implementation
   agents together, because it re-establishes context the build already had.

   If a criterion has no deliverable: cut one for it, or take the criterion back to the user.
   Do not set `ready` with a gap, and do not silently drop the criterion.

6. **Hand off:** summarise in **a few lines** what was refined and whether open questions
   remain. Say: the plan is in the file, corrections welcome, then `/build $1` —
   ideally in a **separate session**, while you keep refining here.

## Rules

- All `## Open Questions` must be resolved before `status: ready`.
- **No `status: ready` while an acceptance criterion has no deliverable covering it** (step 5).
  `/build` re-checks this and sends the story back here.
- **Acceptance = UI (P1)**, if enabled in the profile: every user-facing capability needs a
  real path through the actual UI. An acceptance or test-plan step for a *user action* that
  requires a console command or a direct internal call is a story gap, not a valid test. If
  a requirement contains such an action without a path, plan the trigger as a deliverable.
- Keep the plan skimmable — the user wants to iterate, not read every detail.
- Do not commit, do not push. Refine only writes the story file.
- **Older story files** may use the previous German headings (`## Anforderung`,
  `## Akzeptanzkriterien`, `## Offene Fragen`, `## Modell-Hinweise`, `## Testplan
  (manuelle Abnahme)`). Treat them as equivalent to the English ones and keep the file's
  existing language and headings — do not rename sections of a story in flight.
