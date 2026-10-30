---
id: 022
title: A past session opens in its own, resizable window
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — Clicking (or Enter on) a History row opens that session in its own window,
      separate from the main window
- [x] **AC2** — The window is freely resizable, with a minimum size at which nothing is cut
      off, and it opens at a size large enough to read the timeline without resizing first
- [x] **AC3** — The window shows what `SessionDetail` already carries: title, project,
      branches, models, start/end/duration, token totals, the subagent tree and the timeline
      of events — not only what the notice shows today
- [x] **AC4** — Long content scrolls inside the window; resizing reflows it instead of
      clipping it
- [x] **AC5** — Opening a second session either reuses the window or opens a second one —
      decided in refine, and the same way every time; opening the same session twice never
      produces two windows for it
- [x] **AC6** — The window remembers its size (and position, if on a still-connected display)
      across opens and app restarts
- [x] **AC7** — Copy path / Show file stay available, and the window closes with Esc
- [x] **AC8** — A large transcript opens without freezing the main window: the parse stays
      in the main process, the window shows a loading state, and a `truncated` detail says so
- [x] **AC9** — The notice under the History table is gone; nothing else in History changes
- [x] **AC10** — Light and dark theme both apply (the window uses the same theme tokens
      as the main window, 007)

## Open Questions

<!-- S06: the product questions below were answered by the user — see Decisions (Sprint) -->

- ~~**One window or one per session?**~~ answered → Decisions (User)
- ~~**Live sessions too?**~~ answered → Decisions (User)
- ~~**What does the timeline show of a prompt?**~~ decided → Decisions
- ~~**Size of the timeline.**~~ decided → Decisions
- **Named e2e gap (for the sprint review, not blocking):** the profile has `e2e: none`, so
  AC1, AC2, AC4, AC7 and AC10 — things the user does or sees in the real window — are proven
  one level down (pure helpers, an Electron-mocked `WindowManager`, source-level wiring
  checks). Nothing proves the real window opens, reflows and closes on Esc in a running app.

## Decisions (Sprint)

- **(User)** One reusable detail window, retargeted on each History click.
- **(User)** Live sessions (Sessions tab pane) are out of scope: History only.
- **AC5 resolved by the User decision:** exactly one detail window exists; a click on another
  row retargets it, a click on the shown row only focuses it — so "same session twice → two
  windows" cannot happen by construction.
- **Timeline unit = the run** (prompt + the turn it triggered, CONCEPT §8 "Run duration"):
  events are grouped under the `prompt` event that starts them, because that is how a user
  remembers a session and it turns 10 000 rows into a few hundred headers.
- **Runs are collapsed by default; an expanded run renders its events in pages of 200 with a
  "Show 200 more" button — no virtualisation library**, because collapsed-plus-paging keeps the
  DOM bounded without a new dependency and stays keyboard/scroll-native.
- **What a prompt shows:** the run header shows the prompt text clipped to one line
  (`clipOneLine`, 120 chars); an event row shows time, kind, tool name, stop reason and its
  text clipped to one line; the full text of one event appears only when that row is expanded
  — CONCEPT §4 allows prompt/response text to be read and shown in-process (it already
  crosses IPC for titles), and clipping by default keeps the window scannable.
- **Events before the first prompt** form a leading run labelled "Before the first prompt",
  so nothing in `events` is silently dropped from the view.
- **The detail window requests the detail itself** (`api.getDetail`), History only sends
  "open this id" — so the parse runs once, in main, and History's existing usage upgrade
  (engine `getDetail` folds exact totals back into the entry) keeps working unchanged.
- **Stale responses are dropped:** a detail response whose `sessionId` is not the currently
  targeted one is ignored, because retargeting while a large parse is still running is the
  normal case for a reusable window.
- **Window geometry lives in its own file `<userData>/detail-window.json`, not in
  `settings.json`**, because a resize must not broadcast a settings change to every window.
- **Default size 1000×760, minimum 640×420**, because 1000 px fits the header facts on two
  lines and a one-line timeline row without wrapping, and 640×420 still shows header plus
  at least five timeline rows.
- **A saved position is used only if the saved rectangle intersects a connected display's
  work area;** otherwise the saved size is kept and the window is centred on the primary
  display — matching AC6's "if on a still-connected display".
