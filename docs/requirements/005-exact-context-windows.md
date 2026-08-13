---
id: 005
title: Exact context windows — and the network promise it costs
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

The context gauge exists so you can intervene before auto-compaction degrades a session. Its
denominator is currently guessed from a lookup table — the `widened` flag on `ContextPressure`
([types.ts:54](../../src/core/model/types.ts#L54)) exists precisely to admit that. The
200k-versus-1M case is where a guess stops being useful, and it is the case this project hits
daily. Both reference tools solve it the same way: LiteLLM's community-maintained
`model_prices_and_context_window.json`, which supplies each model's context window.
ClaudeSessionTray's report is worth trusting here — an earlier attempt at guessing the window
was "wrong often enough to be useless".

**The conflict to resolve before any code.** README.md and Settings → Diagnostics currently
promise the app "makes no network requests". This breaks that promise, so it cannot ship as a
silent default. It has to be an explicit opt-in with the wording updated in both places — and if
that trade is not wanted, the honest outcome is to close this story as rejected and keep
labelling the gauge an estimate. The story is not a refactor with a checkbox on top; the
decision is the story.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md),
which records the related web-dashboard rejection made on the same promise.

## Acceptance Criteria

- [ ] The setting is off by default and the app makes no network request until it is turned on
- [ ] Startup never waits on the network
- [ ] Offline with no cache, the gauge falls back to today's estimate and stays labelled as one
- [ ] **No hardcoded price/window table is added** — a stale table reports confident nonsense,
      which is worse than an admitted estimate
- [ ] The cache lives under `%APPDATA%` and refreshes at most weekly, in the background
- [ ] README.md and Settings → Diagnostics state what the app does when the setting is on, and
      no longer make a promise the app can break

## Open Questions

- **Is the trade wanted at all?** Opt-in network access plus reworded promise, or close this
  story as rejected and keep the estimate. This is a product decision and blocks everything
  below it.

## Plan

## Deliverables

- [ ] D1 — Decision recorded (accept opt-in / reject the story), and on accept: the reworded
      claim in README.md and
      [SettingsView.tsx](../../src/renderer/components/SettingsView.tsx) Diagnostics, plus the
      setting itself in [settings.ts](../../src/core/model/settings.ts), off by default.
- [ ] D2 — Window source under `core/adapters/claude/` or a sibling `core/pricing/`: background
      fetch, `%APPDATA%` cache, weekly refresh ceiling, never blocking startup, no bundled
      fallback table.
- [ ] D3 — [contextPressure.ts](../../src/core/state/contextPressure.ts) consumes the exact
      window when available and keeps the `widened`/estimate labelling when not.

## Model Hints

## Test Plan (manual acceptance)

## Done
