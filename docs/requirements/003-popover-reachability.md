---
id: 003
title: Reach the popover without hunting for it
status: draft # draft -> ready -> in-progress -> done
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

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] A Settings checkbox registers and unregisters the login item, and the choice survives a
      restart
- [ ] Started at login, the app comes up to the tray without opening a window
- [ ] The portable-EXE caveat is handled or stated in the hint text rather than glossed over:
      the registered path points at wherever the EXE currently sits, and moving it silently
      breaks the entry
- [ ] A configurable global shortcut opens and closes the popover (pressing it again closes)
- [ ] A registration conflict is reported in Settings instead of failing silently
- [ ] The shortcut is released on quit
- [ ] ↑/↓ move between rows, skipping group headers; Enter jumps to the focused session; Esc
      closes the popover
- [ ] Opening the popover focuses the most urgent row, so a blind Enter does the expected thing

## Open Questions

- **Portable EXE and autostart:** handle the moved-EXE case (re-register on start when the path
  differs) or document it as unsupported in the checkbox hint? Both are honest; only silently
  registering a path that will rot is not.
- **Default shortcut:** which combination, given it must be unclaimed on a normal Windows
  desktop.

## Plan

## Deliverables

- [ ] D1 — `app.setLoginItemSettings({ openAtLogin })` in
      [main/index.ts](../../src/main/index.ts), a persisted flag under `ui` in
      [settings.ts](../../src/core/model/settings.ts), and a checkbox plus hint in
      [SettingsView.tsx](../../src/renderer/components/SettingsView.tsx). Starts to tray, no
      window.
- [ ] D2 — `globalShortcut` registration in [main/index.ts](../../src/main/index.ts) with
      toggle semantics, configurable in Settings, conflict surfaced in Settings, released on
      quit.
- [ ] D3 — Keyboard navigation in [popover.tsx](../../src/renderer/popover.tsx): arrow-key
      focus movement across group headers, Enter to jump, Esc to close, initial focus on the
      most urgent row.

## Model Hints

## Test Plan (manual acceptance)

## Done