- **`clipOneLine` moves to agent-neutral `src/core/model/text.ts`** (re-exported from
  `records.ts`), because the renderer must not import from `core/adapters/claude` (N7) and a
  second clipping rule is exactly what that helper's doc comment forbids.
- **CONCEPT §8 "History" gains one sentence** about the detail window; there is no
  `docs/systems/` doc for the window layer, so no systems doc is updated.

## Plan

Main process owns one extra `BrowserWindow` (the detail window, a third renderer document
`detail.html`). History sends "open session X" over IPC; main creates or retargets the window
and pushes `cc:detail-target`; the detail renderer calls `api.getDetail(X)` (parse stays in
main, CONCEPT §5.1 Detail tier), shows a loading state, drops stale responses, then renders
header facts, the subagent tree and a run-grouped, collapsed timeline. Geometry is persisted
in `<userData>/detail-window.json` and restored onto a still-connected display.

Order (each step builds and tests green on its own):

1. **D1 — geometry, electron-free.** `src/main/detailWindowState.ts`: constants, restore rule,
   window options builder, load/save via an `atomicJson` helper extracted from `settings.ts`.
2. **D2 — window + IPC.** `WindowManager.openDetail/closeDetail`, two IPC channels, preload
   methods + `onDetailTarget`, theme background, debounced geometry save.
3. **D3 — renderer view model, pure.** `src/renderer/lib/detailModel.ts`: header facts, run
   grouping + paging, load reducer with the stale-response guard, truncated notice;
   `clipOneLine` moved to `src/core/model/text.ts`.
4. **D4 — the detail document.** `detail.html` + `detail.tsx` + `SessionDetailWindow.tsx`,
   styles (theme tokens only, scroll + reflow), Esc, Copy path / Show file, vite entry.
5. **D5 — History hands off.** Row opens the window on click/Enter, notice and `selected`
   state removed, CONCEPT §8 sentence, CHANGELOG entry.

Not touched: `core/` parsing (`readDetail` is used as is), the Sessions tab, History filters,
grouping and totals. Story 021 may change how `SessionDetail.title` is derived — this story
only displays it.

Risk: the popover's DIP shrink history (`windows.ts` `applyPopoverBounds`) — the detail
window is resizable, so it saves `getNormalBounds()` (not `getBounds()` of a maximised
window) and restores with one `setBounds`/constructor size, never a read-back-and-reapply loop.

## Deliverables

- [x] **D1 — Detail window geometry (electron-free) plus its test.**
  New `src/main/detailWindowState.ts`, importing nothing from `electron` at runtime (types
  only), exporting:
  - `DETAIL_WINDOW_DEFAULT = { width: 1000, height: 760 }`, `DETAIL_WINDOW_MIN = { width: 640, height: 420 }`.
  - `type SavedDetailBounds = { x: number; y: number; width: number; height: number }`.
  - `restoreDetailBounds(saved: SavedDetailBounds | null, workAreas: Rect[], primary: Rect)`
    → `{ x?: number; y?: number; width; height }`: no saved → default size, no position
    (Electron centres); width/height clamped up to the minimum and down to the work area of
    the display it lands on; position kept only if the saved rectangle intersects one of
    `workAreas`, else dropped (size kept, centred on `primary`). Garbage (non-finite, negative)
    → treated as no saved state.
  - `detailWindowOptions(restored)` → the constructor options **without** `webPreferences`:
    `resizable: true`, `minWidth/minHeight` from `DETAIL_WINDOW_MIN`, `show: false`,
    `autoHideMenuBar: true`, `title: 'Session detail'`, and the restored size/position.
  - `loadDetailBounds(userDataDir)` / `saveDetailBounds(userDataDir, bounds)` on
    `<userData>/detail-window.json`; an unreadable file yields `null`, never throws.
  Extract the temp-file-plus-rename write from `SettingsStore.write` in
  `src/main/settings.ts` into new `src/main/atomicJson.ts` (`writeJsonAtomic(file, value)`),
  use it in both places — do not write a second copy. Test: `test/unit/detailWindowState.test.ts`
  (plain Node, temp dir for load/save).
