# Roadmap

**The** one source of status and planning: where we stand, what comes next, what is not planned
at all yet. As of: 2026-08-21.

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
sitting. Stories are cut into a sprint only once the previous milestone is accepted — with one
deliberate exception: S03 spans M3 and M4, because a light-theme contrast pass on a row layout
that M3 is about to replace would have to be done twice.

### M1 — Popover at a glance — ✔ accepted (2026-08-21)

The popover shows grouping, model, waiting reason, current tool, waiting count and a reachable
notification switch. No engine work — renderer and shared presentation only. Includes the
ten-minute research correction, which is bookkeeping but is the basis on which the opportunistic
status read can later be judged at all.

Stories: [001](requirements/done/001-registry-status-field.md) — done ·
[002](requirements/done/002-popover-at-a-glance.md) — done
Sprints: [S01](sprints/done/S01/sprint.md) — see [review.md](sprints/done/S01/review.md) and
[testplan.md](sprints/done/S01/testplan.md)
Gaps/notes:
- Header waiting count decided: plain count of currently-waiting sessions, not `state.attention`
  (S01 clarification round).
- Group sort ranks on raw status without special-casing an already-*seen* waiting/done session —
  a seen waiting group could in theory outrank an unseen done group that actually colours the
  tray badge. Not fixed in S01; flagged for whoever next touches tray-badge/group-sort logic.
- 002's testplan.md was run live by the user on 2026-08-21; M1 accepted.

### M2 — Always there, no mouse required — ✔ accepted (2026-08-21)

Autostart, global hotkey, keyboard navigation in the popover, plus the two noise sources:
abandoned windowless sessions and toasts you cannot act on.

Stories: [003](requirements/done/003-popover-reachability.md) — done ·
[004](requirements/done/004-session-noise-control.md) — done
Sprints: [S02](sprints/done/S02/sprint.md) — see [review.md](sprints/done/S02/review.md) and
[testplan.md](sprints/done/S02/testplan.md)
Gaps/notes:
- 003's portable-EXE path drift is self-healed by an unconditional rewrite on every start
  (`applyAutostart()`), not by the originally planned drift-detection — Electron's
  `getLoginItemSettings` cannot observe a registered path different from the one you ask about.
- 004's window-probe failure-caching (a single failed pid probe is cached as a definite "no
  window" for the 30s TTL rather than "unknown") is an accepted, narrow residual risk — flagged
  for whoever next touches `windowProbe.ts`.
- 004's portable-target protocol-handler path (`app.setAsDefaultProtocolClient`) can go stale
  between runs, same pre-existing property as the login-item path; not fixed, not new to this
  sprint.
- The four points the review left open are picked up by
  [012](requirements/012-s02-residuals.md) in S03 — the window-probe "unknown" state, the
  portable target's protocol-handler path, the popover focus steal and the duplicate
  `ShortcutStatus`.
- Live acceptance was run by the user on 2026-08-21 from
  [testplan.md](sprints/done/S02/testplan.md) — the build session itself was headless, so both
  stories landed as "built, acceptance pending" and were only confirmed afterwards. M2 accepted.

### M3 — Popover drill-down — planned

The glance surface is over-subscribed: story 002's eight-column row ellipsizes every flexible
cell, and the cell hit hardest is the waiting reason — the one piece of text that explains why
you would click the row at all. Two lines instead of eight columns, collapsible groups, and one
click that opens what the session last said plus one row per subagent with its own model and
context. Deliberately reverses 002's "no second row line" decision; the measurement behind the
reversal is in the story.

Design of record: [assets/010-popover-drilldown-prototype.html](requirements/assets/010-popover-drilldown-prototype.html)
— a click dummy built with the user on 2026-08-21, whose provenance overlay is the scope
boundary between the two stories.

Stories: [010](requirements/010-popover-drilldown.md) — renderer/shared only ·
[011](requirements/011-subagent-detail-from-result.md) — the two facts that need adapter work
Sprints: [S03](sprints/S03/sprint.md) — planned
Gaps/notes:
- 011 is an optional refinement: 010 is designed to be complete and useful without it.
- 011 reverses a documented decision in `subagentRunResultOf` (the subagent result's text is
  deliberately not read) and touches the CONCEPT §4 privacy statement — a reviewer has to check
  the claim, not just the diff.
- A *running* subagent's progress stays unobservable regardless: `isSidechain` was true on zero
  of ~55 000 records ([RESEARCH.md §2](RESEARCH.md)), so only the result brings text.

### M4 — Light theme — planned

The one visual element that does not belong on a light Windows desktop. The custom properties
already are the whole theme surface, so the work is not the switch — it is checking that the
status colours and the four context bands still carry their meaning on a light surface.

Stories: [007](requirements/007-light-theme.md)
Sprints: [S03](sprints/S03/sprint.md) — planned, built after M3
Gaps/notes:
- Earlier note "deliberately not bundled, so a contrast regression is not hidden inside a larger
  diff" was reversed on 2026-08-21: the contrast pass has to run on the row layout that ships,
  and M3 replaces it. One commit per story keeps the colour diff separately reviewable, which is
  what that note actually wanted.

---

## Phase 3 — Accuracy & breadth (planned)

### M5 — Exact context windows — blocked on a product decision

Not schedulable until the network-promise trade in
[005](requirements/005-exact-context-windows.md) is decided: opt-in fetch with reworded README
and Diagnostics, or close the story as rejected and keep labelling the gauge an estimate.

Stories: [005](requirements/005-exact-context-windows.md)

### M6 — Attribution — planned

Live activity matrix per project group, and history grouped by project / branch / model with
totals. Depends on M1 for the group headers it renders into.

Stories: [006](requirements/006-activity-and-history-attribution.md)

### M7 — Second agent — planned

Codex or Gemini CLI alongside Claude Code, as the first real test of the adapter boundary. Its
own milestone by construction.

Stories: [008](requirements/008-second-agent-adapter.md)

---

## Open / unprioritised

| Topic | State | Next step |
| --- | --- | --- |
| Cost display | **Rejected for v1** (CONCEPT.md §2). Groundwork and the seven measured caveats are preserved in [concepts/reference-tool-comparison.md](concepts/reference-tool-comparison.md) so they are not re-derived | none — reopen only if the presentation problem ("notional list rate, not what a subscription bills, not the `/usage` quota") is solved first |
| Web dashboard | **Rejected.** Contradicts the "no HTTP server, nothing on the network" property in README.md and Settings → Diagnostics; `npm run cli -- --watch` covers the scriptable case | none |
