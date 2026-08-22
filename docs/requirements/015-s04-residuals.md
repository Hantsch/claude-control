---
id: 015
title: S04 residuals — a total that admits its page, and a test that cannot miss its event
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

The two points [S04's review](../sprints/done/S04/review.md) recorded as "accepted as out of
scope, not fixed" — bundled the way [012](done/012-s02-residuals.md) and
[013](done/013-s03-residuals.md) bundled the sprints before them, because separately neither is
worth a sprint slot and carrying them forward is how they get forgotten.

**A — a group total that only covers the page it was given.** Story
[006](done/006-activity-and-history-attribution.md) added per-group usage totals to the history
view, and the view fetches a fixed 200-entry page. So a filter matching more than 200 entries
produces group totals that silently describe the first 200 and nothing marks them as partial. The
`~` prefix 006 introduced does not cover this: it means "some entries in this group had no usable
usage numbers", not "there are more entries than were counted". A user reading "where did my week
go" off a busy filter gets a number that is confidently wrong in the one direction that matters —
too low — and has no way to see it. The page size predates 006 and paging was never in its plan,
which is why the review left it; it is still a number the app should not print unqualified.

**B — a test that can miss the event it waits for.** The N5 cold-start test in
[pipeline.test.ts](../../test/unit/pipeline.test.ts) attaches its listener *after*
`await engine.start()` has resolved, so an event emitted during start is missed and the test
hangs to its timeout instead of failing fast. It has not flaked yet; the same shape already
exists in an N2 test in the same file. Nothing user-facing — this is the measurement the N5
budget rests on, and a latent flake in it costs a sprint's afternoon at the worst moment.

## Acceptance Criteria

- [ ] When a filter matches more history entries than the view fetched, the view says so — the
      user can see that they are looking at part of the result, not all of it
- [ ] A group total computed over a truncated result is visibly marked as partial, and that
      marker is not confusable with 006's existing "some entries had no usage" marker
- [ ] A total that *is* complete stays unmarked — the marker has to mean something
- [ ] Grouping, filtering and the marker still agree with each other after a filter change
- [ ] The N5 and N2 timing tests observe every event their measurement depends on, regardless of
      when it is emitted, and fail fast rather than timing out when the event never comes
- [ ] `npm test` stays green and the N5 measurement still reports a number against its 2000 ms
      budget

## Open Questions

- **Honest marker, or real paging?** The cheap answer is a marker plus a count ("showing 200 of
  438"). The complete answer is paging or a "load more" that lets the totals actually become
  complete. The second is a bigger story than S04's review implied — is it wanted here, or is the
  marker the deliverable and paging its own story later?
- **If a marker: is the page size still 200?** Raising it (or removing the cap when a filter is
  active) shrinks the problem without solving it, and costs read time the N5 budget pays for.
- **Where does the marker live?** On each group's total, on the view's header once, or both — and
  does it need its own symbol next to `~`, or a worded line rather than a symbol?
- **Does the CLI show the same qualification?** `npm run cli` reads the same core; a truncated
  total printed there is as wrong as one on screen.
