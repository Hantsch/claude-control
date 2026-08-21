---
id: 011
title: Subagent detail — final message and declared model
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-21
---

## Requirement

Two facts about a subagent that the drill-down of story
[010](010-popover-drilldown.md) wants and cannot have, because the adapter does not extract
them. Both are in the parent transcript; neither needs a new data source.

**A — what the subagent actually reported.** The `Agent` tool result carries the run's full
`prompt` and `content`; `subagentRunResultOf` deliberately takes only the numbers from it
([types.ts:100-102](../../src/core/model/types.ts#L100-L102): *"Neither is read here; only these
numbers are"*). So a finished subagent can be shown as `general-purpose · Sonnet 5 · ctx 16% ·
4m 12s` and not a word about what it found. That is the least useful part of the whole run.

This is a choice, not a constraint: CONCEPT [§4](../CONCEPT.md) already permits it — *"Prompt and
response text is read (it is needed for titles and the timeline) but never leaves the process"* —
and the app already reads and displays `lastAssistantText` for exactly this purpose, in the
`done` toast body. The subagent's final message is the same class of data from a nested run.

The **hard** limit sits next to it and must not be confused with this one: a *running* subagent
has no message at all. `isSidechain` was `true` on zero records across ~55 000
([RESEARCH.md §2](../RESEARCH.md)), so its inner transcript is not interleaved into the parent
file and nothing about its progress is observable. Only the result brings text, and only when
the run is over.

**B — which model a running subagent is on.** `metrics` is populated from the result
([subagents.ts:57](../../src/core/state/subagents.ts#L57)), so `metrics.model` — the exact
`resolvedModel`, `[1m]` suffix included — exists only once the run has finished. While it runs,
the popover has nothing to show. Two sources would fix that, with different accuracy:

- The `Agent` call can set a model explicitly, and `agentTypeOf` reads `subagent_type` out of
  that same input object while ignoring a `model` key sitting next to it
  ([records.ts:216-219](../../src/core/adapters/claude/records.ts#L216-L219)). Where it is set,
  it is exact.
- Where it is not set, the subagent inherits the session's model — derivable from the parent,
  correct in the common case, wrong for a run whose model was chosen deliberately.

The second case must not look like the first. The app already has the pattern for this
distinction: `statusSource: 'reported' | 'inferred'` from story
[001](done/001-registry-status-field.md). The prototype renders the inherited case with a `≈`
marker for the same reason.

Both parts are optional refinements of 010, which is complete without them — this story exists
separately because it crosses into `core/adapters/`, which 010 deliberately does not touch.

Design of record: [assets/010-popover-drilldown-prototype.html](assets/010-popover-drilldown-prototype.html)
— everything its "Datenherkunft" overlay outlines **orange** is this story.

## Acceptance Criteria

- [ ] A finished subagent's final message is available on `SubagentNode` and rendered in the
      popover drill-down and the main window's subagent tree
- [ ] The text is clipped to a single line's worth at the adapter boundary, not in the renderer —
      an `Agent` result can carry a very long report, and the tail reader's budget (CONCEPT §5.2)
      is not the place to discover that
- [ ] A running or `launched` subagent shows no message and states that no interim state exists;
      it never shows an empty string, a stale message from a previous run, or the parent's text
- [ ] A failed run keeps showing `errorText` — the existing behaviour is not displaced by the
      new field
- [ ] The privacy line holds and is verifiable: the subagent's `prompt` is still not read, the
      text never leaves the process, and nothing new is written to disk or logged
- [ ] A model declared in the `Agent` call is extracted and shown for a subagent that is still
      running
- [ ] A subagent with no declared model shows the session's model, marked as derived rather than
      reported — a reader can tell the two apart without a tooltip
- [ ] Once the run finishes, `resolvedModel` wins over both, since it is what actually ran
- [ ] Reading stays inside the CONCEPT §10 N5 budget — **measured**, since this reads more text
      per file than before
- [ ] The adapter stays agent-neutral: nothing about this leaks out of
      `core/adapters/claude/` into `core/state/` beyond the new typed fields

## Open Questions

- **Is the final message wanted at all in the popover?** It is the one item in this story that
  adds *text* to a surface whose whole point is being scannable. The main window's subagent tree
  is the other candidate home for it, and there it costs nothing. Deciding this decides how much
  of the story is worth building.
- **Clip length.** `toolInputHint` clips to 120 characters
  ([records.ts:209-210](../../src/core/adapters/claude/records.ts#L209-L210)) and
  `lastAssistantText` has its own rule for the toast body. A third convention would be one too
  many — reuse one of them or state why neither fits.
- **Is the inherited-model derivation worth it?** A `≈`-marked value that is right most of the
  time is more useful than an empty cell, but it is also the first *inferred* number this app
  would show without the user having asked for it. The alternative is honest and cheap: show a
  model only when it is known, leave the cell empty while the run is anonymous.
- **Does the session's own model change mid-run?** `/model` switching is routine and the
  transcript records the model per turn, so "the session's model" at the moment a subagent
  started is not necessarily the one it reports now. If the derivation is kept, it has to name
  which of the two it means.

## Plan

<!-- filled by /refine -->

## Deliverables

- [ ] D1 — **Final message on `SubagentRunResult`.** Extract and clip the result's `content` in
      `subagentRunResultOf` ([summarize.ts:217-218](../../src/core/adapters/claude/summarize.ts#L217-L218)),
      carry it onto `SubagentNode` through `toNode`/`toMetrics`
      ([subagents.ts](../../src/core/state/subagents.ts)), and update the field comments in
      [types.ts](../../src/core/model/types.ts) that currently promise the text is not read.
      Unit tests over a normal result, a very long one, an object-shaped result with no text,
      and the plain-string error case.
- [ ] D2 — **Render it** in [SubagentTree.tsx](../../src/renderer/components/SubagentTree.tsx)
      and, subject to the first open question, in the popover drill-down from story 010.
- [ ] D3 — **Declared model.** Read `model` from the `Agent` tool input alongside
      `agentTypeOf` ([records.ts:216](../../src/core/adapters/claude/records.ts#L216)), carry it
      as a separate field from `metrics.model`, and resolve the precedence
      `resolvedModel` → declared → inherited on `SubagentNode` with its source recorded
      (mirroring `statusSource`).
- [ ] D4 — **Render the model and its provenance** for running subagents, derived case visibly
      marked.
- [ ] D5 — **Measure the reading cost** against the N5 budget with the new text extraction in
      place, and record the number — not an assurance that it is fine.

## Model Hints

- D1 → `deliverable-hard` — it reverses a documented privacy-adjacent decision in the adapter,
  and the result shape has two forms (object and plain error string) that must not be confused.
- D3 → `deliverable-hard` — a three-source precedence with a provenance marker is exactly the
  kind of thing that ends up silently showing the wrong model.
- D2, D4, D5 → default tier.
- Review: → `story-review-hard` — this story touches `core/adapters/` and the privacy statement
  in CONCEPT §4 and the README; a reviewer has to check the claim, not just the diff.

## Test Plan (manual acceptance)

<!-- filled by /refine, once the first open question is answered -->

## Done

<!-- filled by /build -->
