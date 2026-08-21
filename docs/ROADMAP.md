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
| 2 — Daily use | The popover answers "which session needs me, and what for" without a click, and the app is running when it matters | ✔ done |
| 3 — Accuracy & breadth | The context gauge stops being an estimate, history attributes work over time, and the adapter seam is proven by a second agent | ▶ **in progress** |

---

## Phase 2 — Daily use — ✔ done (2026-08-21)

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
- The four points the review left open were picked up by
  [012](requirements/done/012-s02-residuals.md) in S03 — the window-probe "unknown" state, the
  portable target's protocol-handler path, the popover focus steal and the duplicate
  `ShortcutStatus` — and all four are accepted with S03. The two residual-risk notes
  above are therefore closed in code: the probe now emits an explicit negative so an unanswered
  pid stays unknown and re-probed, and the portable target registers its stable
  `PORTABLE_EXECUTABLE_FILE` path. What remains of the latter is a smaller limit: moving or
  deleting the portable EXE breaks toast buttons until the app is started once from the new
  location, which is documented in the README.
- **Open, found while building 012:** Settings → Diagnostics *recomputes* the protocol target at
  IPC-handler time rather than reporting what `setAsDefaultProtocolClient` actually wrote, and
  that registration's `catch {}` swallows a failed registry write — so the panel can print a path
  that was never registered, in the very field added so a user could check it. Fix: thread
  `{ target, registered }` out of `registerToastProtocol()`. The packaged non-portable case also
  renders the `<installed exe>` placeholder instead of a path.
- Live acceptance was run by the user on 2026-08-21 from
  [testplan.md](sprints/done/S02/testplan.md) — the build session itself was headless, so both
  stories landed as "built, acceptance pending" and were only confirmed afterwards. M2 accepted.

### M3 — Popover drill-down — ✔ accepted (2026-08-21)

The glance surface is over-subscribed: story 002's eight-column row ellipsizes every flexible
cell, and the cell hit hardest is the waiting reason — the one piece of text that explains why
you would click the row at all. Two lines instead of eight columns, collapsible groups, and one
click that opens what the session last said plus one row per subagent with its own model and
context. Deliberately reverses 002's "no second row line" decision; the measurement behind the
reversal is in the story.

Design of record: [assets/010-popover-drilldown-prototype.html](requirements/assets/010-popover-drilldown-prototype.html)
— a click dummy built with the user on 2026-08-21, whose provenance overlay is the scope
boundary between the two stories.

Stories: [010](requirements/done/010-popover-drilldown.md) — renderer/shared only ·
[011](requirements/done/011-subagent-detail-from-result.md) — the two facts that need adapter work
Sprints: [S03](sprints/done/S03/sprint.md) — see [review.md](sprints/done/S03/review.md) and
[testplan.md](sprints/done/S03/testplan.md)
Gaps/notes:
- The build session was headless (no Electron GUI reachable), so both stories landed as "built,
  acceptance pending" and ran on unit level only. Live acceptance was worked through by the user
  from [testplan.md](sprints/done/S03/testplan.md) on 2026-08-21 — M3 accepted.
- 011 is an optional refinement: 010 is designed to be complete and useful without it.
- 011 reverses a documented decision in `subagentRunResultOf` (the subagent result's text is
  deliberately not read) and touches the CONCEPT §4 privacy statement — a reviewer has to check
  the claim, not just the diff.
- A *running* subagent's progress stays unobservable regardless: `isSidechain` was true on zero
  of ~55 000 records ([RESEARCH.md §2](RESEARCH.md)), so only the result brings text.
- 011's inherited-model derivation was **dropped** by user decision: a subagent with no model
  declared in the `Agent` call shows no model at all rather than a `≈`-marked guess. The `≈`
  marker in the prototype therefore has no counterpart in the shipped UI.
- 010's popover height: the scroll was accepted rather than raising `POPOVER_MAX_HEIGHT` or making
  expansion an accordion, so several sessions can be open at once and the list scrolls. The
  self-measured height was code-verified rather than live-measured in the build session; it held
  in live acceptance.
- The M1 group-sort ranking (a *seen* waiting group can outrank an unseen done group that is
  colouring the tray badge) was **not** taken in 010 as the sprint notes allowed: it turned out to
  be shared with the tray badge rather than local to the group rollup. Still open.

### M4 — Light theme — ✔ accepted (2026-08-21)

The one visual element that does not belong on a light Windows desktop. The custom properties
already are the whole theme surface, so the work is not the switch — it is checking that the
status colours and the four context bands still carry their meaning on a light surface.

Stories: [007](requirements/done/007-light-theme.md)
Sprints: [S03](sprints/done/S03/sprint.md) — built after M3; see
[review.md](sprints/done/S03/review.md) and [testplan.md](sprints/done/S03/testplan.md)
Gaps/notes:
- Earlier note "deliberately not bundled, so a contrast regression is not hidden inside a larger
  diff" was reversed on 2026-08-21: the contrast pass has to run on the row layout that ships,
  and M3 replaces it. One commit per story keeps the colour diff separately reviewable, which is
  what that note actually wanted.
