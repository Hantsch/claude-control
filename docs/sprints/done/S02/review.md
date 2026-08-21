# Sprint S02 Review — Always there, no mouse required

## Overview

Goal: the app is running before you need it and reachable without a mouse — autostart with
Windows, a global hotkey that toggles the popover, and keyboard navigation once you are in it.
Plus the two standing noise sources (abandoned windowless sessions, un-actionable toasts) are
gone.

| Story | Status | Commit |
| --- | --- | --- |
| 003 — Reach the popover without hunting for it | built, live acceptance pending | `003: autostart, global shortcut, popover keyboard navigation` |
| 004 — Noise control — abandoned sessions and actionable toasts | built, live acceptance pending | `004: noise control — abandoned sessions and actionable toasts` |

Both stories are fully implemented, unit-tested, reviewed, and green on `npm run typecheck` /
`npm test` / `npm run build`. Neither could be exercised live (headless session, no Electron UI
available) — see `## Blocked / open` below for what the user needs to check.

## Implemented stories

**003 — Reach the popover without hunting for it.** Autostart via
`app.setLoginItemSettings`, re-applied unconditionally on every start so a moved portable EXE's
entry self-heals; a configurable global shortcut (default `Ctrl+Alt+C`) that toggles the
popover, with conflict detection surfaced in Settings and released on quit; document-level
arrow-key navigation across popover rows (skipping group headers, clamped at the ends), Enter to
jump, Esc to close, and the top row focused on open.

**004 — Noise control — abandoned sessions and actionable toasts.** A same-folder orphan filter
that hides a windowless session only when a windowed one exists for the same `cwd`, driven by an
injected, fail-safe `hasTerminalWindow` capability so `core/` still imports no Win32 and an
absent/undefined probe never drops a session; an in-memory per-session mute (cleared on
`ended`, does not survive a restart, per the user's decision) that silences toasts without
touching status, sort, grouping or the tray badge; two-button Windows toasts ("Jump", "Mute this
session") via `toastXml` + protocol activation.

## Findings & decisions

- **003 — autostart path-drift detection turned out to be unobservable via Electron's public
  API.** `getLoginItemSettings` always normalizes its lookup to the given `path`/`args`, so there
  is no way to ask "what path is actually registered" independent of already knowing it. The
  planned `healAutostartPath()` became a documented no-op; the acceptance criterion is instead
  satisfied because `applyAutostart()` unconditionally rewrites the registry entry to the
  *current* `process.execPath` on every start, which self-heals a moved EXE the next time the app
  runs with autostart on. Functionally equivalent outcome, different mechanism than planned —
  worth knowing if a future story touches autostart again.
- **003 — Escape-key ordering between the popover and the notify-switch menu** needed
  `capture: true` on the menu's own listener; a bubble-phase `document` listener otherwise sees
  the event before a bubble-phase `window` listener can call `preventDefault()`. General
  takeaway for future keyboard-shortcut work in this app: prefer capture-phase handlers for
  "this specific control should swallow the key before anything else sees it."
- **003 — left as deliberately unfixed:** a narrow focus-steal edge case (zero sessions open,
  user focuses Pin/Close, then the first session ever arrives and steals focus onto its row) and
  a cosmetic duplicate `ShortcutStatus` type declaration between `shortcuts.ts` and
  `shared/ipc.ts`.
- **004 — packaged/portable build was silently losing the toast's per-status icon.** Caught only
  by review, not by any green test: `toastIconUri` returned `null` for any `.asar`-relative path
  with no `asarUnpack` entry for `assets/icons/**`. Fixed by unpacking the icons and rewriting
  the lookup path; a reminder that anything gated on `app.getAppPath()`/`.asar` needs either an
  `asarUnpack` entry or a packaged-build smoke test, because dev runs can never exercise this
  branch.
- **004 — a nested interactive element inside an existing keyboard-navigable row broke arrow-key
  navigation from that nested element** (D7's mute-toggle button inside the popover row broke
  `indexOf`-based "current row" resolution from 003's D8). General takeaway: adding any focusable
  control inside an existing row/list item should be checked against that list's own keyboard
  navigation, not just its own click handler.
- **004 — two lower-priority residual risks accepted, not fixed** (documented in the story's Done
  section): the portable target's registered protocol handler path can go stale between runs
  (pre-existing property of the `portable` electron-builder target, not introduced by this
  story); a single-pid window-probe failure is cached as a definite "no window" for the 30s TTL
  rather than "unknown," which could theoretically hide a live session for up to 30s in an
  already-narrow candidate set (folders with ≥2 live sessions). Neither has been observed in
  practice; both are candidates for a future hardening pass if they ever surface as a real
  complaint.
- **Both stories: "done" here means build/test/review complete, not live-verified** — this
  session had no Electron UI available (headless), so `live-smoke-required` could not be
  satisfied by the agents. See Blocked/open below.

## Blocked / open

Nothing is blocked in the sense of needing a product decision — both stories are fully built.
What's open is live acceptance:

- **003 and 004 are "built, live acceptance pending."** Run `npm run dev` and walk each story's
  `## Test Plan (manual acceptance)` section (in
  [003](../../requirements/003-popover-reachability.md) and
  [004](../../requirements/004-session-noise-control.md), also consolidated in
  [testplan.md](testplan.md)) before considering M2 accepted. In particular: real Windows toast
  rendering with both buttons, and `notification.on('click')`/protocol-activation behaviour under
  `toastXml`, could not be exercised at all outside a live Windows session with a running
  Explorer/notification stack.
