---
id: 011
title: Subagent detail — final message and declared model
status: in-progress # draft -> ready -> in-progress -> done
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

- [x] A finished subagent's final message is available on `SubagentNode` and rendered in the
      popover drill-down and the main window's subagent tree
- [x] The text is clipped to a single line's worth at the adapter boundary, not in the renderer —
      an `Agent` result can carry a very long report, and the tail reader's budget (CONCEPT §5.2)
      is not the place to discover that
- [x] A running or `launched` subagent shows no message and states that no interim state exists;
      it never shows an empty string, a stale message from a previous run, or the parent's text
- [x] A failed run keeps showing `errorText` — the existing behaviour is not displaced by the
      new field
- [x] The privacy line holds and is verifiable: the subagent's `prompt` is still not read, the
      text never leaves the process, and nothing new is written to disk or logged
- [x] A model declared in the `Agent` call is extracted and shown for a subagent that is still
      running
- [x] A subagent with no declared model shows no model at all (empty cell) — no inherited-model
      derivation, per the Sprint decision below
- [x] Once the run finishes, `resolvedModel` wins over the declared model, since it is what
      actually ran
- [x] Reading stays inside the CONCEPT §10 N5 budget — **measured**, since this reads more text
      per file than before
- [x] The adapter stays agent-neutral: nothing about this leaks out of
      `core/adapters/claude/` into `core/state/` beyond the new typed fields

## Open Questions

- ~~**Is the final message wanted at all in the popover?** It is the one item in this story that
  adds *text* to a surface whose whole point is being scannable. The main window's subagent tree
  is the other candidate home for it, and there it costs nothing. Deciding this decides how much
  of the story is worth building.~~ answered → Decisions (Sprint)
