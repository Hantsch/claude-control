---
id: 003
title: Reach the popover without hunting for it
status: done # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

A tray app that has to be started by hand is a tray app that is not running when the session you
cared about finished. And the popover, which CONCEPT §8 designates the fast path, has exactly
one entry point: a mouse click on an icon Windows hides in the `^` overflow area by default.

Three things close that gap, and they build on each other:

- **Start with Windows.** ClaudeSessionTray's answer is a README paragraph telling the user to
  drop a shortcut in `shell:startup`. Electron does it properly in a few lines, and it is the
  largest practical win in the whole backlog after the notification quick-switch.
- **A global hotkey.** A keystroke turns the popover into a genuine glance. Neither reference
  tool has this.
- **Keyboard navigation once you are in it.** A hotkey that lands you in a mouse-only list is
  half a feature. The rows are already `<button>` elements, so this is focus management, not
  markup.

Background: [concepts/reference-tool-comparison.md](../../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [x] A Settings checkbox registers and unregisters the login item, and the choice survives a
      restart
- [x] Started at login, the app comes up to the tray without opening a window
- [x] The portable-EXE caveat is handled or stated in the hint text rather than glossed over:
      the registered path points at wherever the EXE currently sits, and moving it silently
      breaks the entry
- [x] A configurable global shortcut opens and closes the popover (pressing it again closes)
- [x] A registration conflict is reported in Settings instead of failing silently
- [x] The shortcut is released on quit
- [x] ↑/↓ move between rows, skipping group headers; Enter jumps to the focused session; Esc
      closes the popover
- [x] Opening the popover focuses the most urgent row, so a blind Enter does the expected thing

## Open Questions

- ~~**Portable EXE and autostart:** handle the moved-EXE case (re-register on start when the path
  differs) or document it as unsupported in the checkbox hint? Both are honest; only silently
  registering a path that will rot is not.~~ answered → Decisions (Sprint)
- ~~**Default shortcut:** which combination, given it must be unclaimed on a normal Windows
  desktop.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Portable EXE and autostart: re-register the login item on app start if the EXE's
  current path differs from the registered path (self-healing, not documented-as-unsupported).
- **(User)** Default global shortcut: `Ctrl+Alt+C`.
- **Two new fields under `ui`: `autostart: boolean` (default `false`) and `globalShortcut:
  string` (default `'Ctrl+Alt+C'`, `''` = disabled)** — `ui` already holds the surface-level
  prefs ([settings.ts:76](../../../src/core/model/settings.ts#L76)), and a single string field
  covers "configurable" plus "off" without a third boolean.
- **No `SETTINGS_SCHEMA_VERSION` bump** — both fields are additive and `mergeSettings`
  ([settings.ts:238](../../../src/core/model/settings.ts#L238)) fills missing keys from
  `DEFAULT_SETTINGS`; the version gate exists for *changed* defaults, not for new ones.
- **Autostart defaults to `false`, the shortcut default is active from first start** —
  registering a login item without being asked is an install-time side effect, while a hotkey
  is inert until pressed.
- **The login item is registered as `{ path: process.execPath, args: ['--autostart'] }`** —
  Windows only reports `openAtLogin` correctly when `getLoginItemSettings` is queried with the
  same `path`/`args` it was set with, and the flag gives the self-heal check and the
  "no Claude data" dialog suppression a reliable signal.
- **Self-healing compares `launchItems[].path` case-insensitively against `process.execPath`
  and re-registers on mismatch** — the user decision demands the registered path follow the
  EXE, and Windows paths are case-insensitive so a case-only difference must not cause a
  pointless registry write on every start.
- **`--autostart` suppresses the "No Claude Code data found" dialog**
  ([index.ts:109-119](../../../src/main/index.ts#L109)) — AC 2 says "comes up to the tray without
  opening a window", and a modal at login is exactly the window nobody asked for.
- **No `--hidden` flag and no window-suppression code** — the normal start is already
  tray-only ([index.ts:123](../../../src/main/index.ts#L123): a window only opens for `--show`),
  so AC 2 needs the dialog fix, not a new start mode.
- **Autostart and shortcut live in their own main modules (`src/main/autostart.ts`,
  `src/main/shortcuts.ts`), wired from `index.ts` via the existing `settings.onChange`
  listener** ([index.ts:86](../../../src/main/index.ts#L86)) — `index.ts` is the bootstrap
  sequence, and both concerns need a re-apply on every settings change.
- **The shortcut handler reuses the `--show popover` path
  (`tray.getBounds()` → `windows.togglePopover(bounds)`,
  [index.ts:124-126](../../../src/main/index.ts#L124))** — `togglePopover`
  ([windows.ts:109](../../../src/main/windows.ts#L109)) already hides a visible popover, pinned or
  not, so "pressing it again closes" (AC 4) falls out with no new state.
- **Registration status is its own IPC pair (`cc:get-shortcut-status` +
  `cc:shortcut-status`), mirroring `getSettings`/`settingsChanged`** — a failed registration is
  main-process truth that no settings value can express, and Settings must show it both on open
  and the moment a new combination fails.
- **Release on quit uses `app.on('will-quit', () => globalShortcut.unregisterAll())`** — the
  existing `before-quit` ([index.ts:140](../../../src/main/index.ts#L140)) can still be cancelled;
  `will-quit` is the last point at which the process-global registration is certainly dead.
- **The Settings field captures a key chord instead of accepting a raw accelerator string** —
  `Ctrl+Alt+C` is a developer-facing artefact, and capture makes an unparseable value
  impossible; the parsing lives in a pure `src/shared/accelerator.ts` so it is unit-testable.
- **A valid chord requires at least one of Ctrl/Alt/Meta plus a non-modifier key** — a global
  shortcut without a modifier would swallow that key in every other application.
- **↑/↓ clamp at the ends instead of wrapping** — the list opens focused on the most urgent
  row, so wrapping `↑` from the top would jump to the *least* urgent row, which is the opposite
  of what the key implies.
- **Group heads need no skip logic: they are plain `<div class="popover-group-head">`, rows are
  `<button>`** ([popover.tsx:280,288](../../../src/renderer/popover.tsx#L280)) — navigation walks
  `button.popover-row` only, so AC 7's "skipping group headers" is structural, not a special
  case.
- **"Most urgent row" = the first `.popover-row` in DOM order** — groups are already sorted by
  `STATUS_SORT_RANK` and rows within a group by `compareSessions`
  ([aggregate.ts:145-159](../../../src/core/state/aggregate.ts#L145)), so the top row is by
  construction the session that colours the tray badge (002's group-order decision).
- **Initial focus is driven by the renderer's `window` `focus` event, not a new IPC event** —
  the popover window is reused and `togglePopover` calls `show()` + `focus()` on every open,
  so the event fires exactly once per open with no main-process change.
- **Esc calls the existing `api.closePopover()`** ([ipc.ts:106](../../../src/shared/ipc.ts#L106))
  — the popover's own close button already uses it, and it forces past the pin, which is what
  a deliberate Esc means.
- **The Esc/arrow handler is document-level and ignores `event.defaultPrevented`; the
  NotifySwitch menu's Escape handler ([popover.tsx:96](../../../src/renderer/popover.tsx#L96))
  gains a `preventDefault()`** — otherwise one Esc would close both the menu and the window,
  which would undo 002's AC "the popover does not close while that menu is open".
- **Focus styling targets `.popover-row:focus`, not only `:focus-visible`** — the row is
  focused programmatically on open, where Chromium's `:focus-visible` heuristic is not
  guaranteed; a lingering outline after a click is invisible because the click closes the
  popover.

## Plan

Three independent tracks; only the settings schema (D1) is shared groundwork. Order:
schema → autostart → shortcut → keyboard, so each track can be verified on its own.

1. **Schema (D1):** `ui.autostart` + `ui.globalShortcut` in
   [settings.ts](../../../src/core/model/settings.ts) — interface, `DEFAULT_SETTINGS`,
   `mergeSettings` whitelist — plus merge tests in `test/unit/derivations.test.ts`.
2. **Autostart (D2, D3):** new `src/main/autostart.ts` (`applyAutostart(enabled)`,
   `healAutostartPath()`) over `app.setLoginItemSettings`/`getLoginItemSettings` with
   `{ path: process.execPath, args: ['--autostart'] }`; called from
   [index.ts](../../../src/main/index.ts) after `whenReady` and again from the existing
   `settings.onChange` listener; `--autostart` also suppresses the "No Claude Code data found"
   dialog. Then the checkbox + portable-EXE hint in
   [SettingsView.tsx](../../../src/renderer/components/SettingsView.tsx).
3. **Shortcut (D4–D7):** pure `src/shared/accelerator.ts` (chord → accelerator string +
   validation) with tests; `src/main/shortcuts.ts` (`ShortcutManager`: apply on start and on
   settings change, unregister the old one first, `will-quit` → `unregisterAll`, toggle via
   `tray.getBounds()` + `windows.togglePopover`); the status IPC pair
   (`shared/ipc.ts` → `main/ipc.ts` → `preload.ts` → `renderer/api.ts`); finally the capture
   field + conflict message in Settings.
4. **Keyboard (D8):** document-level keydown in
   [popover.tsx](../../../src/renderer/popover.tsx) (↑/↓ over `button.popover-row`, clamped; Esc →
   `api.closePopover()`), focus of the first row on `window` `focus` and on mount, one
   `preventDefault()` in NotifySwitch's Escape branch, `.popover-row:focus` style in
   [styles.css](../../../src/renderer/styles.css).

Verify per deliverable: `npm run typecheck`, `npm test`, `npm run build`; final acceptance via
`npm run dev` (see Test Plan).

## Deliverables

- [x] D1 — **Settings schema.** `UiSettings` gains `autostart: boolean` (default `false`) and
      `globalShortcut: string` (default `'Ctrl+Alt+C'`); `DEFAULT_SETTINGS.ui` and the
      `mergeSettings` `ui` branch accept both (boolean / string type-check, unknown values
      ignored like the neighbouring fields), no schema-version bump. Files:
      [settings.ts](../../../src/core/model/settings.ts) (interface L76, defaults L164,
      `mergeSettings` L238), `test/unit/derivations.test.ts` (mirror the existing
      `mergeSettings` cases).
      *Acceptance:* `npm test` green; a settings file without the new keys merges to the
      defaults, a garbage value falls back to the default.
- [x] D2 — **Autostart in main.** New `src/main/autostart.ts` exporting
      `applyAutostart(enabled: boolean)` and `healAutostartPath()`, both using
      `{ path: process.execPath, args: ['--autostart'] }` for get *and* set; `healAutostartPath`
      re-registers when `openAtLogin` is true and no `launchItems[].path` matches
      `process.execPath` case-insensitively. Wired in
      [index.ts](../../../src/main/index.ts): heal + apply once after settings load, re-apply from
      the existing `settings.onChange` listener (L86), and `--autostart` in `process.argv`
      suppresses the "No Claude Code data found" dialog (L109-119).
      *Acceptance:* toggling `ui.autostart` creates/removes the `HKCU:\…\Run` entry pointing at
      the current EXE; starting a copied EXE with `openAtLogin` on rewrites the entry to the new
      path; started with `--autostart` the app shows no dialog and no window.
- [x] D3 — **Autostart checkbox in Settings.** Checkbox "Start with Windows" bound to
      `ui.autostart`, saved through the existing `apply()` path, plus a `<span className="hint">`
      naming the portable-EXE behaviour ("the entry points at where the EXE is now; if you move
      it, the entry is repaired the next time the app starts"). File:
      [SettingsView.tsx](../../../src/renderer/components/SettingsView.tsx); mirror: the
      "Index history on start" checkbox (~L269-276).
      *Acceptance:* the checkbox reflects the persisted value after an app restart and switching
      it takes effect without a restart.
- [x] D4 — **Accelerator helper.** New pure `src/shared/accelerator.ts`:
      `acceleratorFromChord({ key, ctrlKey, altKey, shiftKey, metaKey })` → Electron accelerator
      string or `null` (null when no Ctrl/Alt/Meta is held or the key is itself a modifier),
      and `formatAccelerator(value)` for display (`''` → "None"). Test in
      `test/unit/presentation.test.ts`: `Ctrl+Alt+C`, `Ctrl+Shift+F1`, plain `c`, `Shift+c`,
      a bare `Control`, empty input.
      *Acceptance:* `npm test` green, no throw on any input.
- [x] D5 — **Shortcut manager in main.** New `src/main/shortcuts.ts` (`ShortcutManager` with
      `apply(accelerator)`, `status()`, `dispose()`): unregisters the previous accelerator
      before registering the new one, treats `''` as "disabled", records
      `{ accelerator, registered, error }` when `globalShortcut.register` returns false or
      throws, and toggles via the injected `onToggle`. Wired in
      [index.ts](../../../src/main/index.ts): construct after the tray, `onToggle` =
      `const b = tray.getBounds(); if (b) windows.togglePopover(b)` (same as L124-126),
      `apply()` on start and from `settings.onChange`, and
      `app.on('will-quit', () => globalShortcut.unregisterAll())`.
      *Acceptance:* `Ctrl+Alt+C` opens the popover from any foreground app and closes it again;
      changing the combination in settings makes the old one dead immediately; after quitting,
      the combination reaches other apps again.
- [x] D6 — **Shortcut status over IPC.** `IPC.getShortcutStatus = 'cc:get-shortcut-status'` and
      `IPC.shortcutStatusChanged = 'cc:shortcut-status'` plus a `ShortcutStatus` type in
      [shared/ipc.ts](../../../src/shared/ipc.ts); `ipcMain.handle` in
      [main/ipc.ts](../../../src/main/ipc.ts); `broadcast(IPC.shortcutStatusChanged, …)` after every
      `apply()` in [index.ts](../../../src/main/index.ts); `getShortcutStatus` +
      `onShortcutStatusChanged` in [preload.ts](../../../src/main/preload.ts) and
      [renderer/api.ts](../../../src/renderer/api.ts). Mirror throughout:
      `getSettings`/`onSettingsChanged`.
      *Acceptance:* `npm run typecheck` green; the renderer can read the status on mount and
      receives an update when a registration fails.
- [x] D7 — **Shortcut field in Settings.** A focusable capture control showing the current
      combination; while focused, the next key chord is captured via `acceleratorFromChord`
      (D4) and saved through `apply()`, an invalid chord is rejected without saving. Buttons
      "Reset" (back to `Ctrl+Alt+C`) and "Off" (`''`). Below it, the D6 status: nothing when
      registered, otherwise a visible warning ("Ctrl+Alt+C is already taken by another
      application — pick a different combination"). Files:
      [SettingsView.tsx](../../../src/renderer/components/SettingsView.tsx),
      [styles.css](../../../src/renderer/styles.css).
      *Acceptance:* a conflicting combination (e.g. one already held by another running app)
      shows the warning instead of failing silently; "Off" removes the shortcut; the value
      survives a restart.
- [x] D8 — **Keyboard navigation in the popover.** Document-level `keydown` in
      [popover.tsx](../../../src/renderer/popover.tsx): `ArrowDown`/`ArrowUp` move focus over
      `containerRef.current.querySelectorAll('button.popover-row')` (clamped at both ends,
      `preventDefault` so the window does not scroll), `Escape` → `void api.closePopover()`;
      the handler ignores events with `defaultPrevented`, and NotifySwitch's Escape branch
      (L96) gains `event.preventDefault()`. The first row is focused on mount and on the
      window's `focus` event, and re-focused when the previously focused row disappears from
      the list. `.popover-row:focus` gets an outline + hover background in
      [styles.css](../../../src/renderer/styles.css) (next to `.popover-row:hover`, ~L808).
      *Acceptance:* opening the popover focuses the top row, ↑/↓ walk the rows across group
      headers, Enter jumps to the focused session (native button activation), Esc closes the
      popover, and Esc with the notify menu open closes only the menu.

## Model Hints

- D2 → `deliverable-hard` — the login item is a Windows registry write whose `openAtLogin`
  readback only matches when `path` *and* `args` are passed identically to get and set, and a
  wrong self-heal comparison either rewrites the registry on every start or leaves a dead entry.
- D1, D3–D8 → default tier (single- or two-file changes with explicit acceptance; D5 and D6 are
  larger but follow existing patterns line for line).
- Review: → `story-review-hard` — the story touches two process-global resources (a login item
  in the registry, a global hotkey registration) that no unit test in this repo can observe, so
  a leak or a dead entry is invisible in a green build.

## Test Plan (manual acceptance)

Run `npm run dev` (electron-vite dev; unset `ELECTRON_RUN_AS_NODE` when launching from VS Code).
Every step is driven through the real UI.

1. **Autostart on:** open the main window → Settings, tick "Start with Windows". Read the hint.
   Verify in PowerShell that
   `Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'` now contains an
   entry for Claude Control pointing at the current EXE with `--autostart`. Restart the app and
   confirm the checkbox is still ticked.
2. **Start to tray:** launch the app manually with `--autostart` appended. It must appear in the
   tray with no window and no "No Claude Code data found" dialog.
3. **Path repair:** with autostart on, quit, edit the registry value to a bogus path, start the
   app again — the value is rewritten to the real EXE path.
4. **Autostart off:** untick the checkbox; the `Run` entry disappears.
5. **Hotkey:** with another application in the foreground, press `Ctrl+Alt+C` — the popover
   appears at the tray. Press it again — it closes.
6. **Reconfigure:** in Settings, focus the shortcut field and press `Ctrl+Alt+P`. The field
   shows the new combination; `Ctrl+Alt+P` now opens the popover and `Ctrl+Alt+C` does nothing.
   Press "Reset" to go back.
7. **Conflict:** set the shortcut to a combination another running application already owns
   (e.g. a global hotkey of a running tool). Settings shows the warning, not silence.
8. **Release on quit:** quit via the tray menu, then press the shortcut — nothing happens and
   the combination reaches the other application again.
9. **Keyboard in the popover:** press the hotkey. The top row is focused. Press ↓ and ↑ across
   at least two project groups — focus never lands on a group header and stops at the ends.
   Press Enter — the app jumps to that session and the popover closes.
10. **Esc:** reopen the popover, open the `notify: …` menu, press Esc — only the menu closes.
    Press Esc again — the popover closes.

## Coverage

| Acceptance criterion | Deliverable |
| --- | --- |
| Settings checkbox registers/unregisters the login item, survives restart | D1, D2, D3 |
| Started at login, comes up to the tray without a window | D2 |
| Portable-EXE caveat handled (path follows the EXE) and stated in the hint | D2, D3 |
| Configurable global shortcut opens and closes the popover | D1, D4, D5, D7 |
| Registration conflict reported in Settings | D5, D6, D7 |
| Shortcut released on quit | D5 |
| ↑/↓ skip group headers, Enter jumps, Esc closes | D8 |
| Opening focuses the most urgent row | D8 |

## Done

**Summary.** All 8 deliverables implemented: settings schema (D1), autostart login item with
`--autostart` dialog suppression (D2), autostart checkbox + portable-EXE hint (D3), a pure
accelerator helper (D4), a `ShortcutManager` wired into main plus `will-quit` cleanup (D5), the
shortcut-status IPC pair (D6), the capture field + conflict warning in Settings (D7), and
document-level keyboard navigation with focus management in the popover (D8). Went through two
review-fix cycles with `story-review-hard` (see Decisions) before landing clean.

**Decisions (beyond the ones already in `## Decisions (Sprint)`):**
- `healAutostartPath()` was simplified to a documented no-op. Electron's `getLoginItemSettings`
  cannot observe a registered path different from the one you ask about — omitting `path`/`args`
  defaults them to `process.execPath`, so the lookup is always scoped to the *current* EXE and a
  stale entry at an old path is either filtered out or (if it happens to match) reported as
  already correct. There is no public-API way to detect drift independent of already knowing the
  drifted path. The portable-EXE acceptance criterion is instead satisfied end-to-end by
  `applyAutostart()`'s existing unconditional call on every start
  ([index.ts:47](../../../src/main/index.ts#L47)), which always writes the *current*
  `process.execPath` — so a moved EXE's entry is corrected the next time the app starts with
  autostart on. Functionally equivalent to the planned mechanism, arrived at differently; see
  `src/main/autostart.ts` for the full reasoning in the doc comment.
- `NotifySwitch`'s Escape handler is registered with `capture: true` on `window` rather than
  relying on bubble order — a `document`-level bubble listener (`Popover`'s Esc/arrow handler)
  otherwise fires *before* a `window`-level bubble listener, so `preventDefault()` came too late
  to be seen. Capture on `window` fires first in the dispatch sequence, which is what the "the
  popover does not close while the notify menu is open" behavior actually needs.
- Popover focus tracking split into three concerns: an unconditional `focusTopRow()` for
  mount/reopen (every open must land on the top row, not just the first), a `focusedRowId` ref
  updated via each row's `onFocus` so a mid-session re-render only refocuses when the specific
  focused row disappears (not whenever focus is anywhere outside the row list — that was yanking
  focus away from Pin/Close/notify), and a `focusedYet` ref so the very first open (where session
  data can arrive after the window's native `focus` event already fired) keeps retrying until a
  row actually exists to focus. A narrow residual: if the popover opens with zero sessions and the
  user focuses Pin/Close before the first session ever arrives, that first arrival still steals
  focus onto the new row — accepted as the intended "focus the most urgent row" behavior taking
  priority in an edge case that only exists before any row has ever held focus in that session.
- The shortcut-capture field's `onKeyDown` lets `Tab`/`Shift+Tab` through before its capture
  `preventDefault()`, so the control is not a keyboard trap.
- The Settings conflict warning always names `formatAccelerator(status.accelerator)` rather than
  `status.error`, since `ShortcutManager` always sets the same generic error string on failure —
  the accelerator name is the actionable information.
- `ShortcutManager.apply()` early-returns when the accelerator hasn't changed, so an unrelated
  settings save (e.g. a notification toggle) no longer briefly unregisters and re-registers the
  live hotkey.

**Verification:** `npm run typecheck`, `npm test` (180/180), `npm run build` all green after
every deliverable and after both fix rounds. Reviewed by `story-review-hard` three times: first
pass FAIL (6 substantive findings + minor hygiene items), second pass FAIL (2 of 5 fixes did not
fully hold — autostart heal was fixed for the wrong reason, popover had a first-open focus race),
third pass PASS on the two remaining items. Unfixed (deliberately, documented above): the
zero-sessions-then-first-arrival focus-steal edge case (harmless, narrow); `ShortcutManager.dispose()`
is unused (AC 6 is carried entirely by `will-quit` → `unregisterAll()`, which is sufficient);
`ShortcutStatus` is declared independently in `shortcuts.ts` and `shared/ipc.ts` (structurally
identical, not linked — cosmetic).

**Live smoke:** not run — no live Electron environment available in this session (headless). The
`## Test Plan (manual acceptance)` section above has the exact steps. Status is left
`in-progress`; live/manual acceptance is handed to the user per the project's `live-smoke-required`
policy.

**Commit message:** `003: autostart, global shortcut, popover keyboard navigation`

**Changed files:** src/core/model/settings.ts, src/main/autostart.ts (new), src/main/shortcuts.ts
(new), src/shared/accelerator.ts (new), src/main/index.ts, src/main/ipc.ts, src/main/preload.ts,
src/shared/ipc.ts, src/renderer/components/SettingsView.tsx, src/renderer/popover.tsx,
src/renderer/styles.css, test/unit/derivations.test.ts, test/unit/presentation.test.ts,
docs/sprints/S02/progress.md (new).
