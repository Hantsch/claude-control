---
sprint: S03
status: in-progress # planned | in-progress | done
branch: sprint/S03
milestone: M3 — Popover drill-down · M4 — Light theme
---

# Sprint S03 — The glance surface, readable

## Goal

The popover stops being a row of ellipses. Two lines per session instead of eight columns, the
waiting reason across the full width, collapsible groups and one click that opens what the
session last said plus one row per subagent with its own model and context. Afterwards the same
surface is checked in the light Windows scheme, and the four points S02 left open are closed.

## Stories (in build order)

- [x] 010 — Popover drill-down — branch, context, model, subagents (built, live acceptance pending — no live Electron env in this session)
- [ ] 011 — Subagent detail — final message and declared model
- [ ] 007 — Light theme
- [ ] 012 — S02 residuals — never hide a live session, never steal the focus

## Notes

Third sprint of Phase 2, cut after M2 was accepted (2026-08-21). The build order is a dependency
chain, not a ranking:

- **010 first** — it replaces the row layout and the focus handling that everything after it
  touches. Its design of record is the click dummy
  [assets/010-popover-drilldown-prototype.html](../../requirements/assets/010-popover-drilldown-prototype.html),
  built with the user on 2026-08-21; its "Datenherkunft" overlay is the scope boundary between
  010 (blue) and 011 (orange).
- **011 after 010** — it is an optional refinement of the drill-down and crosses into
  `core/adapters/`, which 010 deliberately does not touch. Its first open question ("is the
  subagent's final message wanted in the popover at all, or only in the main window?") decides
  how much of it is worth building and belongs in the clarification round.
- **007 after both** — the contrast pass has to run on the layout that ships, not on the one
  being replaced. This is why the light theme is bundled into this sprint rather than kept as its
  own, against the roadmap's earlier note; the one commit per story keeps the colour diff
  separately reviewable.
- **012 last** — its part C ("the popover steals focus when the first session arrives") can only
  be judged against 010's rewritten focus handling. It may turn out to be a missing test rather
  than a fix.

Open questions for the clarification round, bundled: 010 carries four (expanded height vs. the
560 px maximum, whether expansion survives a hide, where the session title goes, dots vs. counts
in the group rollup), 011 four (final message in the popover at all, clip length, whether the
inherited-model `≈` derivation is worth showing, and which model "the session's model" means when
`/model` was used mid-run), 012 three.

Carried over, not scoped into any story here: M1's group-sort ranking works on raw status without
special-casing an already-*seen* waiting/done session, so a seen waiting group can outrank an
unseen done group that is actually colouring the tray badge. 010 renders the group rollup and is
the closest this sprint gets to that code — if it turns out to be a two-line fix while D3 is open,
take it and say so; do not widen the story for it.
