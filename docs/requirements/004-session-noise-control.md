---
id: 004
title: Noise control — abandoned sessions and actionable toasts
status: ready # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

Two sources of noise, both about sessions you have already mentally written off.

**Abandoned processes.** Closing a terminal does not always take its `claude` process with it;
the leftover is re-parented to the shell and can linger for days as a genuinely-running but
abandoned session, sitting next to the real one in the same folder. `hideUnusedSessions` does
not catch it — that session has a transcript and history. ClaudeSessionTray's discriminator is
the terminal window: an abandoned process has none
(`ClaudeSessionTray.Core/ClaudeSessionsWatcher.cs:102`). Its restraint is the good part — drop a
windowless session **only** when a windowed one exists for the same folder, because two sessions
deliberately open on one repo are common and must both stay visible, and with nothing to compare
against, showing it beats hiding a real one.

**Toasts you cannot act on.** A toast currently offers exactly one gesture: click to jump. The
two things actually wanted at that moment are "take me there" and "stop telling me about this
one" — a session deliberately left running unattended should be silenceable from the
notification that interrupted you, not from a settings tab.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] A windowless session alongside a windowed one in the same folder disappears from the live
      surfaces
- [ ] Two windowed sessions in one folder both stay; a lone windowless session stays
- [ ] The filter is a setting, default on
- [ ] `core/` still imports no Win32 (CONCEPT §9) — the window probe is injected as a
      capability from `main/`, and with no probe supplied nothing is ever dropped
- [ ] A toast carries "Jump" and "Mute this session"
- [ ] A muted session produces no further toasts but still shows its real status everywhere
- [ ] The mute is visible and revocable in the popover row and the detail pane — an invisible
      mute is a bug report waiting to happen

## Open Questions

- ~~**Do mutes survive a restart?** Either answer is defensible; it has to be chosen deliberately
  rather than falling out of where the state happens to live.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Mutes do not survive an app restart — in-memory only, reset on restart.
- **Same-folder key is `SessionView.cwd`**, not `groupKey` — the requirement says "same folder",
  and two worktrees of one repo are different folders that must be judged independently.
- **The injected probe is a *synchronous cache read*** `hasTerminalWindow?: (pid) => boolean |
  undefined` on `ControlEngineOptions` (mirroring the existing `createWatcher` seam), because
  `findWindowUpChain` spawns PowerShell with an 8 s timeout while `getSnapshot()` is synchronous
  and runs on every tick.
- **`undefined` from the probe means "not known yet" and never drops a session** — same safe
  default as "no probe supplied", so a slow or failed probe can never hide a real session.
- **`main/` probes only *candidate* pids** — sessions in a folder that holds ≥ 2 live sessions —
  with a TTL re-probe, because a lone session can never be dropped and so never needs a probe;
  this keeps the PowerShell cost at zero in the common case.
- **One batched PowerShell call per probe pass** (new `findWindowsUpChain(pids)` next to
  `findWindowUpChain`) instead of one child process per pid — same query, N× less spawn cost.
- **The filter is `list.hideOrphanSessions`, default `true`**, sitting next to
  `hideUnusedSessions` in the same schema block, merge validation and Settings section — an
  established pattern beats a new mechanism.
- **Orphans are hidden from the live surfaces only**, exactly like `hideUnusedSessions`: a
  presentation filter, the store and history keep the session.
- **The mute *registry* lives in `ControlEngine` (in-memory `Set<SessionId>`), not in
  `NotificationGate`** (small deviation from the original D3 wording), because the mute must also
  reach `SessionView`, the renderer and IPC; the *decision* stays pure in core —
  `decideNotification` gains a `muted` argument and a new `'session-muted'` skip reason.
- **Mute reaches the renderer as `SessionView.muted`, decorated in `getSnapshot()`**, so it rides
  the existing `IPC.stateChanged` broadcast; `setMuted` re-emits immediately, mirroring
  `acknowledge()`.
- **Mute touches nothing but `decideNotification`** — status, sorting, grouping, tray badge and
  detail text are untouched, which is what "still shows its real status everywhere" means.
- **A mute is cleared on transition to `ended`**, mirroring the gate's existing cooldown reset, so
  a reappearing session id cannot inherit a stale mute.
- **Toast buttons use Windows `toastXml` with `activationType="protocol"` and a
  `claude-control://` URI**, because Electron's `actions` field is macOS-only; activation arrives
  through the single-instance `second-instance` argv handler that already exists
  ([index.ts:25,131](../../src/main/index.ts)).
- **Non-Windows or `Notification.isSupported() === false` falls back to today's plain toast**
  (click = jump, no buttons) — the feature degrades, it does not break.
