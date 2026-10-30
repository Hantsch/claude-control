---
id: 027
title: Source-text wiring tests pruned to structural checks
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The maintainer wants a test that fails when the product is broken, not when a grid string or a
line of copy is reformatted. Seven renderer wiring tests read `src/renderer` source as text
because the project has no render harness (a documented decision: `.claude/ai-scrum.md` sets
`e2e: none`, and stories 006, 010, 012, 017 and 018 name the gap). The cheap cut is to delete what
only pins copy or call shape and keep what links one side of the app to the other. A jsdom harness
is out of scope.

Today ([review 2026-10-30](../reviews/2026-10-30-tests-review.md), F09, corrected to low):
- 8 files read `src/renderer/*.tsx|css` or README/CONCEPT as text; the 7 UI files total about 330
  lines, each 17-73 lines and committed once (no churn). The refuter: they are the sanctioned
  stand-in, not an oversight.
- Pinned strings: the exact grid `'9px 13px 11px minmax(0, 1fr) 108px 92px 22px 18px'`
  (`popoverRowLayout.test.ts:14-15`), call-shape regexes such as `/api\.getDetail\(targetId\)/`
  (`detailWindowWiring.test.ts:20-73`), a regex on
  `const target: NavigateTarget = { tab, sessionId }` (`showInMainWindow.test.ts:20-45`), UI copy
  (`hiddenSessions.test.ts:5-30`, `statusRollupWiring.test.ts:6-8, :25-40`) and a style string
  (`detailWindowStyles.test.ts:24`).
- The exceptions are justified and stay: `boundaries.test.ts` (:105; security boundary) and the N1
  wording pins in `networkPromiseWording.test.ts:30-55` (product promise).
- The 8 files, all under `test/unit/`: popoverRowLayout, statusRollupWiring, showInMainWindow,
  detailWindowWiring, detailWindowStyles, hiddenSessions, networkPromiseWording and boundaries.

## Acceptance Criteria

- [ ] **AC1** — `test/unit/popoverRowLayout.test.ts` no longer exists
- [ ] **AC2** — `test/unit/boundaries.test.ts` is unchanged (`git diff` empty), and
      `test/unit/networkPromiseWording.test.ts` still pins the N1 wording (a seeded edit of the N1
      sentence in the README fails it)
- [ ] **AC3** — `detailWindowWiring.test.ts`, `statusRollupWiring.test.ts`, `hiddenSessions.test.ts`
      and `detailWindowStyles.test.ts` contain no assertion on UI copy, a grid or style string, or a
      call-shape regex such as `api\.getDetail\(`: `rg "api\\\.getDetail" test/unit` returns nothing
      (the full list of removed assertions is fixed in refine)
- [ ] **AC4** — A structural link check remains: a test fails when an IPC channel used by the
      renderer is not declared in the preload or has no handler in main (seeded: rename one handler
      in `src/main`)
- [ ] **AC5** — The popover-to-main-window link of `showInMainWindow` stays checked structurally
      (seeded: removing the navigate call fails a test), without a regex on the `NavigateTarget`
      literal: `rg "NavigateTarget = " test/unit/showInMainWindow.test.ts` returns nothing
- [ ] **AC6** — `npm test` exits 0, and the Done section lists the removed assertions by name with
      the test count before and after
- [ ] **AC7** — No render harness is added: `rg "jsdom|testing-library" package.json` returns nothing

## Open Questions

- ~~**Delete now or only when one breaks on a rename?**~~ answered → Decisions (Sprint)
- ~~**Which assertions are copy and which are structure?**~~ answered → Decisions (Sprint)
- ~~**jsdom harness.**~~ answered → Decisions (Sprint)
- ~~**e2e gap.**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Run the pruning in S07 (not deferred to a later UI story).
- Copy vs. structure: an assertion stays only if it names a link between two files or sides (an
  import of a shared module, a bridge method a file reaches, an entry file the build lists, a
  theme-token rule); literal copy, grid/style values, selector-specific style pins and
  argument-shaped call regexes go — the review judge's cut, applied per file (list in D1/D3).
- The renderer-to-main link (AC4) is proven by one generic test that loads the real preload and
  the real `registerIpc` behind an electron mock, because a channel list kept in the test would
  pin the same call shape this story removes.
- The main-window half of "Show in Claude Control" (AC5) is proven as behaviour in
  `detailWindow.test.ts`, which already holds the only `WindowManager` + `registerIpc` electron
  harness, so no second copy of that fake window is made.
- No jsdom/testing-library harness (judge: effort L, new dependency, poor ROI) — a port of cases to
  jsdom would be its own story if the user asks for it.
