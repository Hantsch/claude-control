# Sprint S04 — Review

## Overview

**Goal.** "Which project needs me" and "where did my week go" are answered by the same numbers
everywhere: project group headers show their status counts in the main window as well as the
popover, computed in one place instead of two, and the history view can be grouped by project,
branch or model with per-group totals. Alongside it, the four points S01–S03 left open are closed.

**Reached.** Both stories built, reviewed and committed. Neither is live-accepted: this run was
headless, so both user-facing stories are handed over for manual acceptance rather than presented
as done.

| Story | Status | Commit |
| --- | --- | --- |
| 006 — Activity matrix and history attribution | built, live acceptance pending | `006: activity matrix and history attribution` |
| 013 — S03 residuals — reported registration, seen-aware group order, contrast, ARIA | built, live acceptance pending | `013: S03 residuals — reported registration, seen-aware group order, contrast, ARIA` |

Branch: `sprint/S04`, cut from `dev`. Verification at the end of the sprint: `npm run typecheck`,
`npm test` (320 tests, 20 files) and `npm run build` all green. Test count went 293 → 309 → 320
across the two stories.

## Implemented stories

**006 — Activity matrix and history attribution.** The live half: per-status counts moved out of
the popover's renderer-local `groupStatusRollup` into `ProjectGroup.statusCounts`, computed once in
`aggregate.ts`, and rendered by a new shared `StatusRollup` component in both the popover (unchanged
output — 010 stays accepted) and the main window's group header, which now shows the counts in
place of the old `N sessions · M need attention` line, per the sprint's user decision. The
retrospective half: `HistoryEntry` carries a tail-derived `usage`/`usageComplete` (total tokens,
excluding cache reads), upgraded to the exact total when a row's detail is opened; `groupHistory()`
groups the already-filtered page by project, branch or model with per-group totals, an explicit
"not counted" count for entries without usable usage, and a `~` prefix on a partial total, rendered
as collapsible sections that replace the flat list. N5 was measured rather than assumed: cold start
with history indexing and usage summation in the timed window came to 441 ms against a 2000 ms
budget.

**013 — S03 residuals.** All four bundled points closed. Diagnostics now reports the
`ProtocolRegistration` record the real startup-time `setAsDefaultProtocolClient` call actually
produced — `registered` / `failed` / `unsupported` plus path — instead of recomputing a string on
request; a failed registration renders as a visible warning instead of being swallowed, and a
packaged non-portable install shows the real `process.execPath` instead of the `<installed exe>`
placeholder. The popover's group order now runs through `popoverGroupRank()`, which scans every
session in a group and demotes an already-seen `waiting`/`done` below `ended`, scoped narrowly to
the popover as decided — `compareSessions` and the main window's session list are untouched.
`--text-faint` and the light scheme's `--muted-opacity` were raised to clear the theme test's 3:1 /
4.5:1 targets in both schemes, including the selected-row case a first pass missed. The subagent
list's flat-hierarchy note is now a DOM sibling of `role="list"` instead of a non-`listitem` member
of it.

## Findings & decisions

**User decisions bundled in the clarification round (phase 1a), all recorded verbatim in the
stories under `## Decisions (Sprint)`:**
- 006: the main window's group header shows the new per-status counts *in place of*
  `N sessions · M need attention`, not alongside it. "Usage" is total tokens. Grouping is one
  dimension at a time (project *or* branch *or* model), rendered as collapsible sections replacing
  the flat list. An already-built index fills in the usage total lazily on next read rather than
  a background recompute or wholesale invalidation. Grouping composes with the existing filters.
- 013: a failed protocol registration only needs to be visible in the Diagnostics field, not a
  separate Settings warning row. The seen/unseen ranking fix is scoped to the popover's group order
  only, not `compareSessions`. "Seen" for the ranking is exactly the badge's acknowledgement flag.
  The contrast fix applies to both the light and dark schemes.

