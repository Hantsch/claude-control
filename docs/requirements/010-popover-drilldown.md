---
id: 010
title: Popover drill-down — branch, context, model, subagents
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-21
---

## Requirement

Story 002 put the missing facts onto the popover row and settled on a single-line, eight-column
grid. Used against real session data, that grid is over-subscribed: every flexible cell
ellipsizes to the point of uselessness — `Bash — „npm r…`, `Hantsch-MMO…`, `working · E…` — and
the cell hit hardest is the waiting reason, which is the one piece of text that explains why you
would click the row at all. The information is on the surface; it is not readable.

The second gap is subagents. A session can be running five of them across three models, and the
popover says the word `· subagent`. Everything else — each subagent's label, agent type, model,
its context at the end of the run, its duration, and the error text when it died — is already in
`SessionView.subagents` and is already rendered by
[SubagentTree.tsx](../../src/renderer/components/SubagentTree.tsx) in the main window. The
glance surface has none of it.

What a glance should deliver, and what it should take a click to get:

- **Without a click:** which project, which branch, how full the context is in absolute tokens,
  which model, how many subagents exist and how many are done, and — for a blocked session —
  the full waiting reason.
- **On one click:** what the session last said, and one line per subagent with its own model and
  its own context.

This deliberately reverses 002's Sprint Decision *"Row grid grows to 8 columns instead of a
second row line — a second line per row would double popover height"*. The measurement behind
the reversal: the two-line layout gives the waiting reason the full popover width, and the
default state (groups expanded, sessions collapsed) measures **398 px** against a 560 px window
maximum — no taller than today's single-line layout with group headers.

Renderer and shared only. No engine work, no adapter change: every value rendered here already
exists in `SessionView`. The two facts that would need adapter work — a finished subagent's
final message, and a *running* subagent's model — are story 011, and this story is designed to
be complete and useful without them.

Design of record for the layout: **[assets/010-popover-drilldown-prototype.html](assets/010-popover-drilldown-prototype.html)**
— a standalone click dummy with fake data, built and refined with the user on 2026-08-21. It
carries a "Datenherkunft zeigen" toggle that outlines each field by provenance; everything
outlined blue is this story, everything orange is 011, everything red is not available at all.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md)
(the Irrlicht row layout this follows), and story
[002](done/002-popover-at-a-glance.md) (what it replaces).

## Acceptance Criteria

- [ ] Group headers are collapsible; a collapsed group still states how many sessions it holds
      and what statuses they are in, so collapsing never hides that something needs you
- [ ] The default state is groups expanded, sessions collapsed — the subagent count is visible
      without a click, the subagent detail is not
- [ ] A session row shows, without a click: status, branch, context as an absolute token count
      with its band colour, model, uptime and age; and for a waiting session its reason across
      the full popover width
- [ ] A session with subagents shows how many there are and how many have finished, in a form
      that is readable without counting
- [ ] Expanding a session shows what it last said, plus one row per subagent with that
      subagent's own label, agent type, model, context and duration
- [ ] A running subagent renders no context and no token figure at all — not a placeholder, not
      a zero — and says plainly that no interim state exists
- [ ] A failed subagent shows its error text
- [ ] `totalTokens` never appears on a row next to a context percentage without being labelled
      as cumulative spend — the two are different quantities and a bare pair of numbers reads
      as a contradiction (measured case: `184.3K tok` at `ctx 18%` in a 1M window)
- [ ] The subagent list does not imply a hierarchy the data cannot support — `buildSubagentTree`
      sets `children: []` unconditionally, so a subagent that spawned its own is not
      recognisable as a parent, and the UI says so rather than looking flat by accident
- [ ] ↑/↓ move between rows, →/← expand and collapse the focused node, Enter jumps to the
      focused session, Esc closes — story 003's existing key handling keeps working unchanged
- [ ] Focus survives an expand or collapse: the node that was focused is still focused
      afterwards, never the document body
- [ ] The popover's self-measuring height (`report()`) stays correct across every expand and
      collapse, including when the content exceeds the window maximum
- [ ] Nothing in `core/` changes

## Open Questions

