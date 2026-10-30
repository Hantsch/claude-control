# Roadmap

The one source of status and planning. It is a map: story truth lives in
[requirements/](requirements/), sprint detail in each sprint's `review.md`, design in
[CONCEPT.md](CONCEPT.md) and [concepts/](concepts/). This file links and does not repeat them.

## Where we stand

As of 2026-10-30:
- **Current:** Phase 3, Accuracy & breadth.
- **Last finished:** M9, Trustworthy test lanes (S07, committed on `dev`): timing budgets in their own perf lane, a release lane that tests only a due release and recovers a tag without a release.
- **Next:** M7 (second agent) in a sprint of its own.
- **Waiting on the user:** pushing `dev`.

## Phase overview

| Phase | Goal | Milestones | Status |
| --- | --- | --- | --- |
| 1 — v1 tray app | Every running Claude Code session is visible, its status is inferred correctly, and you are told when one finishes or is blocked | — | ✔ done |
| 2 — Daily use | The popover answers "which session needs me, and what for" without a click, and the app is running when it matters | 4/4 | ✔ done 2026-08-21 |
| 3 — Accuracy & breadth | The context gauge stops being an estimate, history attributes work over time, and the adapter seam is proven by a second agent | 4/5 | ▶ in progress |

## Current phase: 3 — Accuracy & breadth

Design of record: [CONCEPT.md](CONCEPT.md). Milestones are ordered by payoff per hour.

| # | Milestone | Status | Sprints | Note |
| --- | --- | --- | --- | --- |
| M5 | Exact context windows | done 2026-08-23 | [S05](sprints/done/S05/review.md) | The LiteLLM lookup is an opt-in, off by default, and the "no network" claim was reworded. |
| M6 | Attribution | done 2026-08-22 | [S04](sprints/done/S04/review.md) | Live counts per project group and history grouped by project, branch and model, from one shared source. |
| M8 | Trust the live list | done 2026-10-30 | [S06](sprints/done/S06/review.md) | Claude Code's own status, subagent activity, VS Code session names and hidden-session counts. |
| M9 | Trustworthy test lanes | done 2026-10-30 | [S07](sprints/done/S07/review.md) | Timing budgets run in a weekly perf lane, the release lane tests only a due release, and the lanes are written down in CLAUDE.md. |
| M7 | Second agent | planned, last in the phase | — | Story [008](requirements/008-second-agent-adapter.md) is a draft and gets a sprint of its own. |

## Open / unprioritised

| Topic | State | Next step |
| --- | --- | --- |
| Cost display | Rejected for v1 (CONCEPT.md §2); the groundwork is in [concepts/reference-tool-comparison.md](concepts/reference-tool-comparison.md) | none — reopen only if the presentation problem is solved first |
| Web dashboard | Rejected: it contradicts "no HTTP server"; `npm run cli -- --watch` covers the scriptable case | none |
| WSL sessions | Invisible to the Windows app (one `.claude` root, WSL PIDs can't be checked); dismissed as an edge case on 2026-08-23 | none |

## Follow-ups worth doing

- Subagent chips still render `'estimated'` unconditionally, even where the gauge says "exact" ([S05 review](sprints/done/S05/review.md)).
- The CLI reads the exact-window cache but never fetches. Confirm this is what "the CLI honours the setting" meant ([S05 review](sprints/done/S05/review.md)).
- 021: origin markers are only tested together; the history sidecar branch and `readDetail` titles have no dedicated test ([S06 review](sprints/done/S06/review.md)).
- 022: `EventRow.hasMore` is computed but not rendered, so a clipped event row does not say so ([S06 review](sprints/done/S06/review.md)).
- No e2e harness: every UI criterion since S01 is proven below the rendered app, and 027 removed the source pins on the renderer half of the navigate/detail flows ([S06 review](sprints/done/S06/review.md), [S07 review](sprints/done/S07/review.md)).
- 024: the recovery path's package.json-vs-tag mismatch and missing-CHANGELOG-section throws have no test ([S07 review](sprints/done/S07/review.md)).
- `networkPromiseWording` pins "are the two exceptions" but not "no outbound requests" in the README ([S07 review](sprints/done/S07/review.md)).
- History paging is unbuilt: the `≥` marker says totals are a lower bound, not complete ([015](requirements/done/015-s04-residuals.md)).

## History

| Phase | Milestone | Done | Sprint |
| --- | --- | --- | --- |
| 2 | M1 — Popover at a glance | 2026-08-21 | [S01](sprints/done/S01/review.md) |
| 2 | M2 — Always there, no mouse required | 2026-08-21 | [S02](sprints/done/S02/review.md) |
| 2 | M3 — Popover drill-down | 2026-08-21 | [S03](sprints/done/S03/review.md) |
| 2 | M4 — Light theme | 2026-08-21 | [S03](sprints/done/S03/review.md), tray tile for a light taskbar in [S05](sprints/done/S05/review.md) (014) |
| 1 | v1 tray app | before 2026-08-21 | see git history |