- [x] **D2 — The detail window in the main process, IPC and preload, plus its test.**
  `src/main/windows.ts`: a `detail: BrowserWindow | null` field and
  `openDetail(sessionId: string)`: if a live detail window exists → `show()`, `focus()`,
  `webContents.send('cc:detail-target', { sessionId })`; else build it with
  `new BrowserWindow({ ...detailWindowOptions(restoreDetailBounds(loadDetailBounds(userDataDir),
  screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea)),
  backgroundColor, icon: appIcon(), webPreferences: this.webPreferences() })` — the
  `webPreferences: this.webPreferences()` spelling is required by `test/unit/boundaries.test.ts`
  — `harden()` it, send the target on `ready-to-show` (mirror `openMain`), and
  `load(window, 'detail.html', '?session=<encoded id>')`. Save `getNormalBounds()` via
  `saveDetailBounds` on `resize`/`move` (trailing debounce ~500 ms) and on `close`; null the
  field on `closed`. `closeDetail()` closes it. Add `userDataDir` to `WindowManagerOptions`
  and pass `app.getPath('userData')` in `src/main/index.ts`. Include the detail window in
  `allWindows()` and in `applyThemeToLiveWindows()` (use `MAIN_WINDOW_BG`).
  `src/shared/ipc.ts`: `IPC.openSessionDetail = 'cc:open-session-detail'`,
  `IPC.closeDetailWindow = 'cc:close-detail-window'`; `RendererApi` gains
  `openSessionDetail(id: SessionId): Promise<void>` and `closeDetailWindow(): Promise<void>`.
  `src/main/ipc.ts`: handlers calling `deps.windows.openDetail(id)` (ignore non-string ids)
  and `deps.windows.closeDetail()`. `src/main/preload.ts`: the two methods plus
  `onDetailTarget(listener: (t: { sessionId: string }) => void)` on the extended api type
  (next to `onNavigate`). Test: `test/unit/detailWindow.test.ts` with `vi.mock('electron')`
  (pattern: `test/unit/tray-icons.test.ts`) faking `BrowserWindow` (counts constructions,
  records `send` calls and options), `screen`, `nativeTheme`, `shell`; `detailWindowState`
  load/save mocked or pointed at a temp dir.
- [x] **D3 — Detail view model (pure renderer logic), plus its test.**
  Move `clipOneLine` from `src/core/adapters/claude/records.ts` to new
  `src/core/model/text.ts` and re-export it from `records.ts` (no other change there).
  New `src/renderer/lib/detailModel.ts` (imports types from `src/core/model/types.ts`,
  `clipOneLine` from `text.ts`, formatters from `src/renderer/lib/format.ts`):
  - `detailHeader(detail: SessionDetail)` → title (`title ?? sessionId`), project name and
    path, branches (joined, `—` if none), models (joined, `—`), started/ended
    (`formatDateTime`), duration (`formatDuration`, `null` ends → `—`), token totals per
    `UsageTotals` field plus their sum (`null` usage → "no usage reported", never zeros).
  - `groupRuns(events: TimelineEvent[])` → `TimelineRun[]`: a new run starts at every
    `kind === 'prompt'`; events before the first prompt form a leading run with
    `label: 'Before the first prompt'`; each run carries `promptText`
    (`clipOneLine(text, 120)` or `'(no text)'`), `startedAt`, `endedAt`, `eventCount`,
    `toolCount`, and its `events`. Order preserved, no event dropped.
  - `TIMELINE_PAGE = 200`; `visibleEvents(run, pages)` → first `pages * 200` events plus
    `remaining` count.
  - `eventRow(event)` → time, kind label, tool, stop reason, `clipOneLine(text, 120)` and a
    `hasMore` flag when the clip shortened it.
  - Load reducer `detailLoad(state, action)` with states `idle | loading(id) | loaded(id,
    detail) | failed(id, message)` and actions `target(id)`, `resolved(detail)`,
    `rejected(id, message)`: a `resolved`/`rejected` whose id ≠ current target is ignored.
  - `detailTruncatedNotice(detail)` → `null` unless `truncated`, else a sentence saying the
    timeline stops after the first 10 000 events and the totals above still cover the whole
    transcript (true: `readDetail` keeps summing usage past the limit).
  Test: `test/unit/detailModel.test.ts`.