- Renderer behaviour the pruned asserts claimed (App selects the navigated session, Escape closes
  the detail window, the detail pane's copy button) is not re-proven: it stays inside the named
  e2e gap (`e2e: none`), listed under Acceptance Tests for the sprint review.
- `hiddenSessions` keeps its `hiddenIndicator` unit tests but asserts against the exported
  `HIDDEN_CAUSE_LABELS` instead of literal label strings, so the tooltip rule stays tested without
  pinning copy.

## Plan

Tests-only story; no `src/` change, no CHANGELOG entry (nothing user-facing). Baseline before:
`npm test` = 38 files / 577 tests (measured 2026-10-30).

1. **D1 — prune the four copy/style files and delete the grid pin** (AC1, AC3, AC2, AC7):
   delete `popoverRowLayout.test.ts`; cut `detailWindowWiring`, `statusRollupWiring`,
   `hiddenSessions`, `detailWindowStyles` down to their structural links (list in D1).
   `boundaries.test.ts` and `networkPromiseWording.test.ts` are not touched.
2. **D2 — generic IPC link test** (AC4): new `test/unit/ipcWiring.test.ts` mocks `electron`,
   imports the real `src/main/preload.ts` and `registerIpc` from `src/main/ipc.ts`, collects the
   bridge methods the renderer calls (generic scan of `src/renderer`), calls each through the
   exposed api and asserts every invoked channel has a main handler and every subscribed channel
   is sent by main.
3. **D3 — Show in Claude Control as behaviour** (AC5, AC6): add the navigate behaviour test to
   `detailWindow.test.ts`; slim `showInMainWindow.test.ts` to the renderer link; run `npm test`,
   record test count after.

Order D1 → D2 → D3 (independent files; D3 last because it records the final count).
Seeds (build runs them and reverts): README N1 sentence (AC2), rename the `'cc:popover-pin'`
handler literal in `src/main/ipc.ts` (AC4), delete one `webContents.send('cc:navigate', target)`
in `src/main/windows.ts` (AC5).

## Deliverables

- [ ] **D1 — Prune copy, grid and style pins from four wiring tests; delete the grid test.**
  Files: delete `test/unit/popoverRowLayout.test.ts`; edit `test/unit/detailWindowWiring.test.ts`,
  `test/unit/statusRollupWiring.test.ts`, `test/unit/hiddenSessions.test.ts`,
  `test/unit/detailWindowStyles.test.ts`. Do NOT touch `test/unit/boundaries.test.ts` or
  `test/unit/networkPromiseWording.test.ts`, and add no dependency to `package.json`.
  Rule: keep an assertion only if it names a link between two files/sides; remove literal UI copy,
  grid/style values, selector-specific style pins and regexes on a call's argument shape. Test
  names carry behaviour, never a story id. Exact cut:
  - `detailWindowWiring.test.ts` (6 tests → 2). Remove: every assertion of the tests "renders the
    header, the subagent tree and the run timeline" (`detailHeader(detail)`, `<SubagentTree nodes=…`,
    'No subagents in this session.', `groupRuns(detail.events)`, `visibleEvents(run, pages)`,
    'Show 200 more', `detailTruncatedNotice(detail)`, the five `header.tokens.*` fields,
    `header.tokensNote`, `emptyText?: string`), "offers Copy path and Show file" (`api.copyText(…)`,
    `api.revealPath(…)`, 'Copy path', 'Show file'), "Escape closes the detail window" (keydown
    listener, `event.key === 'Escape'`, `api.closeDetailWindow()`), the `api.getDetail(targetId)`,
    `useReducer(detailLoad`, `type: 'resolved'`, `type: 'rejected'`, `get('session')`,
    `/onDetailTarget/` and 'Reading transcript…' asserts of the getDetail test, "a history row opens
    the detail window on click and on Enter" (tabIndex/onClick regex, Enter regex, the
    `openSessionDetail(entry.sessionId)` count of 2), and "history no longer renders the notice or
    calls getDetail itself" (all three negatives). Keep / write: (a) "the detail window entry is
    built from detail.html and loads detail.tsx" — `detail.html` contains `/detail.tsx`, and
    `electron.vite.config.ts` matches `/detail: resolve\([^)]*detail\.html/`; (b) "the history view
    and the detail entry reach the detail window through the bridge" — `HistoryView.tsx` contains
    `api.openSessionDetail` and `detail.tsx` contains `api.onDetailTarget` (identifier only, no
    argument regex). The string `api.getDetail` must not appear anywhere in `test/unit`.
  - `statusRollupWiring.test.ts` (2 tests stay): remove the `OWN_COUNTING` constant and its two
    `not.toMatch` asserts; drop "(story 006 D3)" from the describe name and the story id from the
    header comment; keep the `StatusRollup` import regex and `<StatusRollup` usage per file.
  - `hiddenSessions.test.ts` (5 tests → 3). Keep "nothing hidden renders nothing". Replace the
    label test with "the tooltip names exactly the Settings toggles that hid the sessions": import
    `HIDDEN_CAUSE_LABELS` from `src/renderer/lib/hiddenSessions.ts`; for causes `['unused']` and
    for all three, `title` contains `HIDDEN_CAUSE_LABELS[c]` for each given cause and not for the
    others, and `text` contains the count as a number string. Remove: the '1 hidden'/'3 hidden'
    literals, the six label literals, 'Settings › Session list', the test "names filters, never
    tray recency" (`/settled/i`), and in the wiring describe the `hiddenIndicator(state.hidden)`
    and `title={hiddenBadge.title}` regexes and the whole test "the popover keeps the settled count
    and adds the hidden count beside it". Keep the import-of-`hiddenIndicator` check for
    `App.tsx` and `popover.tsx`.
  - `detailWindowStyles.test.ts` (2 tests stay): in "scrolls inside one container…" remove the
    no-fixed-`width: Npx` assert (:24), the `.detail-facts` `flex-wrap` and `.detail-event-full`
    `pre-wrap` asserts, and replace the `toEqual(['.detail-scroll'])` selector pin with
    `toHaveLength(1)`; rename to "the detail window scrolls inside exactly one container". Keep
    "uses only theme tokens" unchanged.
  Acceptance: `rg "api\\\.getDetail" test/unit` and `rg "jsdom|testing-library" package.json`
  return nothing; `git diff --exit-code test/unit/boundaries.test.ts test/unit/networkPromiseWording.test.ts`
  is clean; `npx vitest run test/unit` passes; seeded: change "no outbound requests" wording of
  the N1 sentence in `README.md` → `networkPromiseWording.test.ts` fails; revert.

