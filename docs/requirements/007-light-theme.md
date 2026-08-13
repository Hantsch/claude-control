---
id: 007
title: Light theme
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

[styles.css](../../src/renderer/styles.css) defines a single `:root` with no
`prefers-color-scheme` branch. On a light Windows desktop, a dark popover hanging off the tray is
the one element on screen that does not belong.

The custom properties already are the whole theme surface, so the work is not the switch — it is
checking that the status colours and the four context bands, all chosen against a dark surface,
still carry their meaning on a light one. A theme that renders but whose "waiting" and "working"
become hard to tell apart has made the app worse, not more native.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] Both schemes are legible and follow the OS preference
- [ ] All statuses remain distinguishable from each other in both schemes
- [ ] All four context bands remain distinguishable in both schemes
- [ ] The tray icon rendering ([tray-icons.ts](../../src/main/tray-icons.ts)) is checked
      against a light taskbar, including the badge

## Open Questions

## Plan

## Deliverables

- [ ] D1 — `prefers-color-scheme: light` block over the existing custom properties in
      [styles.css](../../src/renderer/styles.css).
- [ ] D2 — Contrast pass over status colours and the four context bands in the light scheme,
      adjusting values where a pair collapses.
- [ ] D3 — Tray icon and badge checked against a light taskbar in
      [tray-icons.ts](../../src/main/tray-icons.ts).

## Model Hints

## Test Plan (manual acceptance)

## Done