- [x] **D4 — The detail document (renderer), plus its tests.**
  New `src/renderer/detail.html` (mirror `popover.html`), new `src/renderer/detail.tsx`
  (imports `./styles.css`; reads the initial id from `?session=`, subscribes to
  `onDetailTarget`, drives the D3 reducer: `target(id)` → `api.getDetail(id)` →
  `resolved`/`rejected`; a document-level `keydown` Escape → `api.closeDetailWindow()`;
  sets `document.title` to the session title). New
  `src/renderer/components/SessionDetailWindow.tsx`: loading state ("Reading transcript…"),
  failure state, header from `detailHeader`, Copy path (`api.copyText(transcriptPath)`) and
  Show file (`api.revealPath(transcriptPath)`) buttons, `detailTruncatedNotice` when non-null,
  `<SubagentTree nodes={detail.subagents} />`, and the timeline: one collapsed header per
  `groupRuns` run (button, Enter/Space toggles), expanded run shows `visibleEvents` with a
  "Show 200 more" button, an event row expands to its full text (`white-space: pre-wrap`).
  `src/renderer/components/SubagentTree.tsx`: optional `emptyText` prop (default unchanged);
  pass "No subagents in this session." here. `src/renderer/styles.css`: `.detail-window`
  rules — full-height flex column, header facts `flex-wrap: wrap`, one scroll container
  (`overflow: auto`) for subagents + timeline, `overflow-wrap: anywhere` on text, no fixed
  pixel widths, colours only via existing `var(--…)` tokens (no hex/rgb literals).
  `electron.vite.config.ts`: add `detail: resolve(..., 'src/renderer/detail.html')` to the
  renderer inputs. Tests: `test/unit/detailWindowStyles.test.ts` (reads `styles.css`, asserts
  the `.detail-window` rules use only `var(--…)` colours and the scroll container has
  `overflow: auto`, no fixed `width: <n>px`) and `test/unit/detailWindowWiring.test.ts`
  (source-level, house style of `test/unit/showInMainWindow.test.ts`).
- [x] **D5 — History opens the window; the notice goes; docs.**
  `src/renderer/components/HistoryView.tsx`: `HistoryRow` gets `tabIndex={0}` and an
  `onKeyDown` that calls `onSelect` on Enter; both `onSelect` call sites become
  `void api.openSessionDetail(entry.sessionId)` (no `api.getDetail` call left in History);
  remove the `selected` state and the whole `.notice` block. Nothing else in History
  changes (filters, grouping, totals, columns). `docs/CONCEPT.md` §8 "History": one sentence —
  a row opens the session in a resizable detail window (header facts, subagent tree, run
  timeline). `CHANGELOG.md` `## Unreleased` › Features: one short entry. Test: extend
  `test/unit/detailWindowWiring.test.ts` with the History cases.

## Model Hints

- All Ds → default tier. D2 is the riskiest (window lifecycle, debounced save, multi-display),
  but its rules are pinned in D1's pure functions and D2's mocked test; no D needs Opus.
- Review: → default — the plausible wrong implementation (a late response for the previous
  session overwriting the retargeted window) is pinned by a reducer test and a wiring test
  that the component dispatches through it, so it does not slip past tests plus a default review.

## Acceptance Tests

- AC1 → unit `test/unit/detailWindow.test.ts` › "opening a session creates the detail window
  and sends it the session id" + source `test/unit/detailWindowWiring.test.ts` › "a history
  row opens the detail window on click and on Enter" (D2, D5). Named gap: no e2e harness.
- AC2 → unit `test/unit/detailWindowState.test.ts` › "the detail window is resizable with a
  minimum size and opens at the default size" + › "a restored size is never below the
  minimum nor larger than the work area" (D1); reflow at the minimum → AC4's test.
  Named gap: no e2e harness.
- AC3 → unit `test/unit/detailModel.test.ts` › "the header carries title, project, branches,
  models, times and token totals" + › "events are grouped into runs starting at each prompt
  without dropping any" (D3) + source `test/unit/detailWindowWiring.test.ts` › "the detail
  window renders the header, the subagent tree and the run timeline" (D4).
- AC4 → unit `test/unit/detailWindowStyles.test.ts` › "the detail window scrolls inside one
  container and has no fixed widths" + `test/unit/detailModel.test.ts` › "an expanded run
  shows events in pages of 200" (D4, D3). Named gap: no e2e harness.
