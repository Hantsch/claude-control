---
sprint: S06
status: planned # planned | in-progress | done
branch: # set by /sprint
milestone: M8 — Trust the live list
---

# Sprint S06 — The list tells the truth

## Goal

The live surfaces stop being wrong about what is running. A session whose work has moved into a
subagent is no longer shown as finished, a popover row says which project it belongs to, and a
live session that a filter removed is visible as a number instead of silently missing. At the end
of the sprint, counting the Claude Code sessions on the machine against the sessions in the app
adds up — and where it deliberately does not, the app says why.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [ ] 016 — A session working through a subagent is not `done`
- [ ] 017 — The popover row says which project it is
- [ ] 018 — A hidden session says it is hidden

## Notes

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