- Built as a `prefers-color-scheme` media query only — no in-app theme toggle, and dark stays the
  `:root` baseline with light as override-only. Contrast is enforced by `test/unit/theme.test.ts`
  (WCAG ratios plus OKLab pairwise distinguishability, thresholded against the dark scheme's own
  worst pair) rather than by screenshots.
- Two pre-existing contrast edges were found and deliberately **not** fixed, to keep the colour
  diff honest: `--text-faint` on `--bg-active` (2.75:1 light vs 2.81:1 dark — same order in both
  schemes, so not a light-theme regression) and `.muted` body text at `--muted-opacity: 0.6`
  (~4.47:1, just under 4.5:1). Both are effect tokens, open for a follow-up.
- `--band-yellow` deviated from the story's suggested `#b58900` to `#9c7600`: band fills paint
  against `--bg-active`, where the suggested value only reached 2.44:1 against a stated 3:1
  target. The target won over the suggested hex — the pattern for any remaining colour work.
- No new tray art: only the badge rim became theme-aware. A tray tile that reads badly on a light
  taskbar is a follow-up story, not part of this one.

---

## Current phase: 3 — Accuracy & breadth

Design of record stays [CONCEPT.md](CONCEPT.md); the comparison that fed Phase 2 is in
[concepts/reference-tool-comparison.md](concepts/reference-tool-comparison.md).

Way of working, unchanged: milestones ordered by payoff per hour, stories cut into a sprint only
once the previous milestone is accepted. M6 goes first because M5 is blocked on a decision and M7
is the largest, least-bounded piece of work in the phase — the adapter seam is worth proving on a
codebase that has just stopped changing shape, not while it still is.

### M5 — Exact context windows — blocked on a product decision

Not schedulable until the network-promise trade in
[005](requirements/005-exact-context-windows.md) is decided: opt-in fetch with reworded README
and Diagnostics, or close the story as rejected and keep labelling the gauge an estimate.

Stories: [005](requirements/005-exact-context-windows.md)

### M6 — Attribution — built, acceptance pending (S04 built)

Live status counts per project group, and history grouped by project / branch / model with totals.
Depends on M1 for the group headers it renders into, and inherits a half-built live side from M3.

Stories: [006](requirements/006-activity-and-history-attribution.md) — the milestone, `in-progress`
(built, live acceptance pending) · [013](requirements/013-s03-residuals.md) — the S01–S03
residuals, bundled alongside, `in-progress` (built, live acceptance pending)
Sprints: [S04](sprints/S04/sprint.md) — built; branch `sprint/S04`; see
[review](sprints/S04/review.md) and [testplan](sprints/S04/testplan.md)
Gaps/notes:
- 010 already shipped the popover's group rollup (coloured dot + count per status, zero counts
  omitted) but *renderer-locally*, in `popoverModel.ts`. S04 lifted it into the shared layer
  (`ProjectGroup.statusCounts` in `aggregate.ts`) and gave the main window the same counts via a
  shared `StatusRollup` component — two implementations of the same number no longer exist. The
  popover's rendered output did not visibly change; M3 stays accepted.
- 006 was deliberately **not** split into a live and a retrospective story: both halves rest on the
  same "one number, one source" argument. This made S04 a two-story sprint.
- N5 was the risk flagged in planning, not the UI: per-entry usage in the history index reads more
  per file than before. Measured at cold start (~250 MB / 300 files, history indexing + usage
  summation included in the timed window): **441 ms**, against a 2000 ms budget.
- 013 bundled the four carried points and all four landed: Diagnostics now reports the
  `ProtocolRegistration` actually written at startup instead of recomputing a string (and a failed
  registration is visible instead of swallowed); the popover's group order now demotes an
  already-seen `waiting`/`done` below `ended` via `popoverGroupRank()`, scoped narrowly to the
  popover as decided, `compareSessions` untouched; `--text-faint` and light `--muted-opacity` clear
  the theme test's contrast targets in both schemes; the subagent list's flat-hierarchy note is no
  longer a non-`listitem` member of `role="list"`.
- **Live UI acceptance pending for both stories (P2):** the build ran in a headless session with no
  path to drive the Electron tray app or a screen reader, so both stories are left `in-progress`
  rather than `done` despite green build/test/typecheck and a passed code review. The user does the
  manual pass in [testplan.md](sprints/S04/testplan.md) before either is marked accepted.
- Still not scoped anywhere: new tray tile art for a light taskbar (007 left it as a follow-up;
  only the badge rim is theme-aware).

### M7 — Second agent — planned (last in the phase)

Codex or Gemini CLI alongside Claude Code, as the first real test of the adapter boundary. Its
own milestone by construction.

Stories: [008](requirements/008-second-agent-adapter.md)

---

## Open / unprioritised

| Topic | State | Next step |
| --- | --- | --- |
| Cost display | **Rejected for v1** (CONCEPT.md §2). Groundwork and the seven measured caveats are preserved in [concepts/reference-tool-comparison.md](concepts/reference-tool-comparison.md) so they are not re-derived | none — reopen only if the presentation problem ("notional list rate, not what a subscription bills, not the `/usage` quota") is solved first |
| Web dashboard | **Rejected.** Contradicts the "no HTTP server, nothing on the network" property in README.md and Settings → Diagnostics; `npm run cli -- --watch` covers the scriptable case | none |
