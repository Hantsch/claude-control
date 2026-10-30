---
id: 022
title: A past session opens in its own, resizable window
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Clicking a session in History shows a three-line notice under the table — title, start → end,
model, record estimate, transcript path, two buttons
([HistoryView.tsx:277](../../src/renderer/components/HistoryView.tsx)). That is all the user
gets to see of a past session, and it sits at the bottom of a list that may be hundreds of
rows long, at a fixed size.

The app already reads far more than it shows. The click also calls `api.getDetail()`
([HistoryView.tsx:181](../../src/renderer/components/HistoryView.tsx)) — CONCEPT §5.1's
"Detail" tier, a full streaming parse of the one transcript the user asked for — and throws
the result away. `SessionDetail` carries the timeline, every branch and model the session
used, its token totals and its subagent tree ([types.ts:442](../../src/core/model/types.ts)).

What the user asked for (2026-10-30): clicking a session in History opens a detail window,
and that window can be resized — the current view is too small and cannot be made bigger.

## Acceptance Criteria

- [ ] **AC1** — Clicking (or Enter on) a History row opens that session in its own window,
      separate from the main window
- [ ] **AC2** — The window is freely resizable, with a minimum size at which nothing is cut
      off, and it opens at a size large enough to read the timeline without resizing first
- [ ] **AC3** — The window shows what `SessionDetail` already carries: title, project,
      branches, models, start/end/duration, token totals, the subagent tree and the timeline
      of events — not only what the notice shows today
- [ ] **AC4** — Long content scrolls inside the window; resizing reflows it instead of
      clipping it
- [ ] **AC5** — Opening a second session either reuses the window or opens a second one —
      decided in refine, and the same way every time; opening the same session twice never
      produces two windows for it
- [ ] **AC6** — The window remembers its size (and position, if on a still-connected display)
      across opens and app restarts
- [ ] **AC7** — Copy path / Show file stay available, and the window closes with Esc
- [ ] **AC8** — A large transcript opens without freezing the main window: the parse stays
      in the main process, the window shows a loading state, and a `truncated` detail says so
- [ ] **AC9** — The notice under the History table is gone; nothing else in History changes
- [ ] **AC10** — Light and dark theme both apply (the window uses the same theme tokens
      as the main window, 007)

## Open Questions

<!-- S06: the product questions below were answered by the user — see Decisions (Sprint) -->

- **One window or one per session?** One reusable window is simpler and keeps the taskbar
  clean; one per session allows comparing two. Recommendation: one window, retargeted on each
  click, unless the user wants comparison.
- **Live sessions too?** The Sessions tab's detail pane is a fixed column (`.pane.detail`,
  `max-width: 460px`, [styles.css:210](../../src/renderer/styles.css)) with the same "too
  small" problem. Options: give it a drag splitter, or let its rows open the same window.
  Not in this story's ACs unless the user says so in the clarification round.
- **What does the timeline show of a prompt?** The Detail tier is allowed to read the
  transcript (CONCEPT §5.1, "only when the user opens that session"), and `TimelineEvent.text`
  already carries record text. Check against CONCEPT §4 how much of it is rendered, and say
  so in the plan rather than leaving it to the component.
- **Size of the timeline.** `DETAIL_EVENT_LIMIT` is 10 000 events; rendering that many rows
  needs virtualisation or a collapsed-by-default view. Decide in refine.

## Decisions (Sprint)

- **(User)** One reusable detail window, retargeted on each History click.
- **(User)** Live sessions (Sessions tab pane) are out of scope: History only.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
