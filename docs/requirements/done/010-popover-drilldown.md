---
id: 010
title: Popover drill-down — branch, context, model, subagents
status: done # draft -> ready -> in-progress -> done
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
[SubagentTree.tsx](../../../src/renderer/components/SubagentTree.tsx) in the main window. The
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

Design of record for the layout: **[assets/010-popover-drilldown-prototype.html](../assets/010-popover-drilldown-prototype.html)**
— a standalone click dummy with fake data, built and refined with the user on 2026-08-21. It
carries a "Datenherkunft zeigen" toggle that outlines each field by provenance; everything
outlined blue is this story, everything orange is 011, everything red is not available at all.

Background: [concepts/reference-tool-comparison.md](../../concepts/reference-tool-comparison.md)
(the Irrlicht row layout this follows), and story
[002](002-popover-at-a-glance.md) (what it replaces).

## Acceptance Criteria

- [x] Group headers are collapsible; a collapsed group still states how many sessions it holds
      and what statuses they are in, so collapsing never hides that something needs you
- [x] The default state is groups expanded, sessions collapsed — the subagent count is visible
      without a click, the subagent detail is not
- [x] A session row shows, without a click: status, branch, context as an absolute token count
      with its band colour, model, uptime and age; and for a waiting session its reason across
      the full popover width
- [x] A session with subagents shows how many there are and how many have finished, in a form
      that is readable without counting
- [x] Expanding a session shows what it last said, plus one row per subagent with that
      subagent's own label, agent type, model, context and duration
- [x] A running subagent renders no context and no token figure at all — not a placeholder, not
      a zero — and says plainly that no interim state exists
- [x] A failed subagent shows its error text
- [x] `totalTokens` never appears on a row next to a context percentage without being labelled
      as cumulative spend — the two are different quantities and a bare pair of numbers reads
      as a contradiction (measured case: `184.3K tok` at `ctx 18%` in a 1M window)
- [x] The subagent list does not imply a hierarchy the data cannot support — `buildSubagentTree`
      sets `children: []` unconditionally, so a subagent that spawned its own is not
      recognisable as a parent, and the UI says so rather than looking flat by accident
- [x] ↑/↓ move between rows, →/← expand and collapse the focused node, Enter jumps to the
      focused session, Esc closes — story 003's existing key handling keeps working unchanged
- [x] Focus survives an expand or collapse: the node that was focused is still focused
      afterwards, never the document body
- [ ] The popover's self-measuring height (`report()`) stays correct across every expand and
      collapse, including when the content exceeds the window maximum — code-verified (review
      confirmed `report()` measures content, not shell, and the clamp/scroll chain is sound);
      not live-measured, see "## Done" (no live Electron run performed this build)
- [x] Nothing in `core/` changes

## Open Questions