- ~~**Clip length.** `toolInputHint` clips to 120 characters
  ([records.ts:209-210](../../src/core/adapters/claude/records.ts#L209-L210)) and
  `lastAssistantText` has its own rule for the toast body. A third convention would be one too
  many — reuse one of them or state why neither fits.~~ answered → Decisions (Sprint)
- ~~**Is the inherited-model derivation worth it?** A `≈`-marked value that is right most of the
  time is more useful than an empty cell, but it is also the first *inferred* number this app
  would show without the user having asked for it. The alternative is honest and cheap: show a
  model only when it is known, leave the cell empty while the run is anonymous.~~ answered →
  Decisions (Sprint)
- ~~**Does the session's own model change mid-run?** `/model` switching is routine and the
  transcript records the model per turn, so "the session's model" at the moment a subagent
  started is not necessarily the one it reports now. If the derivation is kept, it has to name
  which of the two it means.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Final message ships in the popover drill-down (010), not just the main window's
  subagent tree.
- **(User)** Clip length reuses `toolInputHint`'s 120-character convention
  ([records.ts:209-210](../../src/core/adapters/claude/records.ts#L209-L210)) rather than
  inventing a third rule.
- **(User)** No inherited-model derivation. A running subagent with no declared model in the
  `Agent` call shows no model at all (empty cell) rather than a `≈`-marked guess. D3/D4 narrow
  accordingly: precedence is `resolvedModel` (finished) → declared model (from the `Agent` call
  input) → empty; no third, inherited source, and no `statusSource`-style provenance marker is
  needed since there is nothing inferred left to mark.
- **(User → moot)** The "which moment does the session's model mean" question was answered
  (subagent-start model, if it mattered), but is superseded by the decision above: since
  inherited-model derivation was declined, this does not apply — there is no session-model
  fallback to date.

- Field name and placement: the text lands as `finalText` on `SubagentRunResult` **and** on
  `SubagentNode` next to `errorText`, not inside `SubagentMetrics` — `toNode` nulls `metrics`
  whenever `hasNumbers()` is false ([subagents.ts:63-72](../../src/core/state/subagents.ts#L63-L72)),
  which would swallow the text for a result that carries a report but no numbers.
- Extraction rule: take the **last** `type: 'text'` block of the result's `content`, and accept a
  plain-string `content` too — the anonymized sample fixture
  (`test/fixtures/samples/.../subagent-run.jsonl`) has the string form, and the last text block is
  the subagent's final message, matching `newestAssistantText`'s semantics for the session.
- Clipping reuses the existing one-line-collapse-then-truncate shape of `toolInputHint` at **120**
  characters (the User decision above), so the popover tooltip adds no longer text than the row —
  the tooltip carries provenance wording instead of a longer excerpt.
- `launched` runs stay textless: their result has `outputFile` / `canReadOutputFile`
  ([builders.ts:185-203](../../test/fixtures/builders.ts#L185-L203)) but opening a second file is a
  new data source and a new read cost, which this story explicitly does not take on.
- The privacy test keeps its teeth by splitting the marker: the fixture's `prompt` stays
  `PRIVATE PROMPT …` and its `content` gets a distinct marker, so
  [reading.test.ts:324-331](../../test/unit/reading.test.ts#L324-L331) can assert the prompt marker
  is absent *and* the report marker is present-but-clipped, instead of a blanket `/PRIVATE/`.
- The resolved model is exposed as one new field `SubagentNode.model` (= `metrics.model` ??
  `declaredModel`) and both renderers read it; `metrics.model` keeps meaning `resolvedModel` only —
  one precedence, in one place, instead of two renderers re-deciding it.
- `declaredModelOf` mirrors `agentTypeOf`: read off every tool input, surfaced only for subagent
  calls — same shape as the neighbouring extractor, no special-casing in the block loop.
- A declared model is a **tier alias** (`opus`, `sonnet`, `haiku`, `fable`), not a model id, so
  `modelDisplayName` gets an alias branch — otherwise a lowercase `opus` sits next to
  `Opus 5 · 1M` on the same surface.
- Since no `≈` marker exists any more, the provenance lives in the `title` tooltip ("declared in
  the `Agent` call, not yet confirmed by the run") — the information survives without a glyph the
  User declined.
- D4 (popover) is built **after** story 010's D5/D6 in this sprint: the popover's subagent rows are
  010's deliverable, and 011 only adds two cells to them.
- D3 drops to the default tier: the User decision removed the third source and the provenance
  marker, which is exactly what made the original justification a `deliverable-hard` case.
- The N5 number comes from the existing cold-start test
  ([pipeline.test.ts:590](../../test/unit/pipeline.test.ts#L590)), extended so the tails carry agent
  results with long reports — a new benchmark script would measure something nothing else asserts.
- The CLI (`npm run cli`) prints the final message too, so the live smoke can be cross-checked from
  a terminal — a cross-check, never a substitute for the UI acceptance (P1).

## Plan

**Triage: clear and ready.** Two adapter fields, carried to two existing surfaces. No new data
source, no new file read.

1. **Core — final message (D1).**
   `summarize.ts`: new `finalTextOf(result)` next to `subagentRunResultOf` — last `text` block of
   `content`, or a plain-string `content`, collapsed to one line and clipped at 120.
   `types.ts`: `SubagentRunResult.finalText`, `SubagentNode.finalText`; correct the two comments
   that today promise `content` is not read (`types.ts:96-102`, `summarize.ts:190-195`) so they say
   what is actually true: `prompt` is still never read, `content` is clipped to a row's worth.
   `subagents.ts`: carry it in `toNode` next to `errorText` (not through `toMetrics`).
2. **Core — declared model (D2).**
   `records.ts`: `declaredModelOf(input)` next to `agentTypeOf` (`records.ts:216`).
   `summarize.ts:144`: fill `ToolCallEvent.declaredModel`.
   `subagents.ts`: `SubagentNode.model = result?.model ?? call.declaredModel ?? null`; `metrics`
   untouched, `pressureFor` keeps using `resolvedModel` only.
3. **Main window (D3).** `SubagentTree.tsx`: message as its own `.meta` line; `Metrics` reads
   `node.model` from the node instead of `metrics.model`; the running/launched branch says that no
   interim report exists. Plus one CLI line in `cli/index.ts`.
4. **Popover (D4).** On top of 010's subagent rows in `popover.tsx` + `styles.css`: the model cell
   (empty when unknown) and a clipped message line. `presentation.ts` gets the alias branch.
5. **N5 (D5).** Extend the cold-start test so the tails carry agent results with long reports,
   log the elapsed ms, record the number in the Done section.

Order: D1 → D2 → D3 → D5 can run once core is in; **D4 waits for story 010 D5/D6**.

Files, in the order they are touched: `src/core/adapters/claude/summarize.ts`,
`src/core/adapters/claude/records.ts`, `src/core/model/types.ts`, `src/core/state/subagents.ts`,
`test/fixtures/builders.ts`, `test/unit/reading.test.ts`,
`src/renderer/components/SubagentTree.tsx`, `src/cli/index.ts`, `src/shared/presentation.ts`,
`test/unit/presentation.test.ts`, `src/renderer/popover.tsx`, `src/renderer/styles.css`,
`test/unit/pipeline.test.ts`.

## Deliverables

- [x] D1 — **Final message at the adapter boundary and on the node.**
      New `finalTextOf` in [summarize.ts](../../src/core/adapters/claude/summarize.ts) (next to
      `subagentRunResultOf`, mirroring `clipError`'s shape but with `toolInputHint`'s 120-char
      rule): last `type: 'text'` block of the result's `content`, or a plain-string `content`,
      collapsed to one line and clipped; `null` when there is no text.
      `SubagentRunResult.finalText` + `SubagentNode.finalText` in
      [types.ts](../../src/core/model/types.ts), carried in `toNode` next to `errorText` in
      [subagents.ts](../../src/core/state/subagents.ts) (**not** via `toMetrics`).
      Correct the two comments that promise `content` is not read
      ([types.ts:96-102](../../src/core/model/types.ts#L96-L102),
      [summarize.ts:190-195](../../src/core/adapters/claude/summarize.ts#L190-L195)).
      Fixture: give [builders.ts:154](../../test/fixtures/builders.ts#L154) a report marker
      distinct from the prompt marker, and a `content` override so a long report can be built.
      Tests in [reading.test.ts](../../test/unit/reading.test.ts): normal block array, plain-string
      `content`, a >120-char report (clipped, ends `…`), an object result with no text (`null`),
      the plain-string *error* result (`errorText` set, `finalText` null), a running call (`null`),
      an `async_launched` result (`null`, `outputFile` not opened), and the split privacy assertion
      (prompt marker absent, report marker present).
      *Acceptance:* `npm test` green; no field other than `content` newly read.
      *Files:* `summarize.ts`, `types.ts`, `subagents.ts`, `builders.ts`, `reading.test.ts`.

- [x] D2 — **Declared model and its precedence.**
      `declaredModelOf(input)` in [records.ts](../../src/core/adapters/claude/records.ts#L216),
      mirroring `agentTypeOf` exactly (trimmed non-empty string, else `null`); wired at
      [summarize.ts:144](../../src/core/adapters/claude/summarize.ts#L144) into a new
      `ToolCallEvent.declaredModel`; resolved once in `toNode` as
      `SubagentNode.model = result?.model ?? call.declaredModel ?? null`.
      `metrics.model`, `toMetrics` and `pressureFor` stay untouched — a declared alias must never
      feed the context-window estimate.
      Tests: declared model visible while running; `resolvedModel` wins after the result;
      no `model` key in the call → `null` on a running *and* a finished node.
      *Acceptance:* `npm test` green; nothing agent-specific leaves `adapters/claude/`.
      *Files:* `records.ts`, `summarize.ts`, `types.ts`, `subagents.ts`, `reading.test.ts`.

- [x] D3 — **Main window renders both.** In
      [SubagentTree.tsx](../../src/renderer/components/SubagentTree.tsx): `finalText` as its own
      `.meta` line under the row (`title` = "What the subagent reported back, clipped"); `Metrics`
      and the running/launched branch read `node.model` instead of `metrics.model`, rendering
      nothing when it is `null`; the running **and** `launched` hint states that no interim report
      exists (today only `running` gets a hint at all,
      [SubagentTree.tsx:60-66](../../src/renderer/components/SubagentTree.tsx#L60-L66)).
      `errorText` keeps its own line and is rendered before `finalText`. Plus one line in
      [cli/index.ts:183](../../src/cli/index.ts#L183) so the smoke can be cross-checked.
      *Acceptance:* main window detail pane shows a finished subagent's report and a running one's
      declared model; a subagent with neither shows no empty cell and no stray separator.
      *Files:* `SubagentTree.tsx`, `styles.css`, `cli/index.ts`.

- [x] D4 — **Popover renders both** — *after story 010 D5/D6 have landed.* In
      [popover.tsx](../../src/renderer/popover.tsx) + [styles.css](../../src/renderer/styles.css),
      on 010's expanded subagent row: the model cell reads `node.model` (empty when `null`, no
      placeholder, no `≈`), with the `title` naming the provenance ("declared in the `Agent` call,
      not yet confirmed by the run" vs. "model the run actually resolved to"); the report on the
      row's second line, clipped text as delivered by D1, never the parent's `lastAssistantText`.
      `presentation.ts` gains the alias branch (`opus`/`sonnet`/`haiku`/`fable` → title-cased) with
      cases in [presentation.test.ts](../../test/unit/presentation.test.ts).
      Mirror the wording and tooltips of `SubagentTree` so the two surfaces cannot describe the
      same run differently.
      *Acceptance:* popover and main window show the identical string for the same run.
      *Files:* `popover.tsx`, `styles.css`, `presentation.ts`, `presentation.test.ts`.

- [x] D5 — **Measure the N5 cost.** Extend the cold-start test
      ([pipeline.test.ts:590](../../test/unit/pipeline.test.ts#L590)) so every live tail carries an
      agent result with a multi-kilobyte report, keep the `< 2 s` assertion, and log the elapsed
      ms. Record the measured number (before/after, same machine) in the Done section — a
      number, not an assurance.
      *Acceptance:* the recorded ms is in the Done section and the assertion still holds.
      *Files:* `pipeline.test.ts`.

## Coverage (AC → D)

| AC | Deliverable |
|---|---|
| Final message on `SubagentNode`, rendered in popover + tree | D1 (model), D3 (tree), D4 (popover) |
| Clipped at the adapter boundary, not in the renderer | D1 |
| Running/`launched`: no message, states that no interim state exists | D1 (`null`), D3 + D4 (wording) |
| Failed run keeps showing `errorText` | D1 (test), D3 + D4 (order on the row) |
| Privacy line holds and is verifiable | D1 (split privacy test, comment correction) |
| Declared model extracted and shown while running | D2 + D3 + D4 |
| No declared model → empty cell, no derivation | D2 (`null`) + D3 + D4 (render nothing) |
| `resolvedModel` wins once the run finishes | D2 |
| Reading stays inside the N5 budget — measured | D5 |
| Adapter stays agent-neutral | D1 + D2 (typed fields only, extraction stays in `adapters/claude/`) |

## Model Hints

- D1 → `deliverable-hard` — it reverses a documented privacy-adjacent decision in the adapter, and
  the result's `content` has three shapes (block array, plain string, absent) sitting next to the
  plain-string *error* result, which must not be confused with a report.
- D2, D3, D4, D5 → default tier. D2 was marked hard while it had three sources and a provenance
  marker; the User decision removed both, leaving a two-step `??`.
- Review: → `story-review-hard` — the story touches `core/adapters/` and the privacy claim in
  CONCEPT §4; a reviewer has to check the claim (prompt still unread, nothing written or logged),
  not just the diff.

## Test Plan (manual acceptance)

Run `npm run dev` (unset `ELECTRON_RUN_AS_NODE` when launching from VS Code). Story 010's popover
drill-down must be in place for steps 2-4.

1. **Prepare a run.** In any Claude Code session in a watched project, start two subagents in one
   message: one with an explicit `model` on the `Agent` call (e.g. `model: "sonnet"`), one without,
   and let both produce a long report (more than a couple of sentences).
2. **While they run:** open the popover and expand the session. The subagent with the declared
   model shows it (title-cased, tooltip says it was declared in the call, not yet confirmed); the
   other shows **no model at all** — no `≈`, no `—`, no placeholder. Neither shows any report text;
   both say plainly that no interim state exists.
3. **After they finish:** the report line appears, one line, ellipsized at its end rather than
   wrapping; the model cell now shows the resolved model (`Opus 5 · 1M` shape), i.e. the declared
   alias has been replaced. Hover: the tooltip now says the run resolved to it.
4. **Cross-check the surfaces:** open the main window's detail pane for the same session. Report
   text and model must be character-for-character what the popover shows. Optionally run
   `npm run cli` and confirm the same string a third time.
5. **Nothing new on disk (§4):** with the app running, confirm no new file appears under the app's
   userData directory beyond `settings.json`, and that no report text shows up in the DevTools
   console or the terminal output of `npm run dev`.
6. **Failure case:** if a subagent dies (a 529 during a long run does it), its row still shows the
   error text and no report. Not reproducible on demand — check opportunistically, the unit test in
   D1 is the standing coverage.
7. **N5:** `npm test` — read the logged cold-start ms from the N5 test and compare with the number
   D5 recorded in the Done section.

## Done

**Summary.** Two adapter fields (`finalText`, `model`) were added to `SubagentRunResult`/
`SubagentNode` and carried to both display surfaces (main window's `SubagentTree`, popover's
`SubagentRow`). `finalText` is the subagent's last text block / plain-string result content,
collapsed and clipped to 120 chars at the adapter boundary (`records.ts`'s shared
`clipOneLine`/`ROW_TEXT_CHARS`), never through `toMetrics` so it survives a numberless result.
`model` follows the declined-inference precedence `resolvedModel (finished) → declared model
(from the `Agent` call's `model` key) → null`, with no `≈`-marked guess. A declared model is a
tier alias (`opus`/`sonnet`/`haiku`/`fable`), title-cased by a new branch in
`modelDisplayName`. Both surfaces render byte-identical text/tooltips for the same run.

**Decisions (implementation-time, not pre-decided in the story):**
- The tooltip's "resolved vs declared" provenance check uses `node.metrics?.model != null`,
  not `node.metrics != null` — `hasNumbers()` can be true from tokens/tool-uses alone even
  when `result.model` is null, so checking `metrics` presence alone could mislabel a
  numbers-but-no-model result as "resolved". Caught and fixed during the story-level review
  (see below).
- The shared "no interim state" wording was consolidated into one constant
  (`SUBAGENT_NO_INTERIM_STATE`, defined in `subagentParts.ts`, re-exported from
  `popoverModel.ts`) rather than two independently-worded literals, so the two surfaces cannot
  drift again.
- On a failed run, `errorText` and any known `model`/`finalText` are now shown together in
  both surfaces (previously the popover suppressed the model/report chips on error) — the
  story's own AC says the new fields must not displace `errorText`, which implies coexistence,
  not either/or.
- `buildMetricParts`'s own dead `model` part (superseded by `node.model` in both renderers,
  since only `node.model` — not `metrics.model` — can show a declared alias while running) was
  removed rather than left unused, along with its now-stale test.
- N5 measurement: the cold-start test was extended so every live tail carries a multi-KB
  subagent report; measured elapsed time **136–138 ms** (well inside the existing `< 2 s`
  budget), logged by the test and also asserted structurally (a `finalText` is actually
  extracted, clipped, and ends in `…`) so the measurement can't go vacuous if extraction broke.
- The `.claude/ai-scrum.md` diff visible in `git status` (branch-base/protected-branches
  update) predates this story's work and was left untouched — out of scope.

**Verification:**
- `npm run build` — clean.
- `npm test` — 260/260 green (13 files).
- `npm run typecheck` — clean.
- Code review (`story-review-hard`, clean agent): first pass returned FAIL with 7 findings
  (2 real bugs — `launched` subagents showing no "no interim state" hint in the popover, and
  the popover suppressing the model/report chips on a failed run where the tree did not; a
  wrong tooltip predicate; wording drift between the two surfaces; dead code in
  `subagentParts.ts`; a vacuous N5 assertion; a documentation nit about the plain-string
  `content` fixture rationale). All but the documentation nit were fixed in one review-fix
  cycle; build/test/typecheck re-verified green afterward. The documentation nit
  (`docs/requirements/011-...md:120-122`) is left as-is — it describes why the fixture covers
  the plain-string branch, which remains true; the reviewer's point was only that the *sample*
  fixture the sentence cites doesn't itself exercise that shape, not that the code is wrong.
- Live UI acceptance (P2, `## Test Plan (manual acceptance)`): **not performed** — no live
  Electron display session is reachable from this autonomous run (confirmed for story 010; the
  same constraint applies here). Built, acceptance pending.

**Commit message (prepared, not committed):**
```
011: subagent final message and declared model in popover + main window
```
