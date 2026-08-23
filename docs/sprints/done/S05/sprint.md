---
sprint: S05
status: done # planned | in-progress | done
branch: sprint/S05
milestone: M5 — Exact context windows
---

# Sprint S05 — Numbers the app can stand behind

## Goal

The context gauge stops guessing — for anyone who lets it onto the network — and the two places
where the app still prints a figure it cannot fully back are made honest: a history group total
says when it only covers the page it was handed, and the tray tile stops being drawn for a dark
taskbar only.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 005 — Exact context windows, and the network promise it costs (accepted 2026-08-23)
- [x] 015 — S04 residuals — a total that admits its page, and a test that cannot miss its event (accepted 2026-08-23)
- [x] 014 — Tray tile on a light taskbar (accepted 2026-08-23)

## Notes

Cut on 2026-08-22, after S04 was accepted and M6 closed.

- **M5 is unblocked by a user decision, not by code.** The product question story 005 called "the
  story" is answered: the LiteLLM window lookup ships as an explicit opt-in, off by default, with
  the "makes no network requests" claim in README.md and Settings → Diagnostics reworded rather
  than quietly broken. A bundled snapshot of the table was offered as a third way and declined —
  it goes stale inside a release, which is the "confident nonsense" 005's fourth acceptance
  criterion refuses. The decision is recorded in the story.
- **005 first, and it carries the sprint.** It is the only story here that touches `core/`, adds
  the app's first network path and changes two user-facing promises. It also has the most open
  questions (six, all for the clarification round) — none of them blocking, all of them about how
  an exact number is distinguished from a guessed one.
- **015 second.** It sits in the history view and the timing test that story 006 just changed, so
  it is judged against code the sprint has not moved. Its part A is the one S04 finding with a
  user-visible cost; part B is test hygiene bundled alongside because it would never be scheduled
  on its own.
- **014 last, deliberately.** It is the only story whose answer may be *art* rather than code —
  if the clarification round asks for a new image-gen master set, the step needs the user, and a
  story that can stall belongs where stalling costs least. A programmatic treatment of the shipped
  tiles is the cheaper alternative the story puts up for decision.
- **Three stories, not five.** M5 is one story by construction and the other two are the carried
  residuals the user chose to pick up in this sprint's planning round. Nothing else in Phase 3 is
  schedulable: M7 (story 008) is explicitly its own milestone and gets its own sprint.

Not scoped here: M7 / story 008 (second agent adapter) — the largest, least-bounded piece of the
phase, deliberately alone in a later sprint.

## Closed

Accepted by the user on 2026-08-23 and moved to `done/` together with all three stories. The
acceptance was a decision, not a walk through `testplan.md` step by step — what is live-confirmed
and what is not is recorded per story in each `## Done` section. In short: 005's default (off)
half runs in the real app and its opt-in half does not; 014's tile is what the user looks at all
day, which is also how its generated-art half came to be superseded; 015's CLI half was checked
live during the build and its History-view half was not.

Carried out of the sprint, unchanged by the acceptance: 005's subagent chips still render
`'estimated'` unconditionally, 005's CLI reads the exact-window cache but never refreshes it,
014's AC 3 (theme flip without a restart) is unticked, and 015's real paging is unbuilt.