**Decisions taken by the refine/build agents themselves, verified against the acceptance criteria
and documented in the stories (not re-litigated here in full — see each story's `## Decisions
(Sprint)` and `## Done`):**
- 006: counts live as a field on `ProjectGroup` rather than a helper both surfaces must remember to
  call; per-entry usage is summed from the tail window the index already reads (no extra I/O),
  with an honest `usageComplete` flag rather than a silently understated total; the stored metric
  is the full `UsageTotals` breakdown so the *displayed* figure can change later without a
  re-index; groups sort by descending total, ties by label, grouping defaults to off.
- 013: the Diagnostics record is structured (not a formatted string) so a failure can be
  distinguished from a path; the group-rank comparator lives next to 006's shared group code with
  the popover as its sole caller, enforcing the narrow scope by call site rather than by copy; a
  demoted seen session still preserves waiting-before-done order among the demoted.

**Review findings fixed during build (both stories passed `story-review-hard` after one fix
cycle):**
- 006: `readDetail` conflated zero-usage with no-usage (fixed — `SessionDetail.usage` is now
  nullable); the lazy usage fill-in on detail read was never wired to a UI trigger (fixed — opening
  a history row's detail now fires it); grouped history sections were keyed/collapsed by display
  label rather than a stable id, a collision risk across projects with the same display name
  (fixed — `HistoryGroup.key` added); `engine.getDetail`'s history-changed emit hardcoded
  `done: true` instead of following the existing `!indexingHistory` convention (fixed); `.rollup`
  lost a flex shrink-guard the old `.project-header .count` rule had (fixed).
- 013: the contrast fix and its guarding test were scoped to page surfaces only, missing the
  selected-row (`--bg-active`) case AC6 actually covers (fixed — light `--muted-opacity` raised
  0.62 → 0.65, test widened to all four surfaces).

**Accepted as out of scope / low-risk, not fixed under either story:**
- 006: the history view's pre-existing 200-entry page size means a group total on a >200-match
  filter silently reflects only the fetched page, with no marker distinguishing it from a complete
  total — predates this story and paging was never in its plan; flagged for a future story. Also:
  the N5 test attaches its listener after `await engine.start()` returns, a latent flake shape
  already shared with an existing N2 test in the same file, not a regression introduced here.
- 013: moving `.flat-note` out of `.popover-subagents` loses a 1px flex gap it inherited from that
  container — a sub-pixel spacing change, not a behaviour or wording change; left for live smoke to
  eyeball rather than fixed speculatively.
- Neither story added a render harness (none exists in this project; vitest runs without jsdom),
  so `StatusRollup`, the grouped history rendering, the main-window header change and the
  Diagnostics/popover JSX changes rest on source-level guard tests plus manual review of the
  diff — the same constraint stories 010/011 worked under.

## Built, live acceptance pending

**Both stories.** `live-smoke-required: true` and `ui-acceptance-required: true` are set in the
project profile, and this run could not satisfy either: there was no way to launch `npm run dev`
and drive the Electron tray app (or a screen reader, for 013's ARIA fix) from this headless
session. Both stories are left `in-progress` rather than `done` despite green build/test/typecheck
and a passed code review. Nothing here is claimed as accepted.

What specifically still needs a human at the keyboard, per [testplan.md](testplan.md):

- 006 — the main window's group header showing the new counts in place of the old summary line;
  the popover looking unchanged from before this sprint; grouping the history view by project,
  branch and model with totals that update as filters change; a history entry's usage total
  appearing after its detail panel is opened.
- 013 — the Diagnostics field showing a real registered path (or a visible failure) rather than a
  recomputed one; the popover group order with a seen and an unseen session in different projects;
  the light and dark themes' contrast at the affected surfaces; a screen reader announcing the
  subagent list's item count correctly.

## Blocked / open

No story is blocked. No question is waiting on a user decision — all nine open questions from the
two stories' clarification round were answered up front and are recorded in each story's
`## Decisions (Sprint)`.

Carried forward, not part of this sprint's scope: M5 (exact context windows) stays blocked on the
network-promise trade in story 005; M7 (second agent) waits; new tray tile art for a light taskbar
remains an unscoped follow-up.

Merging `sprint/S04` into `dev` is the user's decision after live acceptance.