- [ ] **D2 — One generic test proves every bridge method the renderer calls reaches main.**
  File: new `test/unit/ipcWiring.test.ts` (no other file). Mirror the `vi.hoisted` +
  `vi.mock('electron', …)` pattern of `test/unit/detailWindow.test.ts:3-74`, but with a minimal
  mock — no FakeWindow: `ipcMain.handle(channel, fn)` records into a `handled` set;
  `ipcRenderer.invoke(channel, …)` records into `invoked` and returns `Promise.resolve()`;
  `ipcRenderer.on(channel, …)` records into `subscribed`; `ipcRenderer.off` no-op;
  `contextBridge.exposeInMainWorld(_name, api)` captures `api`; `BrowserWindow: { getAllWindows:
  () => [] }`, `app`, `clipboard`, `shell` as empty objects (registration calls none of them).
  Then `await import('../../src/main/preload.ts')` (side effect exposes the api) and
  `registerIpc({} as never)` from `src/main/ipc.ts` (registration does not touch deps).
  Test "every bridge method the renderer calls is exposed by the preload and handled in main":
  scan all `.ts/.tsx` under `src/renderer` (recursive `readdirSync`, Windows path fix as in the
  existing tests: `.pathname.replace(/^\/([a-zA-Z]:)/, '$1')`) with the generic
  `/\bapi\.(\w+)\s*\(/g`, dedupe; guard `methods.length >= 20` so the scan cannot go vacuous; for
  each: `typeof api[m] === 'function'` (message names the method), then call it — `on*` methods
  with a no-op listener, others with no arguments; afterwards every channel in `invoked` is in
  `handled` (`expect([...invoked].filter(c => !handled.has(c))).toEqual([])`).
  Test "every channel the renderer subscribes to is sent by main": each channel in `subscribed`
  occurs in `src/main` as a send target — collect `'cc:…'` literals passed to
  `webContents.send(` plus `IPC.<key>` passed to `broadcast(` (resolved through the imported
  `IPC` from `src/shared/ipc.ts`); missing list must equal `[]`.
  No method or channel name may be written literally in the test (the scan is the list).
  Acceptance: `npx vitest run test/unit/ipcWiring.test.ts` passes; seeded: rename
  `ipcMain.handle('cc:popover-pin'` to `'cc:popover-pinx'` in `src/main/ipc.ts` → the first test
  fails naming `cc:popover-pin`; revert. Seeded: rename `'cc:detail-target'` in both
  `webContents.send` calls of `src/main/windows.ts` → the second test fails; revert.