- **The popover row becomes `div role="button"` + a nested mute button**, because the row is one
  `<button>` today and a button inside a button is invalid HTML.

## Plan

Two independent noise sources, built as two chains that only meet in the renderer.

**A — orphan filter (D1–D3).** `core/` gets a new setting and a new injected capability; nothing
Win32 crosses the boundary (`test/unit/boundaries.test.ts` already guards this).

1. `src/core/model/settings.ts` — `ListSettings.hideOrphanSessions`, default `true`, plus merge
   validation next to `hideUnusedSessions` (lines ~88 / ~181 / ~285).
2. `src/core/engine.ts` — `ControlEngineOptions.hasTerminalWindow?` (seam like `createWatcher`,
   line 77); in `getSnapshot()` (line 168) drop a session iff the setting is on, its own probe
   says `false`, and another live session with the same `cwd` probes `true`.
3. `src/main/focus/processChain.ts` — batched `findWindowsUpChain(pids)`; new
   `src/main/focus/windowProbe.ts` holds the pid→bool cache + TTL and picks candidates;
   `src/core/createEngine.ts` / `src/main/index.ts:41` inject the sync lookup.
4. `src/renderer/components/SettingsView.tsx:105` — the toggle.

**B — mute (D4–D7).** State in core, transport over the existing channels, two surfaces.

5. `src/core/state/notifications.ts` — `decideNotification(..., muted)` + `'session-muted'`;
   `NotificationGate.evaluate` takes the flag.
6. `src/core/model/types.ts:275` — `SessionView.muted`; `engine.ts` `setMuted()/isMuted()`,
   decorated in `getSnapshot()`, emitted like `acknowledge()` (engine.ts:258).
7. `src/shared/ipc.ts` / `preload.ts` / `main/ipc.ts` — `cc:setSessionMuted`, mirroring
   `cc:acknowledge`; `main/notifier.ts` gets an `isMuted` dep, wired in `index.ts:53`.
8. `main/notifier.ts` + protocol activation — the two toast buttons.
9. `SessionsView.tsx` (row) and `SessionDetailPane.tsx` (next to "Jump to session") — badge +
   toggle.

Order: 1→2→3→4 and 5→6→7→8→9 are each sequential; the two chains are independent.

## Deliverables

- [ ] D1 — **Core: orphan filter + capability seam.** `ListSettings.hideOrphanSessions` (default
      `true`, merge validation) in [settings.ts](../../src/core/model/settings.ts); optional
      `hasTerminalWindow?: (pid: number) => boolean | undefined` on `ControlEngineOptions` and the
      same-folder (`cwd`) filter in `getSnapshot()` in [engine.ts](../../src/core/engine.ts)
      — mirror the existing `createWatcher` seam (engine.ts:77,117) and the
      `hideUnusedSessions` filter line (engine.ts:177). Unit tests in `test/unit/derivations.test.ts`.
      *Acceptance:* windowless + windowed in one folder → windowless gone; two windowed → both
      stay; lone windowless stays; probe absent or returning `undefined` → nothing dropped;
      setting off → nothing dropped. `npm test` green, `boundaries.test.ts` still green.
- [ ] D2 — **Main: batched window probe + cache, injected.** `findWindowsUpChain(pids)` in
      [processChain.ts](../../src/main/focus/processChain.ts) (one PowerShell call for all pids,
      same loop as `findWindowUpChain`); new `src/main/focus/windowProbe.ts` with the pid→bool
      cache, TTL re-probe and candidate selection (only folders with ≥2 live sessions); wired
      through [createEngine.ts](../../src/core/createEngine.ts) and
      [index.ts](../../src/main/index.ts) so `hasTerminalWindow` reaches the engine.
      *Acceptance:* with two sessions in one folder the cache fills within one probe pass and the
      list settles; a single session in a folder triggers no PowerShell call at all.
- [ ] D3 — **Renderer: the setting.** Toggle for `hideOrphanSessions` in
      [SettingsView.tsx](../../src/renderer/components/SettingsView.tsx), mirroring the
      `hideUnusedSessions` checkbox at line 105. *Acceptance:* toggling it changes the popover
      list without a restart.
- [ ] D4 — **Core: mute state + decision.** `muted` argument and `'session-muted'` reason in
      `decideNotification` / `NotificationGate.evaluate`
      ([notifications.ts](../../src/core/state/notifications.ts)); `SessionView.muted`
      ([types.ts](../../src/core/model/types.ts):275); in-memory `Set<SessionId>` plus
      `setMuted()/isMuted()` in [engine.ts](../../src/core/engine.ts), decorated in
      `getSnapshot()` and re-emitting like `acknowledge()` (engine.ts:258); cleared on `ended`.
      *Acceptance:* unit tests — a muted session yields `notify: false, reason: 'session-muted'`,
      its `status`/`statusSince`/sort position are unchanged, unmuting restores toasts, `ended`
      clears the mute, and a fresh engine starts with no mutes.
