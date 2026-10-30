---
sprint: S06
status: in-progress
branch: sprint/S06
milestone: M8 — Trust the live list
---

# Sprint S06 — The list tells the truth

## Goal

The live surfaces stop being wrong about what is running. Claude Code's own status word
(`busy` / `idle` / `waiting` in the registry) outranks what the app infers from the transcript,
so a session whose work has moved into a subagent is no longer shown as finished. Every session
carries the name VS Code shows for it, a popover row says which project it belongs to, and a
live session that a filter removed is visible as a number instead of silently missing. At the
end of the sprint, counting the Claude Code sessions on the machine against the sessions in the
app adds up — and where it deliberately does not, the app says why. Alongside, a past session
opens in its own resizable window.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [ ] 020 — Claude Code's own status outranks the transcript
- [ ] 016 — A session working through a subagent is not `done`
- [ ] 021 — A session is called what VS Code calls it
- [ ] 017 — The popover row says which project it is
- [ ] 018 — A hidden session says it is hidden
- [ ] 022 — A past session opens in its own, resizable window

## Notes

### Re-cut 2026-10-30 — analysis first

Extended before the sprint started, after the user reported that running stories are
"sometimes not recognised or carry the wrong name" and pointed at their `scrum-cockpit` mod,
which gets this right. Measured the same morning ([RESEARCH.md §6](../../RESEARCH.md)):

- **12 live sessions, 3 on screen.** `hideDoneOnStart` hid 9 on a cold start — among them two
  running sprints that the transcript misread as `done` (parent `end_turn` right after an
  async `Agent` launch, subagent files written a minute earlier).
- **Claude Code already knows.** Since `2.1.312` the registry carries `status`; `busy` is
  `isLoading || delegatedActive`, i.e. it covers background agents. Both sprints read `busy`.
  The app reads the field and acts only on `waiting`. This is the outside-the-process
  equivalent of what the mod sees from inside (`agent.spawn`, turn events) — the reason the
  mod "runs pretty well" and the app does not.
- **Wrong names have three causes:** `custom-title` (`/rename`) is never read, half the
  sessions have no `ai-title`, and the fallback takes injected `user` records (peer
  hand-backs, task notifications, IDE notices) for prompts.

What changed in the cut:

- **020 (new) goes first and now carries the sprint.** It is the detection fix: the registry
  status outranks inference. It takes over the detection half of 016, which stays for the
  presentation of a delegating session and the no-`status` fallback.
- **021 (new)** fixes naming. Before 017 deliberately: 017 spends line-1 width on the project,
  021 decides what the label in front of it is.
- **018 gains a third filter** (`hideDoneOnStart`), the one that hid the most. Still last of
  the live-list stories — it counts what the others decide.
- **022 (new)**, user request the same day: a History row opens a resizable detail window.
  Renderer + main only, independent of the rest — it is last so it can be cut to S07 without
  touching the sprint goal, should the five correction stories run long.
- The clarification round now has two product questions instead of one: 016's (own status for
  a delegating session, or `working`) and 020's (how much `busy`/`idle` override). Ask them
  together — they decide one thing.

### Original cut (2026-08-23)

Cut on 2026-08-23, after S05 was accepted, out of one day of real use rather than out of a
concept. All three stories were found by the user watching two sprints run in parallel and not
being able to tell from the app what was happening — which is the app's single job.

- **016 carries the sprint.** It is the only story that touches `core/`, and it is the only one
  that produces a *false* statement rather than a missing one: a session that has handed its work
  to a subagent reads `done`, fires a "done" notification, and then ages off the tray while the
  work runs for another forty minutes. Its `## Open Questions` contain the one real product
  decision of the sprint — whether a delegating session gets its own status or is `working` with
  a different reason — and that decision has consequences for the tray colour, the badge, the
  notification rules and the CLI, so it belongs in the clarification round, not in refine.
- **017 second**, deliberately before 018: both touch the popover, and 017 changes the row while
  018 changes the header. Building the row first means 018 is judged against the layout that
  ships.
- **018 last.** It reads a number the engine already has (`getLiveSessions()` is the unfiltered
  list) and spends it on two surfaces, so it is the story most likely to be shaped by whatever
  016 and 017 settle about how much a row and a header can carry.
- **Not in this sprint:** M7 / story 008 (second agent adapter) stays alone in its own sprint, as
  its own text and the roadmap both require. WSL sessions being invisible to the Windows app —
  the app reads exactly one `.claude` root — was found on the same day and dismissed by the user
  as an edge case; it has no story.
- Carried out of S05 and still open, deliberately not picked up here (different theme — numbers,
  not the live list): 005's subagent chips render `'estimated'` unconditionally, and 005's CLI
  reads the exact-window cache but never refreshes it.
