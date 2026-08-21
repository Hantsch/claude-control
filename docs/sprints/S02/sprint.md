---
sprint: S02
status: in-progress # planned | in-progress | done
branch: sprint/S02
milestone: M2 — Always there, no mouse required
---

# Sprint S02 — Always there, no mouse required

## Goal

The app is running before you need it and reachable without a mouse: autostart with Windows, a
global hotkey that toggles the popover, and keyboard navigation once you are in it. The two
standing noise sources — abandoned windowless sessions and un-actionable toasts — are gone.

## Stories (in build order)

- [ ] 003 — Reach the popover without hunting for it
- [ ] 004 — Noise control — abandoned sessions and actionable toasts

## Notes

Second sprint of Phase 2, cut once M1 was accepted (2026-08-21). Both stories carry open
questions for the `/sprint` clarification round:
- 003: portable-EXE autostart behaviour (re-register on path change vs. document as
  unsupported) and the default global-shortcut combination.
- 004: whether session mutes survive an app restart.

No dependency between 003 and 004; build order follows the roadmap's payoff-per-hour ranking.
