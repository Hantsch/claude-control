---
id: 002
title: Popover at a glance
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

The popover is the surface that gets looked at fifty times a day, and it is the weakest one.
It answers "how many sessions are there" when the question being asked is "which one needs me,
and what for". Everything it is missing already exists in the app — in the main window, in the
IPC state, or one line away in settings — it simply is not on the small surface where it counts.

Concretely, what a glance should deliver without a click, a hover, or a second window:

- **Which session is blocked, and on what.** Today the reason lives in a `title` attribute — a
  tooltip is not something you scan, and the reason is precisely why you would click the row.
- **What a working session is doing.** "working" alone says nothing you did not already know;
  "working · Bash" does.
- **Which project a row belongs to**, without four rows repeating the same folder name.
- **Which model a session is on.** `/model` switching is routine, and the model is only in the
  detail pane, as a raw `claude-opus-5[1m]` — which is not an answer at a glance, and whose
  `[1m]` suffix changes what the context gauge means.
- **How to turn notifications up or down right now.** Appetite changes several times a day —
  during a long unattended run you want them, in a meeting you do not. Today that means opening
  the main window and finding the Settings tab, which is far enough away that the setting never
  gets touched. This is the single best idea in ClaudeSessionTray
  (`SessionFlyoutForm.cs:144`).

No engine work: this lives in [popover.tsx](../../src/renderer/popover.tsx),
[presentation.ts](../../src/shared/presentation.ts),
[styles.css](../../src/renderer/styles.css) and the small shared components.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] The popover header carries a notification quick-switch showing the current mode; changing
      it persists immediately and the main window's Settings tab reflects it without a reload
- [ ] The popover does not close while that menu is open
- [ ] `enabled: true` stays the default — only the reachability of the switch is copied from
      ClaudeSessionTray, not its off-by-default stance (telling you about a finished turn is
      this app's stated purpose)
- [ ] Rows are grouped by project, sorted so the group explaining the tray badge is on top; a
      single-project case renders no header at all
- [ ] Each row shows a readable model name; an unknown model renders nothing, not a placeholder
- [ ] A waiting row shows its reason inline in the waiting colour, ellipsized, never widening
      the popover
- [ ] A working row shows the current tool and the subagent marker when one is running
- [ ] The waiting dot is findable without reading — it carries a halo, and no other status does
- [ ] The header shows the waiting count when non-zero, in the waiting colour
- [ ] Uptime is visible for long-lived sessions without being mistakable for the idle age
- [ ] Ages under 5 s read "just now" instead of "0s" on every surface
- [ ] The popover's self-measuring height (`report()`) stays correct with headers present

## Open Questions

- **Which count goes in the header?** `state.attention` is already on the IPC state, but it
  counts *unseen* done-or-waiting sessions for the badge — not the plain count of currently
  waiting sessions. The two diverge as soon as something is acknowledged, so one has to be
  chosen deliberately and the choice stated in a comment at the call site.

## Plan

## Deliverables

- [ ] D1 — Notification quick-switch in the popover header, next to pin/close
      ([popover.tsx:76-99](../../src/renderer/popover.tsx#L76-L99)). Maps the four meaningful
      combinations of `notifications.enabled` / `onDone` / `onWaiting`
      ([settings.ts:19](../../src/core/model/settings.ts#L19)) onto one control, with a setter
      over the existing IPC settings channel; the main window already subscribes via
      `onSettingsChanged`.
- [ ] D2 — Group popover rows by project: switch from the flat `state.sessions` loop to
      `state.groups` (built in [aggregate.ts](../../src/core/state/aggregate.ts), already
      rendered by
      [SessionsView.tsx:46](../../src/renderer/components/SessionsView.tsx#L46)). Compact
      header with a count, groups sorted by urgency per CONCEPT §6.5, branch stays on the row
      rather than becoming a second nesting level (at popover width it would cost more than it
      says), single group renders no header.
- [ ] D3 — Model display-name formatter in
      [presentation.ts](../../src/shared/presentation.ts), modelled on
      `SessionState.ModelDisplayName` (`ClaudeSessionTray.Core/SessionState.cs:61`): strip
      Bedrock/Vertex region and vendor prefixes (`us.anthropic.claude-opus-5`), drop `claude-`,
      title-case the rest, keep `[1m]` visible as `1M`. Unit-tested over the observed id shapes
      plus an unknown shape, which must pass through unchanged rather than throw.
- [ ] D4 — Model badge rendered on the popover row, and the raw string in
      `SessionDetailPane.tsx:76` (`session.model ?? '—'`) replaced by the formatter.
- [ ] D5 — Waiting reason inline on the row: for `waiting` sessions replace the branch text
      with the reason in the waiting colour, ellipsized; full `statusReason` stays as the
      tooltip ([popover.tsx:109](../../src/renderer/popover.tsx#L109)). Priority follows
      `SessionRow.cs:166`, where the reason outranks the branch.
- [ ] D6 — Current tool in the popover row's status cell, reusing the main window's rendering
      including the `· subagent` marker
      ([SessionsView.tsx:131](../../src/renderer/components/SessionsView.tsx#L131)).
- [ ] D7 — Halo on the waiting dot in
      [StatusDot.tsx](../../src/renderer/components/StatusDot.tsx): a `box-shadow` taking its
      colour from the existing `--status-waiting` custom property so it cannot drift from the
      dot. Applies everywhere the component is used.
- [ ] D8 — Waiting count in the popover header, in the waiting colour, falling back to the
      plain session count when zero. Resolve the Open Question first and comment the choice.
- [ ] D9 — Uptime on the row from `startedAt` (already on `SessionView`), shown only from ≥1 h
      and visually distinct from the age column — two durations side by side read as a
      start/end pair when they mean unrelated things (`SessionRow.cs:116`).
- [ ] D10 — "just now" under 5 s in
      [format.ts](../../src/renderer/lib/format.ts) `formatAge`, with a test pinning the
      boundary (`SessionRow.cs:190`).

## Model Hints

## Test Plan (manual acceptance)

## Done
