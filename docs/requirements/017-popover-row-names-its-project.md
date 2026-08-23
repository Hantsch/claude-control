---
id: 017
title: The popover row says which project it is
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-23
---

## Requirement

The popover is the glance surface: it has to answer "which session needs me, and what for"
without a click ([010](done/010-popover-drilldown.md)). It currently answers the second half
and can drop the first. A row identifies its session by branch alone —
`session.branch ? session.branch : session.project.name`
([popover.tsx:924](../../src/renderer/popover.tsx)) — and the project name lives only in the
group head, which is rendered `groups.length > 1`
([popover.tsx:828](../../src/renderer/popover.tsx)).

So with one project live, the project name appears nowhere at all. Observed on 2026-08-23: a
single row reading `sprint/09`, with no way to tell it apart from the `sprint/S08` running in
another repo at the same moment — and branch names of that shape are what this project's own way
of working produces, one per sprint, in every repo. With several projects live the name is
present but positional: it belongs to a header that may have scrolled away, and the row itself
still carries nothing.

The tray menu already does this right —
`<label> — <status> · <project> · <branch>` ([tray.ts:114](../../src/main/tray.ts)) — so the
popover is the outlier among the surfaces, not the standard.

What the user should get: reading one popover row tells them which project it belongs to,
whether one project is live or five.

## Acceptance Criteria

- [ ] With exactly one project group live, the popover names the project
- [ ] A row identifies its project without depending on a group head being visible on screen
- [ ] Two sessions on identically-named branches in different projects are distinguishable at a
      glance
- [ ] Nothing else on line 1 loses its space: the context bar, the token figure, the model, the
      mute bell and the expand affordance keep working at the popover's width, and the two-line
      row layout 010 settled on is not turned back into an eight-column row
- [ ] A session with no branch recorded shows the project once, not twice
- [ ] The main window and the tray menu are unchanged — both already name the project

## Open Questions

- **Where does the name go?** Two candidates, and they are not equivalent: render the group head
  unconditionally (cheapest, keeps the row untouched, costs a line of height when there is only
  one project), or carry `project · branch` in the row itself (identifies the row wherever it
  has scrolled to, costs width on the line that 010's measurement already found
  over-subscribed). Judge against
  [assets/010-popover-drilldown-prototype.html](assets/010-popover-drilldown-prototype.html),
  which is the design of record for this row.
- **Does the branch stay primary?** Today branch wins and project is its fallback. If both are
  shown, which one is the emphasised half — the repo you are in, or the sprint you are on?
- **Group heads and keyboard nav.** A head rendered for a single group becomes another
  `data-nav-key` stop and another collapsible group; check that ← / → and the row-index numbering
  still behave when the only group can be collapsed to nothing.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