- [ ] **D3 — "Show in Claude Control" proven as behaviour; source regexes gone; final count.**
  Files: `test/unit/detailWindow.test.ts` (add one test, reuse its existing `h`, electron mock,
  `manager()` and `registerIpc` import — do not copy the fake window elsewhere) and
  `test/unit/showInMainWindow.test.ts` (rewrite).
  - In `detailWindow.test.ts` add `describe('main window navigation')` with test "showing a
    session from the popover opens the main window on Sessions with that session": `const m =
    manager(); registerIpc({ windows: m } as never);` (the handler's `hidePopover()` is a no-op
    on the real manager when no popover exists) then
    `h.handlers.get('cc:open-main-window')!({}, 'sessions', 's1')`; emit `ready-to-show` on the
    created window and expect its `sent` to equal `[['cc:navigate', { tab: 'sessions', sessionId:
    's1' }]]`; then call the handler again with `('sessions', 's2')` and expect the same window
    (no second `BrowserWindow`) to have received `['cc:navigate', { tab: 'sessions', sessionId:
    's2' }]` immediately. Also one call with a non-string id (`42`) sends `sessionId: null`.
  - `showInMainWindow.test.ts` keeps one test, "the popover and the main window are linked through
    the bridge": `popover.tsx` contains `api.openMainWindow` and `App.tsx` contains
    `api.onNavigate` (identifier presence only). Remove: 'Show in Claude Control' copy, the
    `api.openMainWindow('sessions', sessionId)` regex, the `const target: NavigateTarget = …`
    regex, the `openMain(tab ?? 'sessions',` regex, `setTab(target.tab)`,
    `setSelectedId(target.sessionId)`, `{session.sessionId}` and `copy('session ID', …)`. Update
    the header comment: main-side behaviour lives in `detailWindow.test.ts`, renderer behaviour is
    the e2e gap.
  Acceptance: `rg "NavigateTarget = " test/unit/showInMainWindow.test.ts` returns nothing;
  seeded: delete the `this.main.webContents.send('cc:navigate', target)` line in
  `src/main/windows.ts` → the new test fails; revert; same for the `ready-to-show` send. Then
  `npm test` exits 0; record the test count after (before: 577) for the Done section, together
  with the removed-assertion lists from D1 and D3.

## Model Hints

All Ds default tier: deletions follow an exact list, and D2's only subtlety (a vacuous scan or
a hard-coded channel list) is pinned by the size guard and the seeded rename in its acceptance.

Review: → default

## Acceptance Tests

- AC1 → check in D1: `test/unit/popoverRowLayout.test.ts` deleted (no test file proves an
  absence; the gate is the file listing in the review diff).
- AC2 → unit `test/unit/networkPromiseWording.test.ts` › "README.md no longer states the
  single-exception phrase, and names both exceptions" (existing; seeded README edit in D1) +
  `git diff --exit-code test/unit/boundaries.test.ts` empty.
- AC3 → unit `test/unit/detailWindowWiring.test.ts` › "the detail window entry is built from
  detail.html and loads detail.tsx", "the history view and the detail entry reach the detail
  window through the bridge"; `test/unit/statusRollupWiring.test.ts` (both tests);
  `test/unit/hiddenSessions.test.ts` › "the tooltip names exactly the Settings toggles that hid
  the sessions"; `test/unit/detailWindowStyles.test.ts` › "the detail window scrolls inside
  exactly one container" — plus `rg "api\\\.getDetail" test/unit` empty.
- AC4 → unit `test/unit/ipcWiring.test.ts` › "every bridge method the renderer calls is exposed by
  the preload and handled in main" (seeded `cc:popover-pin` rename) and "every channel the
  renderer subscribes to is sent by main".
- AC5 → unit `test/unit/detailWindow.test.ts` › "showing a session from the popover opens the main
  window on Sessions with that session" (seeded removal of the navigate send) and
  `test/unit/showInMainWindow.test.ts` › "the popover and the main window are linked through the
  bridge".
- AC6 → `npm test` exit 0 (whole suite) + Done lists removed assertions and 577 → after.
- AC7 → check in D1: `rg "jsdom|testing-library" package.json` empty.
- **Named gap (e2e: none):** the renderer half of these flows — the main window selecting the
  navigated session, Escape closing the detail window, the detail pane's Copy/Show buttons and
  copy text — has no automated proof after this story; it was only ever pinned as source text.
  Listed for the sprint review; a render or e2e harness would be its own story.

## Done

<Leave empty. Filled by `/build 027` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
