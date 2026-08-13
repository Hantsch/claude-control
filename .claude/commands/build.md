---
description: Implements an approved story (status ready) deliverable by deliverable, verifies it, has it reviewed by a clean agent and fills the Done section.
argument-hint: <id>
model: sonnet
effort: medium
---

<!-- ai-scrum:managed 2.0.0 - plugin-owned, written by /ai-scrum:setup. Do not edit:
     setup diffs this file on update and asks before replacing it. Project facts go in .claude/ai-scrum.md. -->

Implement the story with ID **$1**.

## Project profile

Read `.claude/ai-scrum.md` first — paths, verify commands, acceptance policy, doc language
and the files every agent must read before coding all come from there. If it is missing,
stop and say: run `/ai-scrum:setup` (ai-scrum plugin) first. Below, `<requirements>` means
`requirements-path` from the profile.

## Precondition

Open `<requirements>/$1-*.md`. Status must be **`ready`**.
- `draft` → stop, say "run `/refine $1` first".
- `done` → stop, say "already done".
- Not found → look in `<requirements>/done/$1-*.md`; if it is there, also "already done".

Then check coverage: every entry in `## Acceptance Criteria` must be covered by at least one
deliverable. If one is not, **stop** and name the uncovered criterion — that is a refine gap,
and building around it is the most expensive mistake available here: the Ds all go green, the
code review finds the hole at the very end, and the fix cycle costs more than the
implementation agents together. Back to `/refine $1`.

## Flow (scrum-like: small deliverables, acceptance at the end)

1. Set `status: in-progress`.
2. Read `## Plan`, `## Deliverables` and `## Model Hints`.
3. Work the deliverables **in order**, without waiting for approval in between. For each
   `D` you are the orchestrator — the actual implementation is delegated to a fresh `Agent`:
   - **Pick the tier:** default is a plain `Agent` call without `subagent_type`/`model` — it
     inherits this command's model and effort. If the D is marked `→ deliverable-hard` in
     `## Model Hints` (legacy marking: `→ Opus`), use `subagent_type: "deliverable-hard"`;
     that agent definition (`.claude/agents/deliverable-hard.md` in this project) carries
     Opus **and** high thinking effort — do not additionally set `model` by hand. If the
     agent cannot be resolved, fall back to a plain `Agent` call with `model: "opus"` and
     `effort: "high"`.

     **Do not escalate on your own:** the hard tier is ~5x more expensive and thinks longer;
     subagents are >90% of the session bill. A D gets `deliverable-hard` **only** when
     `## Model Hints` says so — not by gut feeling, not "to be safe", not because it looks
     complicated. No marking means default tier. If an unmarked D turns out to feel risky
     enough for the hard tier while implementing, that is a plan-gap signal → stop briefly
     and ask the user instead of silently escalating.
   - **Delegate:** ONE foreground `Agent` call (no `run_in_background` — you need the result
     before moving to the next D) with a self-contained prompt. The agent cannot see this
     conversation, so give it:
     - the full text of exactly this one deliverable (not the other Ds),
     - the affected files/paths — from the D itself and from `## Plan` — and the file to
       mirror if the D names one, with the instruction to **start from those files instead of
       surveying the repo**: read what is listed, search only for what is genuinely missing.
       Exploration is the biggest cost driver in a build, because an agent's whole context is
       re-read on every turn: a wide search early makes every later turn more expensive. The
       plan already did that search — the agent should not repeat it.
     - for `deliverable-hard`, the risk justification from `## Model Hints`,
     - the instruction to read and honour `CLAUDE.md` plus every file listed under
       `## Context to read before coding` in `.claude/ai-scrum.md` **before writing code**,
     - that ONLY this deliverable is implemented (no jumping ahead to later Ds),
     - that nothing is committed or pushed,
     - that it returns a short summary of changed files + anything notable.
   - **Check and continue:** review the agent's result briefly (file diff, build relevance),
     tick `- [ ] D…` to `- [x]` in the file and start the next D immediately — no stop at the
     user. **Keep a note of which files each D actually changed** — the code review in step 6
     gets that mapping, so it does not have to reconstruct it from the diff. Interrupt only on
     a real blocker (plan has gaps, agent fails, ambiguity only the user can resolve).
