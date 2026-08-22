---
sprint: S04
status: done # planned | in-progress | done
branch: sprint/S04
milestone: M6 — Attribution
---

# Sprint S04 — Where the work went

## Goal

"Which project needs me" and "where did my week go" are answered by the same numbers everywhere:
project group headers show their status counts in the main window as well as the popover, computed
in one place instead of two, and the history view can be grouped by project, branch or model with
per-group totals. Alongside it, the four points S01–S03 left open are closed.

## Stories (in build order)

- [x] 006 — Activity matrix and history attribution (built, live acceptance pending — P2)
- [x] 013 — S03 residuals — report what was registered, rank what is unseen (built, live acceptance pending — P2)

## Notes

**Accepted 2026-08-22.** The user worked through [testplan.md](testplan.md) live and accepted both
stories; 006 and 013 are `done`, M6 is accepted in the roadmap and this sprint is moved to
`sprints/done/`.


First sprint of Phase 3, cut after M3 and M4 were accepted (2026-08-21). Two stories rather than
the usual three to five, by deliberate decision:

- **006 stays one story.** Splitting it into a live and a retrospective half was offered in
  planning and declined — the two halves share the "one number, one source" argument that is the
  point of the story. It carries the weight of a normal sprint on its own: `core/` (counts on
  `ProjectGroup`, usage in the history index), both renderer surfaces, and a measurement against
  the N5 budget.
- **006 first, 013 second.** 013's part B (seen/unseen ranking) touches the group order that 006
  renders counts into, and 006's move of `groupStatusRollup` out of `popoverModel.ts` changes the
  file B would otherwise be judged against.
- **The live half is a move, not a redesign.** 010 shipped the popover rollup renderer-locally and
  is accepted; what the popover shows must not visibly change. That is an acceptance criterion, not
  a nice-to-have — a regression here would break a milestone the user has already signed off.
- **N5 is the risk in this sprint.** The history index gains per-entry usage, which means reading
  more per file than today. The story requires the cold-start budget to be *measured*, the way 011
  measured its tail cost, not argued.

Open questions for the clarification round, bundled: 006 carries five (the main window's existing
`N sessions · M need attention` line, what "usage" means per entry and what a group total sums,
how grouping presents itself, what happens to an already-built index, and whether grouping composes
with the existing filters), 013 four (visibility of a failed protocol registration, where the
seen/unseen ranking belongs — popover group order only or `compareSessions` for every surface —
whether "seen" is the badge's acknowledgement flag, and whether the contrast fix touches the dark
scheme too).

Not scoped here, decided in planning: M5 (exact context windows) stays blocked on the network
promise trade in story 005, M7 (second agent) waits, and the tray tile art for a light taskbar
stays a follow-up rather than being folded into 013.
