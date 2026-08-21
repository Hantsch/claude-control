---
id: 012
title: S02 residuals — never hide a live session, never steal the focus
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-21
---

## Requirement

Sprint S02 landed with four points its review deliberately left open
([review.md](../sprints/done/S02/review.md)). None of them has been observed in practice, which
is exactly why they are worth writing down before they are forgotten: two of them can, in a
narrow case, make the app lie about a session, and the app's whole promise is that the list on
screen is the truth.

**A — a failed window probe is remembered as "there is no window".** Story 004 hides a
windowless session only when a windowed one exists for the same folder. The probe behind that
decision has two outcomes in the code, `true` and `false`, but three in reality: yes, no, and
*the probe did not answer for this pid*. Today the third collapses into `false` and is cached
for the 30 s TTL. If the folder mate answers `true` in the same window, a live session is hidden
from the list for up to 30 s. A total probe failure is safe by construction (nothing answers
`true`, so nothing is dropped) — it is the single-pid failure that is not.

**B — the portable EXE's registered protocol handler can point at a path that no longer
exists.** `app.setAsDefaultProtocolClient` records `process.execPath`, which for the `portable`
electron-builder target is a per-run temp extraction directory. Press "Mute this session" on a
toast sitting in the Action Center after the app has exited and Windows launches a path from a
previous run. The login-item entry has the same property and is self-healed by being rewritten on
every start (story 003); the protocol handler is not, because the failing case is precisely the
one where the app is not running. Pre-existing property of the portable target, not introduced by
S02 — but it is the first S02 feature that depends on it.

**C — the popover can take the focus away from you.** With zero sessions open, focus on Pin or
Close, the first session that ever arrives steals the focus onto its row. Left unfixed in 003 as
a narrow edge; story [010](010-popover-drilldown.md) rewrites the popover's focus handling from
the ground up, so this has to be re-judged against that code rather than the code 003 shipped.

**D — `ShortcutStatus` is declared twice**, in `src/main/shortcuts.ts` and `src/shared/ipc.ts`.
Cosmetic today, a divergence waiting to happen the moment one of them grows a field.

No new user-facing capability. The measure of success is that nothing changes on screen — except
in the cases above, where something wrong stops happening.

## Acceptance Criteria

- [ ] A window probe that does not answer for a specific pid is treated as "unknown", never as
      "no window" — an unknown answer never removes a session from the list
- [ ] The unknown outcome is not cached as a decision: the next tick may still find out, rather
      than being told the stale answer for the rest of the TTL
- [ ] The existing behaviour is unchanged for the two answers the probe does give, and the
      same-folder filter still hides a genuinely windowless session when a windowed mate exists
- [ ] A full probe failure remains fail-safe (nothing is dropped), as it is today
- [ ] The toast-button path for the portable target behaves per the decision taken in the
      clarification round — either it works after a restart, or the limit is stated where a user
      meets it (README / Settings → Diagnostics) instead of failing silently
- [ ] The popover never moves the keyboard focus away from a control the user has focused
      themselves — including the "first session arrives while Pin/Close is focused" case, judged
      against story 010's focus handling, not 003's
- [ ] `ShortcutStatus` exists once, with the shared type as the single source
- [ ] `npm run typecheck`, `npm test`, `npm run build` green; `test/unit/boundaries.test.ts`
      (no Win32 import in `core/`) stays green
- [ ] No behaviour change is claimed that is not covered by a unit test — each of A, C and D is
      testable without a live Windows session

## Open Questions

- **Does the unknown probe result need to be visible anywhere?** A session that is only shown
  *because* the probe could not decide is being shown on a guess. The honest options are: show
  it exactly like any other session (silent, fail-safe, and what A asks for), or mark it — which
  would be a new visual state on the glance surface for a case that lasts one tick.
  Recommendation: silent — the fail-safe direction is "show it", and a marker for a transient
  probe hiccup is noise of exactly the kind story 004 removed.
- **How far should B go?** Three answers, and the cheap one may well be right: (1) re-register
  the protocol handler on every start and accept that a toast pressed after the app exited can
  still launch a stale path, (2) register a stable path instead of the temp extraction dir — only
  possible if there is one for the portable target, which needs checking, or (3) document the
  limit and leave the code alone. Recommendation: check whether (2) is even available for the
  `portable` target; if it is not, do (3) — it is the only honest option left, and inventing a
  launcher shim for a portable EXE is a different story than this one.
- **Is C still a bug after story 010?** 010's D7 rebuilds focus restoration across re-renders. If
  its implementation already refuses to move focus that sits outside the row list, this story's
  part C is a test, not a fix. That is a fine outcome — but it must be *checked* in the code, not
  assumed, and the test has to exist either way.

## Plan

<!-- filled by /refine -->

## Deliverables

<!-- filled by /refine -->

## Model Hints

<!-- filled by /refine -->

## Test Plan (manual acceptance)

<!-- filled by /refine -->

## Done

<!-- filled by /build -->