- [ ] D5 — **IPC + notifier wiring.** `IPC.setSessionMuted` (`cc:setSessionMuted`) in
      [ipc.ts](../../src/shared/ipc.ts), preload wrapper
      ([preload.ts](../../src/main/preload.ts):27) and `ipcMain.handle`
      ([main/ipc.ts](../../src/main/ipc.ts):36) — mirror `acknowledge` end to end; `isMuted` dep
      on `Notifier` ([notifier.ts](../../src/main/notifier.ts):20) wired from the engine in
      [index.ts](../../src/main/index.ts):53. *Acceptance:* calling the preload API flips
      `muted` in the next `stateChanged` payload and suppresses the next toast.
- [ ] D6 — **Toast buttons.** Two buttons ("Jump", "Mute this session") via Windows `toastXml`
      with `activationType="protocol"` in [notifier.ts](../../src/main/notifier.ts); protocol
      registration and argv parsing (`claude-control://jump|mute?session=…`) in
      [index.ts](../../src/main/index.ts) on the existing `second-instance` handler (index.ts:131),
      with the plain-`Notification` fallback kept for unsupported platforms.
      *Acceptance:* a real toast shows both buttons; "Jump" focuses the session; "Mute this
      session" mutes it and no further toast for it appears.
- [ ] D7 — **Mute visible and revocable in the UI.** Badge + toggle in the popover row
      ([SessionsView.tsx](../../src/renderer/components/SessionsView.tsx):100-142, row
      restructured to `div role="button"` + nested action button) and next to "Jump to session"
      in [SessionDetailPane.tsx](../../src/renderer/components/SessionDetailPane.tsx):50-54,
      plus styles. *Acceptance:* a muted session is recognisable as muted in the popover without
      opening anything, and can be unmuted from both surfaces; row click/double-click behaviour
      is unchanged.

**AC coverage:** windowless-next-to-windowed disappears → D1 (+D2 probe) · two windowed / lone
windowless stay → D1 · filter is a setting, default on → D1 + D3 · `core/` no Win32, probe
injected, no probe = nothing dropped → D1 + D2 (guarded by `test/unit/boundaries.test.ts`) ·
toast carries Jump + Mute → D6 · muted session: no toasts, real status everywhere → D4 + D5 ·
mute visible and revocable in row + detail pane → D7 (+D5).

## Model Hints

- D6 → `deliverable-hard` — protocol-activation toasts are the one path here that can silently
  regress the whole notification feature: `toastXml` replaces title/body/icon rendering wholesale
  and the button callback arrives through the single-instance argv handler, not through
  `notification.on('click')`.
- D1, D2, D3, D4, D5, D7 → default tier.
- Review: → `story-review-hard` — two ACs are of the kind that pass a green build and still be
  wrong: "`core/` imports no Win32 / no probe means nothing is dropped", and "a muted session
  still shows its real status everywhere".

## Test Plan (manual acceptance)

Run `npm run dev`. Windows, at least two terminals.

**Orphan filter**
1. Open two `claude` sessions in the *same* folder from two separate terminal windows → the
   popover shows both.
2. Close one terminal window with `taskkill /f /im WindowsTerminal.exe` avoided — just close the
   window normally so the `claude` process survives (verify with
   `Get-Process claude | Select-Object Id`). Within ~1 minute that session disappears from the
   popover and the tray menu; the other one stays.
3. Open a single `claude` session in a folder of its own and close its terminal window → it
   **stays** visible (nothing to compare against).
4. Settings → uncheck "Hide abandoned sessions" → the session from step 2 reappears without a
   restart. Re-check it → gone again.

**Toast + mute**
5. Let a session finish a turn so a toast appears → it carries "Jump" and "Mute this session".
6. Click "Jump" → its terminal window comes to the front.
7. Trigger another toast, click "Mute this session" → the popover row for that session shows the
   mute marker, and the detail pane shows it as muted.
8. Let that session finish another turn (after the cooldown) → **no** toast, but its row still
   shows the real status (`done`/`waiting`), the correct age and the tray badge behaves as before.
9. Unmute from the popover row → the next turn end produces a toast again. Unmute from the detail
   pane as well and confirm both surfaces stay in sync.
10. Restart the app while a session is muted → it comes back **unmuted** (decided: in-memory
    only).

## Done
