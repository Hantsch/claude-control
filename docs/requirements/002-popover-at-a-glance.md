---
id: 002
title: Popover at a glance
status: ready # draft -> ready -> in-progress -> done
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

- ~~**Which count goes in the header?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Which count goes in the header: the plain count of currently-waiting sessions
  (not `state.attention`), so the header number always agrees with the waiting dots visible
  in the list below it.
- **Waiting count is counted over `state.traySessions`, not `state.sessions`** — the user
  decision demands agreement with the dots *visible below*, and the popover list is
  `traySessions` ([popover.tsx:78](../../src/renderer/popover.tsx#L78)).
- **The quick-switch is an in-renderer React dropdown, not `Menu.popup`** — the popover hides
  on the window's `blur` ([windows.ts:195](../../src/main/windows.ts#L195)) and the only
  existing suppression is the pin; a plain React overlay creates no second focus target, so
  AC 2 falls out for free and no main-process change is needed.
- **Four modes mapped onto the existing booleans, no new settings field** — `off`
  (`enabled:false`), `waiting`, `done`, `all`; `enabled:true` and `cooldownMs` stay untouched
  by the other three, so nothing about the default stance changes
  ([settings.ts:132](../../src/core/model/settings.ts#L132)) and mode `off` restores the
  previous on/off pair when switched back on.
- **Writing uses `api.setSettings({ ...settings, notifications: {...} })` exactly like
  `SettingsView.apply()`** ([SettingsView.tsx:29](../../src/renderer/components/SettingsView.tsx#L29))
  — the store merges and broadcasts `onSettingsChanged`, which the Settings tab already
  subscribes to, so AC 1 needs no new IPC.
- **Grouping reuses `groupSessions()` from
  [aggregate.ts:101](../../src/core/state/aggregate.ts#L101), called on `traySessions`** —
  `state.groups` is built over *all* sessions and would show rows the popover deliberately
  hides; the function is pure (type-only imports), so calling it in the renderer costs nothing
  and keeps one grouping rule in the app.
- **Group order: most urgent session first (`STATUS_SORT_RANK`), tie-break by project name** —
  rows inside a group are already sorted that way by `compareSessions`, so the top row of the
  top group is exactly the session that colours the tray icon (§6.5 urgency order), which is
  what "the group explaining the badge" means.
- **The dropdown renders in the flow of `.popover-head`, and `report()` observes head + footer
  too** — the window height is set from `report()`, so an absolutely positioned menu would be
  clipped at the window edge; observing all three regions also covers group headers (AC 12).
- **Row grid grows to 8 columns instead of a second row line**
  (`14px 2.1fr 1.5fr 1.2fr 58px 46px 62px 62px` over the fixed 620 px,
  [windows.ts:17](../../src/main/windows.ts#L17)) — every new value is one glance-token; a
  second line per row would double popover height, and all flexible cells keep the existing
  `text-overflow: ellipsis`, so nothing can widen the window.
- **Unknown model ids pass through unchanged, `null`/blank renders nothing** — mirrors
  `SessionState.ModelDisplayName` (`SessionState.cs:61`), and "nothing, not a placeholder"
  (AC 5) is about the absent case; a live but unrecognised id is information, not noise.
- **`[1m]` renders as a separate `· 1M` suffix** (`Opus 5 · 1M`) — the suffix changes what the
  context gauge means, so it must stay legible rather than glued into the name.
- **The detail pane keeps its `—` fallback** ([SessionDetailPane.tsx:76](../../src/renderer/components/SessionDetailPane.tsx#L76))
  and gains the raw id as `title` — a `<dl>` row with an empty `<dd>` reads as broken, and the
  raw id is still the thing you copy into a bug report.
- **Uptime gets its own cell with an `↑` prefix and a "Running for …" tooltip, ≥ 1 h only** —
  `SessionRow.cs:116` keeps the two durations apart spatially; in a single-line grid the arrow
  plus tooltip is the equivalent that keeps it from reading as a second age.
- **`formatAge` changes for all callers, not just the popover** — AC 11 says "on every
  surface", and `formatAge` is the single age formatter
  ([format.ts:3](../../src/renderer/lib/format.ts#L3)); the existing `< 1 s → 'now'` branch is
  absorbed by the new `< 5 s → 'just now'`.
- **New unit tests go to `test/unit/presentation.test.ts`** — vitest only collects
  `test/unit/**/*.test.ts` in a Node environment
  ([vitest.config.ts:7](../../vitest.config.ts#L7)); both new functions are pure and need no DOM.

## Plan

Renderer + shared only, no engine work. Order matters: layout groundwork first, then one
glance-token per deliverable, the quick-switch last (largest, most isolated).

1. **Groundwork (D1):** widen the `.popover-row` grid in
   [styles.css](../../src/renderer/styles.css) to the 8 columns above and make `report()` in
   [popover.tsx](../../src/renderer/popover.tsx) observe `head` and `foot` alongside `rows`, so
   every later addition (group headers, dropdown) resizes the window correctly.
2. **Structure (D2):** replace the flat `traySessions.map` with
   `groupSessions(state.traySessions)`, a compact `.popover-group-head` per group (name +
   count), suppressed when there is exactly one group. Branch stays on the row.
3. **Row content (D3–D6, D9):** `modelDisplayName()` in
   [presentation.ts](../../src/shared/presentation.ts) + test; model badge on the row and in
   [SessionDetailPane.tsx](../../src/renderer/components/SessionDetailPane.tsx); waiting reason
   replacing the branch in `.where`; tool + `· subagent` in `.status` mirroring
   [SessionsView.tsx:129-137](../../src/renderer/components/SessionsView.tsx#L129-L137); uptime
   cell from `startedAt`.
4. **Signals (D7, D8, D10):** halo on the waiting dot in
   [StatusDot.tsx](../../src/renderer/components/StatusDot.tsx) (colour from
   `--status-waiting`, so it cannot drift), waiting count in the header, `just now` in
   [format.ts](../../src/renderer/lib/format.ts).
5. **Quick-switch (D11):** in-renderer dropdown in the header over the existing
   `getSettings`/`setSettings`/`onSettingsChanged` API.

Verify per deliverable: `npm run typecheck`, `npm test`, `npm run build`; final acceptance via
`npm run dev` (see Test Plan).

## Deliverables

- [ ] D1 — **Layout + self-measure groundwork.** `.popover-row` grid goes to
      `14px minmax(0,2.1fr) minmax(0,1.5fr) minmax(0,1.2fr) 58px 46px 62px 62px` with the
      ellipsis rules extended to the new cells; `report()`'s `ResizeObserver` observes `head`
      and `foot` in addition to `rows`. Files:
      [styles.css](../../src/renderer/styles.css) (`.popover-row` block ~691-725),
      [popover.tsx](../../src/renderer/popover.tsx#L56-L72).
      *Acceptance:* popover renders unchanged visually, empty new cells collapse, window height
      still matches content on open/close and when the list changes length.
- [ ] D2 — **Group rows by project.** `groupSessions(state.traySessions)` instead of the flat
      loop; `.popover-group-head` (project name + `N session(s)`, dim, ~11 px) mirroring the
      wording of `.project-header` in
      [SessionsView.tsx:72-81](../../src/renderer/components/SessionsView.tsx#L72-L81) but sized
      for the popover; groups sorted by most urgent session then name; exactly one group ⇒ no
      header at all. Files: [popover.tsx](../../src/renderer/popover.tsx),
      [styles.css](../../src/renderer/styles.css).
      *Acceptance:* multi-project state shows headers with the waiting group on top, a
      single-project state shows none, height stays correct in both.
- [ ] D3 — **`modelDisplayName()` in
      [presentation.ts](../../src/shared/presentation.ts)** — strip everything up to the last
      `.` (`us.anthropic.…`), split off a trailing `[…]` suffix, drop `claude-`, title-case the
      hyphen-separated words, re-append the suffix upper-cased as ` · 1M`; unknown shapes
      returned unchanged, `null`/blank ⇒ `null`. Mirror: `SessionState.cs:61`. Test in
      `test/unit/presentation.test.ts` over `claude-opus-5[1m]`, `claude-sonnet-4-5`,
      `us.anthropic.claude-opus-5`, an unknown id, `null`, `''`.
      *Acceptance:* `npm test` green, no throw on any input.
- [ ] D4 — **Model badge.** New `.model` cell on the popover row (dim pill, `title` = raw id,
      nothing rendered when the formatter returns `null`), and
      [SessionDetailPane.tsx:76](../../src/renderer/components/SessionDetailPane.tsx#L76) uses
      the formatter with the raw id as `title`, keeping `—`.
      *Acceptance:* a running session shows e.g. `Opus 5 · 1M`; a session without a model shows
      an empty cell, no dash.
- [ ] D5 — **Waiting reason inline.** For `status === 'waiting'` the `.where` cell renders
      `statusReason` in `var(--status-waiting)` instead of `project · branch` (project name is
      already in the group header from D2), ellipsized, full text still on the row `title`.
      Mirror: `SessionRow.cs:166`. File: [popover.tsx](../../src/renderer/popover.tsx#L135-L138),
      [styles.css](../../src/renderer/styles.css).
      *Acceptance:* a long reason ellipsizes and the window width never changes.
- [ ] D6 — **Tool + subagent marker** in `.status`, copied from
      [SessionsView.tsx:129-137](../../src/renderer/components/SessionsView.tsx#L129-L137)
      (`session.pendingTool.name`, `· subagent` when any `subagents[].status === 'running'`,
      `pendingTool.hint` as tooltip). File: [popover.tsx](../../src/renderer/popover.tsx).
      *Acceptance:* a working session with a tool reads `working · Bash`; without one, just
      `working`.
- [ ] D7 — **Halo on the waiting dot.** [StatusDot.tsx](../../src/renderer/components/StatusDot.tsx)
      adds a `halo` class for `waiting` only; CSS `box-shadow` derived from `--status-waiting`
      so it cannot drift; check the popover row/list padding does not clip it.
      *Acceptance:* the waiting dot is the only one with a halo, in popover **and** main window.
- [ ] D8 — **Waiting count in the header** — count of `traySessions` with `status === 'waiting'`
      rendered in `var(--status-waiting)` when > 0, next to the existing session count, which
      stays as-is when zero; keeps the existing `· N settled` hint. File:
      [popover.tsx:84-95](../../src/renderer/popover.tsx#L84-L95).
      *Acceptance:* header number equals the number of waiting dots below it.
- [ ] D9 — **Uptime cell** from `startedAt`, only when `now - startedAt >= 1 h`, rendered
      `↑{formatDuration(...)}` dim with `title="Running for …"`, in its own 46 px column left of
      `.age`. Mirror: `SessionRow.cs:116`. Files:
      [popover.tsx](../../src/renderer/popover.tsx), [styles.css](../../src/renderer/styles.css).
      *Acceptance:* a session younger than an hour shows an empty cell; an older one shows
      `↑3h 12m` clearly distinct from `4m ago`.
- [ ] D10 — **`just now` under 5 s** in [format.ts](../../src/renderer/lib/format.ts)
      `formatAge` (replaces the `< 1 s → 'now'` branch). Mirror: `SessionRow.cs:190`. Boundary
      test (4 999 ms / 5 000 ms) in `test/unit/presentation.test.ts`.
      *Acceptance:* `npm test` green; popover, main list and history all read `just now`.
- [ ] D11 — **Notification quick-switch in the popover header.** In-renderer dropdown button
      (`notify: all ▾`) next to pin/close: reads `api.getSettings()` and stays in sync via
      `api.onSettingsChanged`; four items (No notifications / When a session needs me / When a
      session is done / Both) mapped onto `notifications.enabled|onDone|onWaiting`; writes via
      `api.setSettings({ ...settings, notifications: { ... } })`; menu closes on select,
      `Escape` and outside click *inside the popover*; defaults untouched. Files:
      [popover.tsx](../../src/renderer/popover.tsx), [styles.css](../../src/renderer/styles.css);
      pattern: [SettingsView.tsx:29-34](../../src/renderer/components/SettingsView.tsx#L29-L34).
      *Acceptance:* switching the mode persists, the popover stays open while the menu is up,
      and the Settings tab in the already-open main window updates without a reload.

## Model Hints

- D11 → `deliverable-hard` — the only cross-layer piece: settings semantics (four modes over
  three booleans without disturbing the `enabled: true` default) plus the focus/blur trap that
  the popover auto-hides on `blur` unless pinned.
- D1–D10 → default tier (single-file or two-file renderer changes with explicit acceptance).
- Review: → `story-review-hard` — 12 acceptance criteria across 11 deliverables, and two
  changes (`formatAge`, `StatusDot`) hit every surface of the app, so a regression here is
  invisible in the story's own diff.

## Test Plan (manual acceptance)

Run `npm run dev` (electron-vite dev; unset `ELECTRON_RUN_AS_NODE` when launching from VS Code)
and open the tray popover by clicking the tray icon. All steps are done in the popover UI.

1. **Glance:** with at least two projects live, confirm project headers appear, the group with
   the most urgent session is on top, and rows show model badge, status (`working · Bash` when a
   tool runs) and, for sessions older than an hour, an `↑…` uptime.
2. **Single project:** with only one project live, confirm no group header is rendered and the
   popover height fits exactly (no scroll bar, no gap at the bottom).
3. **Waiting:** trigger a permission prompt in a Claude Code session. The row's dot shows a
   halo, the reason replaces the branch text in the waiting colour, a very long reason
   ellipsizes without the popover getting wider, and the header shows the waiting count in the
   same colour — equal to the number of haloed dots.
4. **Quick-switch:** click `notify: …` in the header. The popover must stay open with the menu
   up (unpinned!). Pick "When a session is done", then open the main window's Settings tab
   *without restarting* and confirm the notification checkboxes match. Reopen the popover:
   the header still shows the chosen mode.
5. **Fresh age:** touch a session and reopen the popover within 5 s — the age reads
   `just now`, not `0s ago`; after ~10 s it reads `10s ago`.

## Done