- ~~**Height when expanded.** Default is 398 px, one open session with five subagents is 645 px,
  two open sessions are 770 px — against `POPOVER_MAX_HEIGHT = 560`
  ([windows.ts:19](../../../src/main/windows.ts#L19)). Three defensible answers: accept the scroll,
  raise the maximum, or make expansion an accordion (at most one session open at a time).
  Recommendation: **accordion** — it keeps the height predictable and matches the real
  intent ("I want to understand *this* session"), and it needs no main-process change.~~ answered
  → Decisions (Sprint)
- ~~**Does the expansion state survive?** The popover window is reused and hidden rather than
  destroyed ([popover.tsx](../../../src/renderer/popover.tsx) refocuses on `window.focus`), so a
  remembered expansion would still be open the next time the popover appears — which is either
  convenient or stale, depending on taste. Recommendation: **reset on hide**, because the
  glance surface should open in its glance state.~~ answered → Decisions (Sprint)
- ~~**What happens to the session title?** The branch takes over the row's identity, so
  `sessionLabel()` (`aiTitle`, else the last prompt) is no longer rendered anywhere in the
  popover. Recommendation: **put it on the expanded detail line**, next to the last-assistant
  text — it stays reachable without competing with the branch for row width.~~ answered →
  Decisions (Sprint)
- ~~**Does the group rollup use dots or counts?** The prototype uses coloured dots with a number
  (`●1 ●1`). Story [006](../006-activity-and-history-attribution.md) D1/D2 plans per-status counts
  on `ProjectGroup` for exactly this purpose, in both the popover and the main window. Either
  this story renders a local version and 006 later replaces it, or the rollup is deferred to
  006. Recommendation: **render it here from `group.sessions` directly** (no `ProjectGroup`
  change), and let 006 lift it into the aggregate when it lands.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Height when expanded: accept the scroll — do not raise `POPOVER_MAX_HEIGHT`, do not
  make expansion an accordion. Multiple sessions may be expanded at once; the popover scrolls
  past 560 px when they are.
- **(User)** Expansion state does not survive hide — resets to fully collapsed every time the
  popover reopens.
- **(User)** Session title moves to the expanded detail line, next to the last-assistant text.
- **(User)** Group rollup is rendered locally from `group.sessions` in this story; story 006
  lifts it into `ProjectGroup` later.

- The prototype's agent-icon cell is dropped and the trailing cell keeps story 004's mute toggle
  instead — the icon has no data source today (one agent type only), while dropping the mute
  toggle would remove a shipped feature; story 008 can re-add it with a second agent.
- Group headers stay suppressed when only one project is live (story 002's rule is not reversed) —
  with a single group there is nothing to distinguish, and the saved line protects the 398 px
  height budget the layout reversal was argued on.
- The token value reuses `formatTokens` (`49k`) instead of the prototype's `48.6K` — one token
  format across popover, subagent tree and gauge beats matching the click dummy exactly.
- `ContextBar` gets an additive `valueFormat` prop rather than repurposing `showValue`, so the
  shared component's existing `SessionsView` call site keeps its behaviour unchanged.
- The expansion reset hangs off `document.visibilitychange` (window hidden), not `blur` — a
  *pinned* popover that merely loses focus keeps what the user expanded, and no new
  main-process event is needed.
- Navigation becomes one flat list of `[data-nav-key]` nodes (group / session / subagent); Enter
  toggles a group, jumps a session and does nothing on a subagent, because a subagent has no
  window to focus.
- Subagent rows iterate `session.subagents` flat instead of recursing, since `buildSubagentTree`
  sets `children: []` unconditionally — recursion would be dead code contradicting D6's note.
- A *completed* subagent's message slot stays empty in this story (no placeholder) — story 011
  fills it, which keeps 011 a text-only change and 010 useful on its own.
- Renderer behaviour is covered by unit tests over pure helper modules, not by render tests —
  vitest runs without jsdom here and adding a DOM harness is not this story's job.
- The S03 note's carried-over group-sort/`seen` ranking item is *not* taken: the ranking is shared
  with the tray badge and the main window, so it is not the two-line fix that note allowed for.

## Plan

Renderer and shared only; `core/` stays untouched (checked with `git diff --stat src/core` before
the story closes). The surface becomes one flat, keyboard-navigable tree of three node kinds —
group head, session row, subagent row — each carrying a `data-nav-key`, rendered from
`state.traySessions` exactly as today. Structure follows the prototype 1:1.

1. **Row layout** (D1) — `popover.tsx` + `styles.css`: `.popover-row` becomes a two-line block
   (`.l1` grid `9px 13px 11px minmax(0,1fr) 108px 92px 22px`, `.l2` flex, indented 42 px).
   Line 1: chevron, status glyph, index within the group, branch, context, model, mute toggle.
   Line 2: status dot + status text — or, for `waiting`, `statusReason` across the full width —
   plus the subagent summary and `uptime · age`, right-aligned.
2. **Pure helpers** (D1, D3, D6) — new `src/renderer/lib/popoverModel.ts`: group rollup counts,
   subagent summary (`done/total` + pip classes) and the wording of the three absent-data cases.
   Unit-tested in `test/unit/popoverModel.test.ts` — there is no DOM harness (vitest, no jsdom),
   so every rule worth a test lives in this module instead of in JSX.
3. **Context cell** (D2) — `ContextBar` gets an additive `valueFormat` prop; the popover asks for
   `tokens`, `SessionsView` keeps the default `percent`.
4. **Expansion** (D3, D4) — one `useState<Set<string>>` of open keys (`g:<projectKey>`,
   `s:<sessionId>`, `a:<nodeId>`), initialised to every group key and reset when the window is
   hidden. An expanded session renders a detail block with `sessionLabel()` + `lastAssistantText`,
   then its subagent list.
5. **Subagent rows** (D5, D6) — the metric-part builder moves out of `SubagentTree.tsx` into a
   shared pure module that both surfaces consume, so the popover and the detail pane cannot
   describe the same run differently. `totalTokens`, `toolUses` and lines-touched go to tooltips.
6. **Keyboard** (D7) — the three `.popover-row` query sites in the existing handler switch to the
   node selector; the arrow keys open and close the focused node, Enter toggles a group, jumps a
   session and is a no-op on a subagent. After a re-render a layout effect refocuses the
   remembered key and scrolls it into view (`block: 'nearest'`).
7. **Height** (D8) — accept the scroll per the Sprint decision: `resizePopover` already clamps to
   `POPOVER_MAX_HEIGHT` ([windows.ts:160-171](../../../src/main/windows.ts#L160-L171)) and
   `.popover-list` already scrolls, so no main-process change. Verify `report()` across
   expand/collapse cycles and record the measured heights in `## Done`.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8 (D7 needs every node kind to exist first).

**AC coverage:** collapsible groups → D3 · default state → D3 + D4 · row facts → D1 + D2 ·
subagent count → D1 · expand shows last-said + subagent rows → D4 + D5 · running subagent → D6 ·
failed subagent → D6 · `totalTokens` labelling → D5 · no false hierarchy → D6 ·
arrows/Enter/Esc → D7 · focus survives expand/collapse → D7 · `report()` → D8 ·
`core/` unchanged → all Ds, verified in D8.

## Deliverables

- [x] D1 — **Two-line session row.** Replace the 8-column grid in
      [popover.tsx](../../../src/renderer/popover.tsx) and
      [styles.css](../../../src/renderer/styles.css) with the prototype's two-line row: line 1 =
      chevron (inert here, wired in D4), status glyph, index within the group, branch, context,
      model, mute toggle; line 2 = status dot, status text (or the waiting reason across the full
      width), subagent summary, `uptime · age`. Width stays at `POPOVER_WIDTH = 620`; story 004's
      mute toggle and the row's jump-on-click keep working. The subagent summary (`2/3` plus pips
      and tooltip) comes from a new pure helper in `src/renderer/lib/popoverModel.ts` with unit
      tests in `test/unit/popoverModel.test.ts`. Mirror for markup and CSS idiom: the prototype's
      `.srow` / `.l1` / `.l2` rules.
- [x] D2 — **Absolute token count in the context cell.**
      [ContextBar.tsx](../../../src/renderer/components/ContextBar.tsx) gets an additive
      `valueFormat?: 'percent' | 'tokens'` (default `'percent'`); `tokens` renders
      `formatTokens(context.used)` in `.ctx-value` while the percentage stays in the tooltip.
      The popover passes `valueFormat="tokens"`;
      [SessionsView.tsx:162](../../../src/renderer/components/SessionsView.tsx#L162) is untouched and
      must keep its current appearance.
- [x] D3 — **Collapsible group headers.** The group head becomes a focusable node with a chevron,
      the project name, the `attention` count when > 0, a status rollup (coloured dot + count per
      status, zero-counts omitted, colours from `STATUS_COLOR_VAR`) and the session count;
      collapsing hides its sessions but never the rollup. Rollup counts come from a pure helper in
      `popoverModel.ts` (unit-tested), computed from `group.sessions` — story 006 D1/D2 later
      lifts it onto `ProjectGroup`. Files: `popover.tsx`, `styles.css`, `popoverModel.ts`,
      `test/unit/popoverModel.test.ts`.
- [x] D4 — **Expandable session rows.** Expansion state is a renderer-only `Set` of node keys,
      default = all group keys (sessions collapsed), reset when the popover window is hidden.
      Expanding a session renders the detail block: `sessionLabel(session)` plus
      `lastAssistantText` (and a plain line when there is none), then the subagent area — "no
      subagents" when the list is empty. Files: `popover.tsx`, `styles.css`.
- [x] D5 — **Subagent rows.** Per node: status dot in the `SubagentStatus` colour, label,
      `agentType` pill, `metrics.model`, a frozen context chip from `metrics.context`, duration.
      Lift the metric-part builder out of
      [SubagentTree.tsx:78-125](../../../src/renderer/components/SubagentTree.tsx#L78-L125) into a
      shared pure module (`src/renderer/lib/subagentParts.ts`) that both surfaces render from, so
      wording and tooltips cannot drift; `totalTokens`, `toolUses` and lines-touched appear only
      in the tooltip, labelled as cumulative spend. Files: `popover.tsx`, `styles.css`,
      `subagentParts.ts`, `SubagentTree.tsx`, `test/unit/popoverModel.test.ts`.
- [x] D6 — **The three absent-data cases**, each rendered as itself: running/launched (no metrics
      — duration only, plus a plain "no interim state available" statement, never a `0` and never
      a placeholder bar), failed (`errorText`, band-red), and the flat-list note covering
      `children: []`. Case selection and wording live in `popoverModel.ts` and are unit-tested —
      that is the standing coverage for the failure case, which cannot be provoked on demand.
      Files: `popoverModel.ts`, `popover.tsx`, `styles.css`, `test/unit/popoverModel.test.ts`.
- [x] D7 — **Keyboard: expand/collapse with the arrow keys** on top of story 003's
      up/down/Enter/Esc handling in `popover.tsx`: the three `.popover-row` query sites move to
      the node selector so groups, sessions and subagents are all reachable; Enter toggles a
      group, jumps a session, is a no-op on a subagent; a layout effect refocuses the remembered
      `data-nav-key` after every re-render and calls `scrollIntoView({ block: 'nearest' })`.
      `NotifySwitch`'s capture-phase Escape and the `defaultPrevented` guard stay untouched.
      File: `popover.tsx`.
- [x] D8 — **Height: accept the scroll** (Sprint decision — `POPOVER_MAX_HEIGHT` is not raised and
      expansion is not an accordion; several sessions may be open at once). No main-process
      change: confirm `resizePopover`'s clamp and `.popover-list`'s `overflow-y: auto` carry the
      overflow, that `report()` stays correct across expand/collapse cycles (no shrink on reopen,
      no gap under the footer, no clipped content), and record the measured heights (default /
      one session with subagents / two open sessions) plus a `git diff --stat src/core` showing
      zero changes in `## Done`.

## Model Hints

- D1 → `deliverable-hard` — it replaces the row layout that story 002 built and argued for, and
  a mistake here is a regression on the surface that gets looked at fifty times a day.
- D7 → `deliverable-hard` — it extends key handling that story 003 built and that has not had
  its live acceptance yet; the capture-phase ordering between `NotifySwitch`'s Escape handler
  and the popover's own document listener is already subtle
  ([popover.tsx:108-117](../../../src/renderer/popover.tsx#L108-L117)), and focus restoration
  across a re-render is exactly where "the popover swallowed my arrow key" bugs live.
- D2 → default tier, but note the blast radius: `ContextBar` is shared with `SessionsView`.
- D3–D6, D8 → default tier.
- Review: → `story-review-hard` — thirteen acceptance criteria, a deliberate reversal of a
  previous story's decision, and a shared component (`ContextBar`) touched on behalf of one
  caller.

## Test Plan (manual acceptance)

Run `npm run dev` (unset `ELECTRON_RUN_AS_NODE` when launching from VS Code) and open the tray
popover. Keep
[assets/010-popover-drilldown-prototype.html](../assets/010-popover-drilldown-prototype.html) open
in a browser next to it for comparison.

1. **Glance:** with two or more projects live, confirm the default state — groups expanded,
   sessions collapsed. Each row reads branch, absolute tokens, model; sessions running longer
   than an hour show their uptime. No subagent detail is visible, but a session that has
   subagents states how many exist and how many are done.
2. **Groups:** collapse a group. Its sessions disappear, its status rollup and session count stay
   readable, and a waiting session inside it is still announced. Expand it again. With only one
   project live there is no group header at all (unchanged from story 002).
3. **Waiting:** trigger a permission prompt. The reason must be readable across the full
   popover width, not ellipsized after four words, and the popover must not get wider.
4. **Drill down:** start a session that spawns two or more subagents on different models (a
   `/workflows` run or any `Agent` call with an explicit `model` does it). Expand the session:
   the session title and its last message appear, then one row per subagent. Each finished
   subagent shows its own model and its own `ctx …%`; a *running* one shows neither and says so.
   Confirm against the main window's detail pane that the popover and `SubagentTree` report the
   same numbers for the same run.
5. **Failure case:** if a subagent fails, its error text is on the row. (Not reproducible on
   demand — check it opportunistically; the unit test is the standing coverage.)
6. **Keyboard only:** open the popover via the global shortcut from story 003. Navigate up and
   down across groups, sessions and subagents, expand and collapse with the right/left arrows,
   jump with Enter, close with Esc. After every expand and collapse the focus ring must still be
   on the node you were on, and the focused node must be scrolled into view.
7. **Height (accept the scroll):** expand two sessions with subagents. The window grows to at
   most 560 px and then scrolls — content is never clipped, there is no gap below the footer, and
   reopening the popover neither shrinks it nor keeps the previous expansion (it comes back fully
   collapsed with the groups open).

## Done

**Summary.** All 8 deliverables implemented. The popover row is now a two-line block (branch/context/model/mute
on line 1, status/waiting-reason/subagent-summary/uptime·age on line 2), `ContextBar` gained an additive
`valueFormat` prop so the popover shows absolute tokens while `SessionsView` keeps percent, group headers are
collapsible with a local status rollup, sessions expand into a detail block (title + last message + flat
subagent list), subagent rows share a lifted `buildMetricParts` module with `SubagentTree.tsx` so wording can't
drift, the three absent-data cases (running/launched with no metrics, failed with error text, flat-hierarchy
note) are centralised in pure helpers in `popoverModel.ts`, and keyboard navigation now spans all three node
kinds (`[data-nav-key]`) with arrow-key expand/collapse and focus restoration across re-renders.

**Decisions (implementation-time, beyond the pre-recorded Sprint decisions):**
- `focusTopRow()` narrows to `[data-nav-key^="s:"]` (session rows only), not the general nav selector — a
  first-pass D7 implementation focused the first node of any kind (group heads render before their sessions),
  which silently regressed story 003's "opening the popover focuses the most urgent row". Caught and fixed in
  the review-fix cycle; verified sessions are still the most-urgent-first in DOM order via `STATUS_SORT_RANK` +
  `compareSessions`.
- `collapsedGroups` (D3) resets on `document.visibilitychange` in the same effect as `openNodes` (D4), so a
  group the user collapsed also reverts to expanded on the next popover open, matching "comes back fully
  collapsed with the groups open" (sessions collapsed, groups expanded) rather than only resetting session
  expansion.
- `SUBAGENT_STATUS_COLOR_VAR` was added to `src/shared/presentation.ts` (alongside the existing
  `STATUS_COLOR_VAR`/`BAND_COLOR_VAR` tables) rather than as a popover-local constant, since it is the missing
  counterpart to an established pattern other surfaces can reuse.
- `StatusDot` gained an additive `size?: 'sm'` prop (D1) for the smaller line-2 dot; no existing call site
  passes `size`, so default rendering is unchanged.
- Cumulative `totalTokens`/`toolUses`/lines-touched for a subagent live only in the duration cell's tooltip on
  the popover row (never printed bare next to `ctx %`, per the acceptance criterion) — accepted as a
  discoverability trade-off flagged by review as low-priority; not fixed, since surfacing them elsewhere in the
  narrow row was exactly what the criterion argued against.
- `.popover-subagents` got `role="list"` to pair with the existing `role="listitem"` on subagent rows; the
  sibling flat-hierarchy note under the same list is not itself a listitem — a minor, pre-existing ARIA nit
  noted by review as non-blocking and left as is.

**Verification.**
- `npm run build` (includes `tsc` typecheck for node + web) — green.
- `npm run typecheck` — green.
- `npm test` — 249/249 tests passed across 13 files (12 pre-existing + `test/unit/popoverModel.test.ts` and
  `test/unit/subagentParts.test.ts`, both new).
- `git diff --stat src/core` — empty; `## Acceptance Criteria`'s "nothing in `core/` changes" holds.
- Code review (`story-review-hard`, per Model Hints): first pass **FAIL** — found the `focusTopRow` regression,
  the missing `collapsedGroups` reset, a `role="listitem"`/`role="list"` mismatch, and a duplicate type import.
  All four fixed in one review-fix cycle; the review's own re-verification pass returned **PASS**, confirming
  each fix and re-scanning the acceptance criteria for side effects (none found). One `UNCLEAR`/low-priority
  item was raised in the confirmation pass and left open: a `launched` subagent whose async-launch result ever
  carried a stray model/token number (not reachable with today's `async_launched` payload, which only carries
  status/agentId) would show metric chips without the "no interim state" line — orthogonal to this story's
  fixes, not evidenced as reachable, not fixed.
- Height (D8), static estimates from source/CSS reading (no live Electron run performed by the build agents):
  default (groups expanded, sessions collapsed) ≈ 398 px (the story's own recorded measurement, consistent with
  the current CSS); one session open with ~5 subagents ≈ 645 px; two sessions open ≈ 770 px — both above the
  560 px `POPOVER_MAX_HEIGHT` ceiling, where `.popover-list`'s `overflow-y: auto` takes over. No main-process
  change was needed or made; `resizePopover`/`applyPopoverBounds` already clamp correctly.
- **Live smoke: not performed.** This build ran headless, autonomous, with no access to a live Electron
  environment or the user — `live-smoke-required: true` and `ui-acceptance-required: true` in
  `.claude/ai-scrum.md` call for driving the actual popover through `npm run dev` and observing it, which no
  agent in this run was able to do (no browser automation for the Electron tray UI, per the profile's own
  `live-smoke-how`). Build, typecheck, tests and code review are all green; the manual acceptance in
  `## Test Plan (manual acceptance)` (steps 1-7) is unperformed and is handed to the user.

**Commit message (prepared, not run):** `010: popover drill-down — two-line rows, collapsible groups, subagent detail`