- AC5 → unit `test/unit/detailWindow.test.ts` › "opening another session retargets the one
  detail window" + › "opening the shown session again only focuses it" (D2).
- AC6 → unit `test/unit/detailWindowState.test.ts` › "saved bounds survive a save and load"
  + › "a position on a disconnected display is dropped, the size kept" (D1) +
  `test/unit/detailWindow.test.ts` › "the detail window saves its normal bounds on resize,
  move and close" (D2).
- AC7 → source `test/unit/detailWindowWiring.test.ts` › "the detail window offers Copy path
  and Show file for its transcript" + › "Escape closes the detail window" (D4); the
  `closeDetailWindow` IPC → `test/unit/detailWindow.test.ts` › "closing via IPC closes the
  detail window" (D2). Named gap: no e2e harness.
- AC8 → unit `test/unit/detailModel.test.ts` › "a response for a session no longer targeted
  is ignored" + › "loading is the state between target and response" + › "a truncated detail
  says the timeline stops at 10 000 events" (D3) + source `test/unit/detailWindowWiring.test.ts`
  › "the detail window gets its data only through getDetail and shows a loading state" (D4).
- AC9 → source `test/unit/detailWindowWiring.test.ts` › "history no longer renders the
  notice or calls getDetail itself" (D5).
- AC10 → unit `test/unit/detailWindowStyles.test.ts` › "the detail window uses only theme
  tokens" (D4) + `test/unit/detailWindow.test.ts` › "the detail window follows the OS
  scheme for its background" (D2); `test/unit/boundaries.test.ts` (existing) keeps the new
  window locked down.
- Manual residue: none. Coverage: AC1 D2+D5 · AC2 D1 · AC3 D3+D4 · AC4 D3+D4 · AC5 D2 ·
  AC6 D1+D2 · AC7 D2+D4 · AC8 D3+D4 · AC9 D5 · AC10 D2+D4.

## Done

**Summary:** History rows (click/Enter) now open one reusable, resizable detail window (`detail.html`, own `BrowserWindow`) that fetches `getDetail` itself in main, shows header facts with per-field token totals, subagent tree and a run-grouped, collapsed, paged timeline; geometry persists in `<userData>/detail-window.json`; the History notice is gone.

**Commit message:** `022: past session opens in its own resizable detail window (run timeline, subagent tree, saved geometry)`

**Verification (narrow gate):** `npm run build` green, `npm run typecheck` green, `npx vitest run --changed HEAD` green (11 files, 288 tests), full `npm test` green (38 files, 577 tests; boundaries.test.ts included). e2e: none in profile (named gap above). Review: clean default-tier agent, 1 cycle (FAIL → fixed → re-verified).
AC → test (all ran and passed): AC1 detailWindow "opening a session creates…" + wiring "a history row opens…"; AC2 detailWindowState resizable/min + clamp; AC3 detailModel header + grouping, wiring renders header/tree/timeline; AC4 styles "scrolls inside one container…" + detailModel paging; AC5 detailWindow retarget + "only focuses it" (now asserts no re-send); AC6 detailWindowState save/load + disconnected display, detailWindow bounds save; AC7 wiring Copy path/Show file + Escape, detailWindow close via IPC; AC8 detailModel stale/loading/truncated + wiring getDetail; AC9 wiring "history no longer renders the notice…"; AC10 styles tokens + detailWindow OS scheme + boundaries. Manual residue: none.

**Decisions:**
- `cc:detail-target` stays a literal channel string in preload/windows (like `cc:navigate`); no IPC constant.
- `detailLoad` `target(id)` for the id already current is a no-op (any state), and `openDetail` on the shown session only focuses without re-sending; the ready-to-show send uses the latest tracked session id, so a retarget before load wins.
- `FullApi` in `src/renderer/api.ts` also gains `onDetailTarget` (typing of `window.claudeControl`).
- `.notice` CSS kept: still used by SessionDetailPane and SessionDetailWindow.
- Unfixed review notes: `EventRow.hasMore` computed but not rendered (kept, covered by model test); double whitespace collapse in `eventRow` harmless; `records.ts` re-export plus local import of `text.ts` kept for CRLF-file minimal diff; styles test scans border/color/background only.

tiers: D 5 / hard 0 · review default · cycles 1 · agents 8
