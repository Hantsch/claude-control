---
id: 000
title: <short title>
status: draft # draft -> ready -> in-progress -> done
created: <YYYY-MM-DD>
---

## Requirement

<What should be achieved and why? From the user's perspective. No solution — the "what", not
the "how".>

## Acceptance Criteria

- [ ] <how do you recognise it is finished?>
- [ ] ...

## Open Questions

<Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round.>

## Plan

<Leave empty. Filled by `/refine <id>`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine <id>`: small pieces, each with its own acceptance
(scrum-like) and the files it touches. `/build` implements them in order, in one go.
Every acceptance criterion above must be covered by at least one deliverable — refine checks
this before `status: ready`, build refuses to start without it.>

- [ ] D1 — <smallest useful, individually acceptable result; names the files it touches>
- [ ] D2 — ...

## Model Hints

<Agent tier per deliverable. Default is the cheap tier with `/build`'s effort — leave
unmarked. If a step needs more brainpower: "D3 (balancing formula) → deliverable-hard" (Opus +
high effort, agent in `.claude/agents/`) plus a one-sentence risk justification.
Plus one line for the code review, default: "Review: → default".>

## Test Plan (manual acceptance)

<Leave empty. Fill only if a human check is needed. Then: exact steps to reproduce that
someone can follow. If `ui-acceptance-required: true` in `.claude/ai-scrum.md`, steps for
user-facing actions must go through the real UI.>

## Done

<Leave empty. Filled by `/build <id>` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
