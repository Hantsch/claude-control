---
id: 008
title: Second agent adapter
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

Irrlicht's real breadth is 11 agents. The adapter boundary here (CONCEPT §9, N7) was designed
for exactly this and has never been exercised by a second implementation — which means it is an
*intended* boundary, not a verified one. Any leak of Claude-specific knowledge outside
`adapters/claude/` is invisible until something else tries to fit through.

Adding Codex or Gemini CLI proves or disproves the seam. The point of the story is as much the
verdict on the boundary as the second agent.

Its own milestone by construction — do not start it inside another one.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] A second agent's live sessions appear alongside Claude Code's on all live surfaces
- [ ] The UI names which agent a session belongs to
- [ ] No agent-specific knowledge has leaked out of the adapter — and where it had, the story
      records what was moved
- [ ] Whatever the attempt revealed about
      [adapters/types.ts](../../src/core/adapters/types.ts) is written down, even where the
      answer was "the seam held"

## Open Questions

- **Which second agent?** Codex or Gemini CLI. Pick by whichever has the more *different*
  on-disk shape — the closer it is to Claude Code's, the less it tests.

## Plan

## Deliverables

- [ ] D1 — Second adapter as a sibling of
      [adapters/claude/](../../src/core/adapters/claude/), against the chosen agent's real
      on-disk data.
- [ ] D2 — Corrections to [adapters/types.ts](../../src/core/adapters/types.ts) and to anything
      outside the adapters that turned out to know about Claude Code specifically.
- [ ] D3 — Agent identity surfaced in the UI (list, popover row, detail pane).

## Model Hints

## Test Plan (manual acceptance)

## Done
