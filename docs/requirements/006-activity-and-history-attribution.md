---
id: 006
title: Activity matrix and history attribution
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

Two views of "who is doing what", one live and one retrospective. Both are Irrlicht features,
and both are mostly already in the data model.

**Live: the same status counts everywhere.** With several projects open, "which project needs me"
is a coarser and more useful question than "which session". Story
[010](done/010-popover-drilldown.md) already answers it in the popover: its collapsible group head
shows one coloured dot plus a count per status present, zero counts omitted. But it answers it
*renderer-locally* — `groupStatusRollup` lives in
[popoverModel.ts](../../src/renderer/lib/popoverModel.ts), the main window's group header still
shows only `N sessions · M need attention`
([SessionsView.tsx:79](../../src/renderer/components/SessionsView.tsx#L79)), and `ProjectGroup`
([aggregate.ts:91](../../src/core/state/aggregate.ts#L91)) carries only `attention`. So the same
question has one answer in the popover, a coarser one in the main window, and no single place that
computes it. This story lifts the counts into the shared layer and renders them in both surfaces —
so the number has one source and cannot drift.

**Retrospective: attribution over time.** The history view can filter by project, date and free
text ([HistoryView.tsx](../../src/renderer/components/HistoryView.tsx)), but it cannot answer
"where did the work go" by project, branch or model. `HistoryEntry`
([types.ts:352](../../src/core/model/types.ts#L352)) already carries branch, model and timestamps,
so the index is most of the way there; what is missing is aggregate usage per entry and any
grouping in the view.

Scope decision (roadmap plan, 2026-08-21): the live half is *not* considered done by 010. The
popover's rollup moves into the shared layer and the main window gets the same counts, rather than
the live half being dropped — two implementations of the same number is exactly the drift this
story exists to prevent.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] Each project group header shows its status counts compactly, in the main window as well as
      the popover
- [ ] Both surfaces render the counts from **one** computation — deleting or changing it changes
      both, and a test would fail if only one were updated
- [ ] Those counts use the same colour custom properties as the status dots, so nothing can drift
- [ ] Zero-counts are omitted rather than rendered as `0`
- [ ] What the popover shows today does not visibly change (010 is accepted; this is a move, not a
      redesign)
- [ ] History can be grouped by project / branch / model, with per-group totals
- [ ] A history entry with no usable usage numbers is visibly not-counted rather than silently
      counted as zero
- [ ] Indexing stays lazy and stays inside the CONCEPT §10 N5 budget — **measured, not assumed**,
      since this reads more per file than the current index does

## Open Questions

- **Does the main window's group header keep `N sessions · M need attention`** next to the new
  counts, or do the counts replace that line? (The popover has no such line, so keeping it means
  the two surfaces still differ — deliberately this time.)
- **Which number is "usage" per history entry?** Total tokens, tool uses, wall-clock duration, or a
  combination — and which of those does a per-group total sum? A cost figure is out of scope
  (rejected for v1, CONCEPT §2).
- **How does grouping present itself in the history view?** One dimension at a time (project *or*
  branch *or* model) or nestable; and does a group header replace the flat list (collapsible
  sections) or sit above rows that stay flat?
- **What happens to an already-built index** when the usage total is added — is it recomputed in
  the background on first launch, invalidated wholesale, or filled in lazily so old entries show
  no total until they are next read?
- **Does grouping compose with the existing filters** (project, date range, free text), or is
  grouping only offered on the unfiltered set?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