4. Honour the project rules in `CLAUDE.md` and the profile's context files yourself as well.

## Closing

5. **Verification:**
   - Run the `build`, `test` (and `lint`/`typecheck`, if set) commands from the profile's
     `## Verify` section. Entries set to `none` are skipped. Run `test` when tests exist or
     were touched.
   - **If `live-smoke-required: true` and the story has a visible surface (P2):** green
     build/test is NOT enough. Drive the actual flow through the running app, the way
     `live-smoke-how` in the profile describes, and look at the result yourself. If that is
     impossible for lack of a live environment (headless agents cannot drive a GUI), the
     story is NOT `done`: status stays `in-progress`, you report "built, acceptance pending"
     and hand the manual acceptance to the user.
   - Report the result honestly — name failing tests, gloss over nothing.
6. **Code review (clean agent):** the review is NOT done by this session — whoever
   implemented does not verify. Delegate to a fresh `Agent` (foreground):
   - **Tier:** from the `Review: → …` line in `## Model Hints`. If it says
     `story-review-hard` (legacy: `Review: → Opus`), use
     `subagent_type: "story-review-hard"` — that definition carries Opus + high effort.
     Otherwise (including when the line is missing) a plain `Agent` call inheriting this
     command's model and effort.
   - **Prompt (self-contained — the agent knows neither this session nor the
     implementation):**
     - path to the story file; `## Acceptance Criteria` + `## Plan` are its spec,
     - the story's diff: `git diff HEAD` plus new untracked files (`git status`) — nothing
       has been committed,
     - the deliverable → changed-files mapping you kept in step 3, so the reviewer goes
       straight to the relevant code instead of rediscovering which D produced what,
     - the review assignment:
       (a) each acceptance criterion individually: PASS / FAIL / UNCLEAR with evidence
           (`file:line`),
       (b) weakened or deleted tests, disabled assertions, suppressed warnings, silenced
           null checks or commented-out validations without a justifying comment on the
           same line,
       (c) scope creep: changes with no visible relation to plan/deliverables,
       (d) correctness bugs, removed validation or error handling, violations of the
           guardrails in `CLAUDE.md`,
     - the agent proposes no fixes and changes no files — it returns a verdict
       (PASS/FAIL/UNCLEAR) + a findings list (`file:line` + one line of reasoning).
   - **Handle findings:** fix confirmed ones, then repeat the verification from step 5;
     document deliberately unfixed findings with a reason in the Done section. Max. 3
     review-fix cycles, then stop and ask the user. Only then continue.
7. **`## Test Plan (manual acceptance)`**: if a manual check is needed and the section is
   still empty, write the exact steps to reproduce now.
8. **Fill `## Done`:**
   - Short summary (2–5 lines): what was done.
   - Commit message (1–2 lines, keywords are enough — no full sentence needed; story ID
     first, e.g. `042: finish team-based combat`).
   - Verification: build/test/lint status + review outcome; open points and blockers.
9. Check all `## Acceptance Criteria` and tick the ones that are met.
10. Set `status: done` — for user-facing stories **only** after a passed live smoke or a
    confirmed user acceptance (P2, if enabled); otherwise leave `in-progress` and hand over.
    Then `git mv` the file to `<requirements>/done/` and append a line to
    `<requirements>/done/INDEX.md`
    (`- NNN — <title> · <sprint or —> · <one-sentence result>`) — move and index line are
    part of the story, not of the user's commit.

## Rules

- **Do not commit, do not push**, unless the user explicitly asks. `/build` writes
  code + the Done section; the commit is the user's deliberate act, using the prepared
  commit message. (Inside `/sprint` the orchestrator commits — see that command.)
- **No stop after individual deliverables.** The whole story is pulled through in one go;
  the user accepts once at the end based on `## Done`, not after every `D`.
- Never weaken tests to go green. A red test is reported, not silenced.
- If you notice while implementing that the plan has gaps: stop, say so, back to
  `/refine`.
- **Older story files** may use the previous German headings (`## Akzeptanzkriterien`,
  `## Modell-Hinweise`, `## Testplan (manuelle Abnahme)`, `## Done`) — treat them as
  equivalent and keep the file's existing language.
