# Sprint S06 — Review

**Sprint goal:** the live surfaces stop being wrong about what is running. Claude Code's own
status word outranks what the app infers from the transcript, every session carries the name VS
Code shows for it, a popover row says which project it belongs to, and a live session that a
filter removed is visible as a number. Alongside, a past session opens in its own resizable window.

**Branch:** `sprint/S06` (cut from `dev`) · **Milestone:** M8 — Trust the live list

## Overview

| Story | Status | Commit |
| --- | --- | --- |
| 020 — Claude Code's own status outranks the transcript | done | `d80545d` registry busy/idle/waiting outranks transcript inference; waitingFor on surfaces |
| 016 — A session working through a subagent is not `done` | done | `945995f` subagent writes after end_turn keep the session working |
| 021 — A session is called what VS Code calls it | done | `c280d05` label = custom-title › ai-title › last-prompt, human-only prompts |
| 017 — The popover row says which project it is | done | `2c9cb91` popover row names its project |
| 018 — A hidden session says it is hidden | done | `8360b2e` hidden sessions say so; busy/waiting never hidden |
| 022 — A past session opens in its own, resizable window | done | `2b6439d` past session opens in its own detail window |

Six of six done, none blocked. Regression gate green.

## Implemented stories

- **020** — The registry `status` is now the primary input to `deriveStatus`: `busy` lifts a
  passive transcript reading to `working` (keeping an open tool, `stale` when overdue), `idle`
  turns an in-flight reading into `interrupted` (trusted only if not older than the newest
  transcript record by more than 2 s). Registry-decided statuses carry `statusSource: 'reported'`
  and a "Claude Code reports …" reason; `waitingFor` reaches the toast, row and detail pane via
  one helper. CONCEPT §6.2/§6.3/§12 reworded.
- **016** — For sessions without a registry `status`, subagent writes in the last 10 min after an
  `end_turn` keep the session `working` ("subagent still running"); with `busy` the evidence is
  appended to the reason. A session-wide hot/cold `subagents/` scan never opens a transcript.
  Fixed a pre-existing bug: subagent evidence froze while the parent transcript was unchanged.
- **021** — Label precedence custom-title (transcript record, sidecar for long files) › ai-title ›
  `last-prompt` › newest human prompt, read from VS Code's extension. Injected `user` records
  (peer hand-backs, task notifications, `isMeta`, IDE notices) are no longer prompts, and no
  longer restart "running for …".
- **017** — Popover rows read `project · branch` (project emphasised, branch truncated first,
  full text in the tooltip) inside the existing label cell; group heads unchanged.
- **018** — The engine reports `hidden: { count, causes }`; the main window shows "· N hidden" by
  the Sessions tab and the popover header after "· N settled", with a tooltip naming the filters by
  their Settings labels. A registry-`busy`/`waiting` session is exempt from every filter.
- **022** — One reusable, resizable detail window (min 640×420, geometry in
  `detail-window.json`, restored only on a connected display) opened from History: header facts,
  subagent tree, run-grouped timeline (collapsed, paged by 200), copy path / show file, Esc.

## Findings & decisions

User decisions from the clarification round (recorded as `(User)` in each story): a delegating
session is `working` with a reason, not its own status (016); the registry is the primary input
(020); `busy` via `delegatedActive` stays `working` however quiet the subagent files are (020);
hidden sessions are one number plus a tooltip (018); a renamed session follows VS Code's order,
the registry `name` is the last fallback (021); one detail window, History only (022).

Notable agent decisions and findings:

- 020's refine reworded AC6: one existing test asserted that `busy`/`idle` are ignored — the rule
  this sprint reverses. It was narrowed to unrecognised status values.
- 016 accepted one edge: a cold subagent resuming after the 10-min window is picked up on the next
  full pass (≤ 60 s), which can produce a second `done` notification in that rare case.
- 021 read VS Code's title order from `extension.js`/`claude.exe` 2.1.312; no live `/rename` was
  run, to avoid writing to a live session.
- 017's first implementation duplicated ~900 lines of `styles.css`; the review caught it, the file
  was rebuilt from `HEAD`, and the layout test now asserts a single `.popover-row .l1` rule. Later
  build prompts told implementing agents to edit surgically; it did not recur.
