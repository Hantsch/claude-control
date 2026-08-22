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

**Decision (user, 2026-08-22, S05 planning round): the trade is accepted.** The lookup ships as
an explicit opt-in, off by default, and the "makes no network requests" claim in README.md and
Settings → Diagnostics is reworded rather than quietly broken. A bundled snapshot of the table
was offered as the third way and declined — a table that goes stale inside a release is exactly
the "confident nonsense" the fourth acceptance criterion refuses. This unblocks M5; what is left
open below is how the opt-in presents itself and how an exact number is distinguished from a
guessed one, not whether it exists.

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

The blocking product question is answered above. What is left is for the sprint's clarification
round:

- **Does the gauge say where its denominator came from?** With the setting on and the model
  found in the table, does the `widened`/estimate marker simply disappear, or does the gauge
  distinguish "exact, from the fetched table" from "estimated" so a user can tell which number
  they are looking at? The same question for the tooltip and for the CLI's output.
- **A model that is not in the table.** A brand-new model absent from the fetched file falls back
  to today's estimate for that session — is that visible on the row, or silent (the setting is
  on, so a user may assume every number is now exact)?
- **A stale cache with no network.** The cache refreshes at most weekly; if a refresh fails for
  weeks, is the cached window used silently, or does something say the table is old?
- **Turning the switch on.** Fetch immediately on enable, or wait for the next background tick?
  Immediate is what a user expects; it also means the first network request happens inside a
  Settings click.
- **What Diagnostics shows once the setting exists.** The panel currently states the absolute
  promise. Does it become a state line (setting on/off, cache age, last refresh outcome), and
  does a failed fetch surface there the way 013's failed protocol registration now does?
- **Does the CLI honour the setting?** `npm run cli -- --watch` reads the same core; the setting
  lives in `settings.ts`, so it would apply — but a CLI making a network request because a GUI
  switch was flipped is worth stating deliberately rather than inheriting.

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
