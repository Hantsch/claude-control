# Roadmap

**The** one source of status and planning: where we stand, what comes next, what is not planned
at all yet. As of: 2026-08-13.

Rules (so this document does not drift):

- **Milestone granularity.** Story truth lives in the requirements folder (open = flat folder,
  finished = `done/INDEX.md`); sprint detail in the sprints folder. This file links, it does not
  duplicate.
- **Concepts are timeless** (what/why) — when/status lives **only** here.
- **Defined write moments:** end of `/ai-scrum:sprint` (phase 3), end of `/ai-scrum:concept`,
  and the `/ai-scrum:roadmap` ritual (sync check + sprint cut). "Accepted" is marked by the
  user only.

---

## Phase overview

| Phase | Goal | Status |
| --- | --- | --- |
| 1 — v1 tray app | Every running Claude Code session is visible, its status is inferred correctly, and you are told when one finishes or is blocked | ✔ done |
| 2 — Daily use | The popover answers "which session needs me, and what for" without a click, and the app is running when it matters | ▶ **in progress** |
| 3 — Accuracy & breadth | The context gauge stops being an estimate, history attributes work over time, and the adapter seam is proven by a second agent | planned |

---

## Current phase: 2 — Daily use

Concept: [concepts/reference-tool-comparison.md](concepts/reference-tool-comparison.md) — what
the comparison with Irrlicht and ClaudeSessionTray said to take, and what it said to refuse.
Design of record stays [CONCEPT.md](CONCEPT.md).

Way of working: the milestones below are ordered by payoff per hour, not by size. M1 is the one
that changes the day-to-day feel and is deliberately engine-free, so it can be built in one
sitting. Stories are cut into a sprint only once the previous milestone is accepted.

### M1 — Popover at a glance — planned

The popover shows grouping, model, waiting reason, current tool, waiting count and a reachable
notification switch. No engine work — renderer and shared presentation only. Includes the
ten-minute research correction, which is bookkeeping but is the basis on which the opportunistic
status read can later be judged at all.

Stories: [001](requirements/001-registry-status-field.md) ·
[002](requirements/002-popover-at-a-glance.md)
Sprints: [S01](sprints/S01/sprint.md)
Gaps/notes:
- 002 carries one open decision: waiting count vs. the existing `attention` count in the header

### M2 — Always there, no mouse required — planned

Autostart, global hotkey, keyboard navigation in the popover, plus the two noise sources:
abandoned windowless sessions and toasts you cannot act on.

Stories: [003](requirements/003-popover-reachability.md) ·
[004](requirements/004-session-noise-control.md)
Sprints: —
Gaps/notes:
- 003 needs a decision on the portable-EXE autostart path and a default shortcut
- 004 needs a decision on whether mutes survive a restart

### M3 — Light theme — planned

The one visual element that does not belong on a light Windows desktop. Small, independent of
M1/M2, and deliberately not bundled with them so a contrast regression is not hidden inside a
larger diff.

Stories: [007](requirements/007-light-theme.md)
Sprints: —

---

## Phase 3 — Accuracy & breadth (planned)

### M4 — Exact context windows — blocked on a product decision

Not schedulable until the network-promise trade in
[005](requirements/005-exact-context-windows.md) is decided: opt-in fetch with reworded README
and Diagnostics, or close the story as rejected and keep labelling the gauge an estimate.

Stories: [005](requirements/005-exact-context-windows.md)

### M5 — Attribution — planned

Live activity matrix per project group, and history grouped by project / branch / model with
totals. Depends on M1 for the group headers it renders into.

Stories: [006](requirements/006-activity-and-history-attribution.md)

### M6 — Second agent — planned

Codex or Gemini CLI alongside Claude Code, as the first real test of the adapter boundary. Its
own milestone by construction.

Stories: [008](requirements/008-second-agent-adapter.md)

---

## Open / unprioritised

| Topic | State | Next step |
| --- | --- | --- |
| Cost display | **Rejected for v1** (CONCEPT.md §2). Groundwork and the seven measured caveats are preserved in [concepts/reference-tool-comparison.md](concepts/reference-tool-comparison.md) so they are not re-derived | none — reopen only if the presentation problem ("notional list rate, not what a subscription bills, not the `/usage` quota") is solved first |
| Web dashboard | **Rejected.** Contradicts the "no HTTP server, nothing on the network" property in README.md and Settings → Diagnostics; `npm run cli -- --watch` covers the scriptable case | none |