- 022's review found a real bug (re-clicking the shown session left the window stuck on
  "Reading transcript…", an early retarget was lost); fixed with tests. No second review ran after
  that fix — only the narrow gate.
- `CHANGELOG.md` has no `# Features` / `# Fixes` headings, only a flat `## Unreleased` list; every
  story appended there. All six user-facing entries are present — none added late.
- Progress-trail timestamps are monotonic and shell-generated in all six builds.

Unfixed review notes (small, decision-free) became follow-up lines in the
[roadmap](../../../ROADMAP.md) under M8: e2e harness, 021's untested branches, 022's unused
`EventRow.hasMore`. Cosmetic leftovers not worth a line: a stale "branch column" comment in
`styles.css`, Fragment indentation in `App.tsx`, `hidden` vs `hiddenBadge` naming in the popover.

## Blocked / open

Nothing blocked. Merging `sprint/S06` into `dev` is the user's decision.

## Regression gate

Ran once on `2b6439d`: `npm run build` (0.03 min), `npm test` — 38 files, 577 tests (0.1 min),
`npm run typecheck` (0.02 min). All green. `e2e` and `e2e-all` are `none` in the profile, so no
flow suite ran; nothing to attribute, no quarantine (the project has none yet).

## Acceptance

Every criterion is mapped to a named test in its story's Done section, and all passed. No story has
a `manual residue`, so no `testplan.md` was written — nothing here needs walking by hand.

- **020** — AC1/2/4/5 `machine.test.ts`; AC6 existing machine table + narrowed "carries any other
  reported status…"; AC3 `presentation.test.ts` (`waitingOnText`); AC7/AC8 `pipeline.test.ts`
  "a delegating session turns done only when the registry goes idle…" (real watcher).
- **016** — AC1–AC4 `pipeline.test.ts` delegating/re-tasked flows; AC5 machine settle + engine
  single transition; AC6 machine end_turn/busy-evidence tests; AC7/AC8 `subagentActivity.test.ts`
  (stat counts, no transcript opened, no directory).
- **021** — AC1/AC5/AC6 `pipeline.test.ts`; AC2/AC3 `derivations.test.ts` + `reading.test.ts`;
  AC4 `reading.test.ts` + `pipeline.test.ts` (run start skips hand-backs); AC7 `reading.test.ts`.
- **017** — AC1/2/3/5 `popoverModel.test.ts` › rowPlace; AC4 `popoverRowLayout.test.ts`; AC6 by
  diff-scope check in review (nothing under `src/main/`, no main-window component).
- **018** — AC1/AC5/AC6 `pipeline.test.ts` + `derivations.test.ts`; AC2–AC4
  `hiddenSessions.test.ts` (helper + source wiring).
- **022** — AC1/AC5 `detailWindow.test.ts`; AC2/AC6 `detailWindowState.test.ts`; AC3/AC4/AC8
  `detailModel.test.ts`; AC7/AC9 `detailWindowWiring.test.ts`; AC4/AC10 `detailWindowStyles.test.ts`.

**Covered below the real surface** (`ui-acceptance-required: true`, `e2e: none`): every UI
criterion of this sprint — 016's "every live surface" (proven at the engine snapshot), 020's row
and detail-pane `waitingFor`, 021's labels, 017's truncation at 620 px, 018's tab bar and popover
header, 022's window behaviour — is proven by pure helpers, engine snapshots and source-level
wiring checks. No test drives the rendered Electron app.

## Tier record

| Story | Ds | hard Ds | review stages | review cycles | agents | build min |
| --- | --- | --- | --- | --- | --- | --- |
| 020 | 5 | 1 | default | 1 | 10 | 9 |
| 016 | 3 | 1 | default | 1 | 6 | 9 |
| 021 | 3 | 1 | default | 1 | 6 | 10 |
| 017 | 1 | 0 | default | 1 | 6 | 4 |
| 018 | 2 | 0 | default | 1 | 5 | 4 |
| 022 | 5 | 0 | default | 1 | 8 | 10 |
| **Total** | **19** | **3** | 0 hard reviews | 6 | 41 | 46 |

Refine took 6 min for all six in parallel. No story used a second-stage (hard) review, so there is
nothing to compare it against; the default review caught the two substantive problems of the sprint
(017's duplicated stylesheet, 022's stuck window).