- **Height when expanded.** Default is 398 px, one open session with five subagents is 645 px,
  two open sessions are 770 px — against `POPOVER_MAX_HEIGHT = 560`
  ([windows.ts:19](../../src/main/windows.ts#L19)). Three defensible answers: accept the scroll,
  raise the maximum, or make expansion an accordion (at most one session open at a time).
  Recommendation: **accordion** — it keeps the height predictable and matches the real
  intent ("I want to understand *this* session"), and it needs no main-process change.
- **Does the expansion state survive?** The popover window is reused and hidden rather than
  destroyed ([popover.tsx](../../src/renderer/popover.tsx) refocuses on `window.focus`), so a
  remembered expansion would still be open the next time the popover appears — which is either
  convenient or stale, depending on taste. Recommendation: **reset on hide**, because the
  glance surface should open in its glance state.
- **What happens to the session title?** The branch takes over the row's identity, so
  `sessionLabel()` (`aiTitle`, else the last prompt) is no longer rendered anywhere in the
  popover. Recommendation: **put it on the expanded detail line**, next to the last-assistant
  text — it stays reachable without competing with the branch for row width.
- **Does the group rollup use dots or counts?** The prototype uses coloured dots with a number
  (`●1 ●1`). Story [006](006-activity-and-history-attribution.md) D1/D2 plans per-status counts
  on `ProjectGroup` for exactly this purpose, in both the popover and the main window. Either
  this story renders a local version and 006 later replaces it, or the rollup is deferred to
  006. Recommendation: **render it here from `group.sessions` directly** (no `ProjectGroup`
  change), and let 006 lift it into the aggregate when it lands.

## Plan

<!-- filled by /refine -->

## Deliverables

- [ ] D1 — **Two-line session row.** Replace the 8-column grid in
      [popover.tsx](../../src/renderer/popover.tsx) and
      [styles.css](../../src/renderer/styles.css) with the prototype's two-line row: line 1 =
      chevron, status glyph, index within group, branch, context, model, agent icon; line 2 =
      status dot, status text (or the waiting reason across the full width), subagent summary,
      uptime · age. Width stays at the current `POPOVER_WIDTH = 620`.
- [ ] D2 — **Absolute token count in the context cell.** `ContextBar` already has an unused
      `showValue` prop ([ContextBar.tsx:17](../../src/renderer/components/ContextBar.tsx#L17));
      extend it to render `formatTokens(used)` instead of the percentage for the popover, with
      the percentage staying in the tooltip. `SessionsView.tsx:139` is the only other call site
      and must keep its current appearance.
- [ ] D3 — **Collapsible group headers** with a status rollup and the session count, collapsed
      state included in `report()`'s measurement.
- [ ] D4 — **Expandable session rows**, default collapsed, rendering `lastAssistantText` and the
      subagent list on expand. Expansion state lives in the renderer only.
- [ ] D5 — **Subagent rows.** Per node: status dot in the `SubagentStatus` colour, label,
      `agentType` pill, `metrics.model`, a frozen context chip from `metrics.context`, duration.
      Reuse the label wording and tooltips of
      [SubagentTree.tsx:78-125](../../src/renderer/components/SubagentTree.tsx#L78-L125) so the
      popover and the detail pane cannot describe the same run differently. `totalTokens`,
      `toolUses` and lines-touched move into the tooltip.
- [ ] D6 — **The three absent-data cases**, each rendered as itself: running/launched (no
      metrics — duration only, plus a plain statement that no interim state exists), failed
      (`errorText`), and the flat-list note covering `children: []`.
- [ ] D7 — **Keyboard: →/← expand and collapse** on top of story 003's existing ↑/↓/Enter/Esc
      handling, plus focus restoration after a re-render so the focused node stays focused.
- [ ] D8 — **Height behaviour** per the resolved open question (accordion, raised maximum or
      accepted scroll), with `report()` verified across expand/collapse cycles.

## Model Hints

- D1 → `deliverable-hard` — it replaces the row layout that story 002 built and argued for, and
  a mistake here is a regression on the surface that gets looked at fifty times a day.
- D7 → `deliverable-hard` — it extends key handling that story 003 built and that has not had
  its live acceptance yet; the capture-phase ordering between `NotifySwitch`'s Escape handler
  and the popover's own document listener is already subtle
  ([popover.tsx:108-117](../../src/renderer/popover.tsx#L108-L117)), and focus restoration
  across a re-render is exactly where "the popover swallowed my arrow key" bugs live.
- D2 → default tier, but note the blast radius: `ContextBar` is shared with `SessionsView`.
- D3–D6, D8 → default tier.
- Review: → `story-review-hard` — thirteen acceptance criteria, a deliberate reversal of a
  previous story's decision, and a shared component (`ContextBar`) touched on behalf of one
  caller.

## Test Plan (manual acceptance)

Run `npm run dev` (unset `ELECTRON_RUN_AS_NODE` when launching from VS Code) and open the tray
popover. Keep
[assets/010-popover-drilldown-prototype.html](assets/010-popover-drilldown-prototype.html) open
in a browser next to it for comparison.

1. **Glance:** with two or more projects live, confirm the default state — groups expanded,
   sessions collapsed. Each row reads branch, absolute tokens, model; sessions running longer
   than an hour show their uptime. No subagent detail is visible, but a session that has
   subagents states how many.
2. **Waiting:** trigger a permission prompt. The reason must be readable across the full
   popover width, not ellipsized after four words, and the popover must not get wider.
3. **Drill down:** start a session that spawns two or more subagents on different models (a
   `/workflows` run or any `Agent` call with an explicit `model` does it). Expand the session.
   Each finished subagent shows its own model and its own `ctx …%`; a *running* one shows
   neither, and says so. Confirm against the main window's detail pane that the popover and
   `SubagentTree` report the same numbers for the same run.
4. **Failure case:** if a subagent fails, its error text is on the row. (Not reproducible on
   demand — check it opportunistically, or accept the unit test as coverage.)
5. **Keyboard only:** open the popover via the global shortcut from story 003. Navigate with
   ↑/↓, expand with →, collapse with ←, jump with Enter, close with Esc. After every expand and
   collapse the focus ring must still be on the node you were on.
6. **Height:** expand the session with the most subagents. The window must resize to fit or
   scroll cleanly per the resolved open question — never clip content, never leave a gap below
   the footer, and never shrink a little on each reopen.

## Done

<!-- filled by /build -->
