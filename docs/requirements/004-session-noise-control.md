---
id: 004
title: Noise control — abandoned sessions and actionable toasts
status: draft # draft -> ready -> in-progress -> done
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

- **Do mutes survive a restart?** Either answer is defensible; it has to be chosen deliberately
  rather than falling out of where the state happens to live.

## Plan

## Deliverables

- [ ] D1 — Window-based orphan filter next to the existing `list.hideUnusedSessions` handling,
      driven by an injected `hasTerminalWindow` capability; the probe itself is
      `findWindowUpChain` in
      [processChain.ts](../../src/main/focus/processChain.ts), which already answers "does this
      pid have a window up its chain". Same-folder comparison, setting, default on.
- [ ] D2 — Toast actions in [notifier.ts](../../src/main/notifier.ts) via Electron's
      `actions` / `toastXml`: "Jump" (today's behaviour) and "Mute this session".
- [ ] D3 — Per-session mute state in the `NotificationGate`
      ([notifications.ts](../../src/core/state/notifications.ts)), which already owns
      per-session notification state via `cooldownMs`; surfaced and revocable in the popover row
      and the detail pane.

## Model Hints

## Test Plan (manual acceptance)

## Done
