---
id: 006
title: Activity matrix and history attribution
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

Two views of "who is doing what", one live and one retrospective. Both are Irrlicht features,
and both are mostly already in the data model.

**Live: an activity matrix per project group.** With several projects open, "which project needs
me" is a coarser and more useful question than "which session" — and it is the natural content
for the group headers that story 002 introduces.

**Retrospective: attribution over time.** The history view can filter, but it cannot answer
"where did the work go" by project, branch or model. `HistoryEntry`
([types.ts:306](../../src/core/model/types.ts#L306)) already carries branch, model and
timestamps, so the index is most of the way there; what is missing is aggregate usage per entry
and any grouping in the view.

Depends on story 002 for the group headers this renders into.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] Each project group header shows its status counts compactly
- [ ] Those counts use the same colour custom properties as the status dots, so nothing can
      drift
- [ ] Zero-counts are omitted rather than rendered as `0`
- [ ] History can be grouped by project / branch / model, with per-group totals
- [ ] Indexing stays lazy and stays inside the CONCEPT §10 N5 budget — **measured, not assumed**,
      since this reads more per file than the current index does

## Open Questions

## Plan

## Deliverables

- [ ] D1 — Per-status counts on `ProjectGroup` in
      [aggregate.ts](../../src/core/state/aggregate.ts), which today carries only `attention`.
- [ ] D2 — Group-header rendering of those counts in both
      [popover.tsx](../../src/renderer/popover.tsx) and
      [SessionsView.tsx](../../src/renderer/components/SessionsView.tsx).
- [ ] D3 — Usage totals per entry in the history index.
- [ ] D4 — Grouping by project / branch / model with per-group totals in
      [HistoryView.tsx](../../src/renderer/components/HistoryView.tsx), plus a measurement of
      the indexing cost against the N5 budget.

## Model Hints

## Test Plan (manual acceptance)

## Done
