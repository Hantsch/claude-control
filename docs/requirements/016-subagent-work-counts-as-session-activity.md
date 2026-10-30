---
id: 016
title: A session working through a subagent is not `done`
status: ready # draft -> ready -> in-progress -> done
created: 2026-08-23
---

## Requirement

A session that has handed its work to a subagent looks finished. The parent transcript's last
record is `assistant / stop_reason=end_turn`, so the state machine says `done` — while the
subagent writes to its own file for another forty minutes. The user sees a settled green row,
gets a "done" toast for a turn that is not over, and the row then drops off the tray entirely
because `trayRecentMs` retires settled sessions. Two sprints running in parallel, one visible.

Reproduced on 2026-08-23, session `d59011db-…` (project `q2-launcher`, PID 30084):

```
<slug>/d59011db-….jsonl                          last write 17:24:01, last record end_turn
<slug>/d59011db-…/subagents/agent-a3df3673….jsonl  1.7 MB, still growing at 18:05:46
<slug>/d59011db-…/subagents/agent-ad4cc039….jsonl  its child, growing at 18:01:22
```

The app is not wrong about the file it reads — it reads the wrong file. The evidence it would
need is already on disk and already understood by
[subagentFiles.ts](../../src/core/adapters/claude/subagentFiles.ts), which story 011 added for
exactly this class of problem. It is just wired to one narrow case: `subagentActivityAt` is only
collected for subagent nodes whose status is `running`
([adapter.ts:252](../../src/core/adapters/claude/adapter.ts)) — i.e. an `Agent` call with no
paired result yet — and the state machine only consults it inside the `pendingTool` branch
([machine.ts:158](../../src/core/state/machine.ts)). The `end_turn` branch
([machine.ts:140](../../src/core/state/machine.ts)) is unconditional.

There are at least two shapes where a subagent is demonstrably working and the parent transcript
has no open call to hang that on:

- **A background launch.** Its result says "launched", the node's status is `launched`, and
  `runningSubagentCount` deliberately does not count it
  ([subagents.ts:124–136](../../src/core/state/subagents.ts)) because nothing in the transcript
  ever reports its end. Nothing in the *transcript*, that is — its file says plenty.
- **A re-tasked agent, which is the case observed above.** The `Agent` call returned
  `status: "completed"` at 17:17, and the parent then kept the same agent working by sending it
  two messages (`SendMessage` at 17:17 and 17:23, both paired). The node reads `completed`, there
  is no pending call at all, and the session ended its turn while the agent it is waiting on ran
  on for another 48 minutes.

So the rule cannot be "rescue an overdue pending call" — that is what exists. It has to be
"subagent files under this session are being written, therefore this session is working",
independent of what the parent transcript's node statuses say.

Note what stays true: the status the transcript reports is not *wrong* as a statement about the
transcript, and §4's read-only/metadata-only promise must not be spent on this — the existing
reader only stats files and opens no subagent transcript, and that has to survive.

### Update 2026-10-30 — reproduced twice more, and Claude Code now says so itself

Reproduced on two running sprints at once (q2-launcher `/sprint S37`, ugreen_photo_app
"Build 007"): both parents ended their turn right after `Async agent launched successfully`,
both subagent files were written within the last minute, the app said `done` for both — and
Claude Code's registry said `busy` for both, because its `busy` is `isLoading ||
delegatedActive` ([RESEARCH.md §6](../RESEARCH.md)).

So the *detection* half of this story moves to [020](020-claude-codes-own-status-outranks-the-transcript.md),
which makes the registry status authoritative. What stays here is everything 020 does not
answer:

- the **presentation** of a delegating session — the reason line, "last activity", the
  subagent chip — once 020 has stopped calling it `done`;
- the **fallback** for a registry that carries no `status` (older Claude Code, another
  entrypoint), where subagent-file `mtime` stays the only evidence;
- `working` vs `stale` for a session that is `busy` *only* through `delegatedActive` while
  nothing under `subagents/` has been written for a long time.

Build after 020.

## Acceptance Criteria

- [ ] A session whose only current activity is a subagent writing under
      `projects/<slug>/<sessionId>/subagents/` is not shown as settled on any live surface —
      not in the main window, not in the popover, not in the tray badge, not in the CLI
- [ ] This holds for a subagent that was launched in the background, and for one whose `Agent`
      call already returned and that is being kept working by `SendMessage`
- [ ] The row's "last activity" reflects the newest subagent write, not the parent's last record
      — no more "26m ago" next to a file that was written four seconds ago
- [ ] No `done` notification fires while subagent work is demonstrably still going on
- [ ] When the subagent work really stops, the session settles within a bounded, stated time and
      stays settled — no flapping between working and done
- [ ] The status reason names the evidence, the way the `pendingTool` branch already does
      ("its subagent wrote 4s ago")
- [ ] The added disk work stays inside the tick budget (N4) and still opens no subagent
      transcript — metadata only, per CONCEPT §4
- [ ] A session with no `subagents/` directory, and an agent version that writes none, behaves
      exactly as it does today

## Open Questions

<!-- S06: the product questions below were answered by the user — see Decisions (Sprint) -->
<!-- S06 refine: all questions below are resolved — every one has its answer under Decisions (Sprint). -->

None open.

### Resolved (kept for the record)

- **(2026-10-30) Which questions below does 020 settle?** With a registry `status`, "what
  counts as still working" is answered by Claude Code (`delegatedActive`), and the scan-width
  question only matters for the fallback path. The product question — own status or
  `working` — is untouched by 020 and is still this story's.
- **Own status, or `working` with a different reason?** A session whose turn has ended but whose
  delegate is running is not the same thing as a session mid-turn: it is not going to answer the
  user, and a permission prompt cannot be pending in it. A distinct state would say that
  honestly, but it costs a tray colour, a badge rule, a notification rule and a CLI label. The
  cheaper reading — `working`, reason "subagent still writing" — spends none of those. This is
  the product question of the story.
- **What counts as "still working"?** Newest write under `subagents/` more recent than T. Which
  T? The `Agent` per-tool budget (20 min, `DEFAULT_THRESHOLDS`) is the existing number, but it
  is a budget for *overdueness*, not a liveness window — a subagent between two tool calls can
  easily be quiet for a minute, and one that died leaves a file that is quiet forever.
- **How wide is the scan?** Newest mtime across the whole `subagents/` directory is the simplest
  rule and needs no link to the node tree at all; restricting it to files linked to a node is
  cheaper to justify but is exactly the link that failed in the re-tasked case. Cost matters:
  this runs per live session per 5 s tick, and `SubagentActivityReader`'s cache is keyed on the
  directory mtime, which does not change when an existing file grows.
- **Does the "· Agent ●● 1/2" chip change too?** `runningSubagentCount` skips `launched` runs by
  design. If the session is now called working *because* of such a run, a chip that says zero
  subagents is the next contradiction.
- **History.** `deriveHistoricalStatus` asks "how did this session end", evaluated at its last
  record. Presumably untouched — but say so, rather than leaving it to be discovered.

## Decisions (Sprint)

- **(User)** Own status or `working`: `working` with a distinct reason ('subagent still running'); no new tray colour, badge, notification or CLI label.
- **Split with 020:** where the registry carries a `status`, it alone decides `working` vs
  settled (020); this story only adds the subagent evidence to that reason and to "last
  activity", and decides status itself only when the registry has no `status` — 020 owns
  detection and its AC2 says a registry `idle` is never `working`.
- **`busy` with quiet subagent files stays `working`** — already decided by the user under 020
  ("trust Claude Code; no age cut-off"), so this story adds no `stale` rule for it.
- **Liveness window `SUBAGENT_LIVENESS_MS` = 10 min**, a named constant, not a user setting —
  it must outlast the longest quiet stretch of a healthy subagent (one Bash call may run up to
  10 min with nothing written), and it only governs the no-`status` fallback, where a late
  `done` is the cheaper error than the false `done` this story exists to fix.
- **Settle bound stated as:** at most `SUBAGENT_LIVENESS_MS` after the newest subagent write,
  plus one tick — reached without flapping because nothing but a new write can lift it again.
- **Scan width = every `agent-*.jsonl` in the session's `subagents/` directory**, unlinked to
  the node tree — the link is exactly what failed in the re-tasked case.
- **The session-wide scan only runs when the parent tail ends in `end_turn`** — both observed
  shapes end there, mid-turn sessions are live by their own records, and it keeps the cost off
  sessions that are actively writing.
- **Cost model:** a full pass (readdir + one `stat` per `.jsonl`) only on first sight, a changed
  directory mtime, a changed parent transcript, or every 60 s; otherwise one `stat` of the
  directory plus one per *hot* file (written within the liveness window) — real sessions carry
  up to ~240 subagent files, so a `stat`-everything-per-tick rule is not inside N4's spirit.
- **The evidence must refresh even when the parent transcript is unchanged** — the engine's
  "unchanged transcript ⇒ reuse cached facts" shortcut currently freezes `subagentActivityAt`
  too, which would make every rule here (and 011's) blind exactly while the parent is quiet.
- **"Last activity" = newest of the parent's last record, the pending-call subagent write and
  the session-wide subagent write** — the row then never shows "26m ago" next to a file written
  seconds ago; it also counts as news for `seen` re-arming, same as a parent write does.
- **Chip:** `runningSubagentCount` and the done/total chip stay as they are (the popover pip
  already shows `launched` as running); `launched` nodes now get their own `lastActivityAt`
  stamped, so their row says "Still working — wrote 4s ago" instead of the no-interim-state
  line. A re-tasked `completed` node keeps its finished pip — its call did complete, and the
  session reason carries the evidence.
- **Interrupted / starting tails are not lifted** by subagent writes — out of the observed
  shapes, and Esc semantics for background agents are unmeasured.
- **History untouched, explicitly:** `deriveHistoricalStatus` drops the subagent evidence
  before deriving, since evaluated at the last record a later subagent write would read as
  `working` for a finished session.
- **No e2e harness exists (`e2e: none`):** the "every live surface" criterion is proven at the
  engine snapshot that the main window, popover, tray badge and CLI all render from; the gap is
  named under Acceptance Tests.

## Plan

Order: D1 → D2 → D3 (D3 needs both). Builds on 020's registry-primary machine.

1. **Reader (D1)** — `SubagentActivityReader.sessionActivity()` in `subagentFiles.ts`: newest
   `mtime` across every `agent-*.jsonl` of a session, with a hot/cold cache so a steady tick
   stats the directory and the recently-written files only. Injectable fs functions so a test
   can count calls. Metadata only — no `.jsonl` opened.
2. **Machine (D2)** — new fact `facts.subagentsWrittenAt`. In `deriveStatus`:
   - no registry `status` + tail `end_turn` + write within `SUBAGENT_LIVENESS_MS` → `working`,
     reason "subagent still running — wrote 4s ago";
   - registry `busy` over an `end_turn` tail (020's branch) → same evidence appended to its
     reason; registry `idle` untouched.
   - `deriveHistoricalStatus` nulls the fact. CONCEPT §6.2 gets the rule.
3. **Wiring (D3)** — adapter fills `subagentsWrittenAt` when the tail ends in `end_turn`, stamps
   `launched` nodes too; engine refreshes the evidence on the unchanged-transcript path and
   computes `lastActivityAt` as the newest of the three times. Engine-level tests walk both
   shapes (background launch, re-tasked) through ticks with a fake clock: live, current,
   no `done` transition while writing, exactly one after the window, then stable.

Affected: `src/core/adapters/claude/subagentFiles.ts`, `adapter.ts`, `src/core/adapters/types.ts`,
`src/core/model/{types,settings}.ts`, `src/core/adapters/claude/summarize.ts`,
`src/core/state/{machine,subagents}.ts`, `src/core/engine.ts`, `docs/CONCEPT.md`, `CHANGELOG.md`,
tests in `test/unit/{subagentActivity,machine,pipeline}.test.ts`.

## Deliverables

- **D1 — Session-wide subagent write time, cheaply.** In
  `src/core/adapters/claude/subagentFiles.ts` add to `SubagentActivityReader` a method
  `sessionActivity(sessionId: string, dir: string, parentStamp: string, now: number):
  Promise<number | null>` returning the newest `mtimeMs` across **every** `agent-*.jsonl` in
  `dir` (linked to a node or not; descendants are flat in the same dir), or `null` when the dir
  is missing/unreadable or holds no such file. Cache per session (separate from the existing
  sidecar index cache, also cleared by `forget`): `{ dirMtimeMs, parentStamp, lastFullAt,
  files: Map<path, mtimeMs> }`. **Full pass** (one `readdir` + one `stat` per `.jsonl`) when:
  no cache, directory mtime changed, `parentStamp` differs from the cached one, or `lastFullAt`
  older than 60 s (`COLD_RECHECK_MS`). **Otherwise** one `stat` of the directory plus one `stat`
  per *hot* file (cached `mtimeMs` within `SUBAGENT_LIVENESS_MS` of `now` — import it from
  `src/core/model/settings.ts`, which D2 creates; if D1 lands first, create it there:
  `export const SUBAGENT_LIVENESS_MS = 10 * 60_000;` with a one-line comment). Trap to avoid:
  the directory mtime does **not** change when an existing file grows — that is why hot files
  are re-stat'ed each call. Never `readFile`/open a `.jsonl` (§4). Make the fs functions
  injectable: constructor option `fs?: { stat, readdir, readFile }` defaulting to
  `node:fs/promises`, used by both old and new paths, so tests count calls.
  Tests in `test/unit/subagentActivity.test.ts` (use `makeFixtureTree().writeSubagent` from
  `test/fixtures/builders.ts`, set mtimes with `utimes`): "finds the newest write across every
  subagent file of a session, linked or not"; "a steady-state pass stats the directory and the
  recently written files only" (fixture: 50 old files + 1 hot; second call with same
  `parentStamp` → exactly 2 `stat`s, 0 `readdir`); "a file that grows without changing the
  directory is still seen as written"; "a changed parent transcript forces one full pass";
  "opens no subagent transcript" (`readFile` never called with a `.jsonl` path); "reports
  nothing when the session has no subagent directory".

- **D2 — The machine counts subagent writes after `end_turn`.** Files:
  `src/core/model/types.ts` (add `subagentsWrittenAt: number | null` to `TranscriptTailFacts`,
  doc comment: newest write across the session's whole `subagents/` dir, only filled when the
  tail ends in `end_turn`), `src/core/adapters/claude/summarize.ts` and the `emptyFacts` in
  `src/core/adapters/claude/adapter.ts` (default `null`), `src/core/model/settings.ts`
  (`SUBAGENT_LIVENESS_MS = 10 * 60_000` unless D1 already added it), `src/core/state/machine.ts`,
  `docs/CONCEPT.md` §6.2. In `deriveStatus`, with `w = facts.subagentsWrittenAt`, `fresh = w !==
  null && now - w < SUBAGENT_LIVENESS_MS`:
  - **No registry `status`** (reported absent or `status` null) and the tail's last record is
    `assistant` + `end_turn` and `fresh` → `status: 'working'`, `statusSource: 'inferred'`,
    reason `subagent still running — it wrote ${s}s ago, so this turn's work is not over`
    (seconds, or minutes when ≥ 120 s — mirror the `pendingTool` branch's wording style). Not
    fresh → `done` exactly as today. `interrupted`/`starting` tails are never lifted.
  - **Registry `busy` over an `end_turn` tail** (the branch 020 added that lifts a settled tail
    to `working`): keep 020's status and source, append `— subagent still running, wrote Ns
    ago` when `w !== null` (fresh or not; no `stale` rule — user decision under 020).
  - Registry `idle`/`waiting`: unchanged.
  - `deriveHistoricalStatus`: pass `facts` with `subagentsWrittenAt: null`.
  CONCEPT §6.2: add the fallback rule and the stated settle bound (≤ 10 min after the newest
  subagent write, plus one tick). Tests in `test/unit/machine.test.ts`: "a turn that ended
  while its subagent is still writing stays working and says so"; "settles to done once the
  subagents have been quiet for the liveness window, and stays there" (derive at window−1 s,
  window, window+1 h); "a registry busy session names its subagent evidence in the reason";
  "a registry idle session stays settled whatever its subagents wrote"; "a finished session's
  history status ignores subagent writes after its last record". Existing tests unchanged.

- **D3 — Wire it through adapter and engine.** Files: `src/core/adapters/claude/adapter.ts`,
  `src/core/state/subagents.ts`, `src/core/adapters/types.ts`, `src/core/engine.ts`,
  `CHANGELOG.md`, test in `test/unit/pipeline.test.ts`.
  - `applySubagentActivity` (adapter.ts ~l.307): query linked activity for `running` **and
    `launched`** nodes; `withSubagentActivity` (subagents.ts) stamps both statuses (update its
    doc comment and the `lastActivityAt` doc in `model/types.ts` wording if touched). When
    `facts.last` is `assistant` + `end_turn`, set `facts.subagentsWrittenAt` from
    `this.subagentActivity.sessionActivity(sessionId, subagentDirForTranscript(path),
    \`${facts.read.fileSize}:${facts.read.mtimeMs}\`, now)`; errors → `null`.
  - Add optional `refreshSubagentActivity?(snapshot: SessionSnapshot, now: number):
    Promise<SessionSnapshot>` to `AgentAdapter` (types.ts); the Claude adapter re-runs
    `applySubagentActivity` on a copy of the cached facts. In `engine.snapshotFor`, the
    unchanged-transcript branch (~l.541) calls it, so evidence stays current while the parent
    file is quiet (today it freezes).
  - `engine.toView`: `lastActivityAt` = max of `facts.last?.at`, `facts.subagentActivityAt`,
    `facts.subagentsWrittenAt` (nulls ignored).
  - CHANGELOG `# Fixes` entry: a session handing work to a subagent no longer reads done.
  Tests (pipeline.test.ts, `describe('engine')`, engine `now` option as fake clock, parent
  transcript left **untouched** across ticks, subagent mtimes moved with `utimes`): "a session
  delegating to a background subagent stays live, current and silent until the subagent
  stops" — parent ends `end_turn` after an `async_launched` `Agent` result, no registry
  `status`; asserts status `working`, reason names the subagent, it is in the tray/popover
  session list and counted in the badge state, `lastActivityAt` = the subagent mtime, no
  `transitions` event to `done` across ticks while the file moves; then the clock passes
  the window → exactly one transition to `done`, and further ticks emit none. "a re-tasked
  subagent kept working by SendMessage keeps its session working" — `Agent` result
  `completed`, two paired `SendMessage` calls, `end_turn`, sidecar linked to the old call,
  file freshly written → `working`.

## Model Hints

- D1 → deliverable-hard — the cache is the subtle part: the directory mtime does not move when
  a file grows, a resumed cold agent must be caught via the parent-stamp / 60 s full pass, and
  a wrong invalidation either freezes the evidence (false `done`, the bug back) or stats ~240
  files per session per tick.
- Review: → default

## Test Plan (manual acceptance)

### Acceptance tests

- AC1 (not settled on any live surface) → unit `test/unit/pipeline.test.ts` › "a session
  delegating to a background subagent stays live, current and silent until the subagent
  stops" — asserted on the engine snapshot that main window, popover, tray badge and CLI all
  render. **Gap:** `e2e: none` — no harness drives the real window/tray; covered one level down.
- AC2 (background launch and re-tasked) → same test (background) + unit
  `test/unit/pipeline.test.ts` › "a re-tasked subagent kept working by SendMessage keeps its
  session working"
- AC3 (last activity = newest subagent write) → unit `test/unit/pipeline.test.ts` › "a session
  delegating to a background subagent stays live, current and silent until the subagent stops"
- AC4 (no `done` notification while subagents write) → same test (no `done` transition, the
  only input `NotificationGate` acts on)
- AC5 (settles within a stated bound, no flapping) → unit `test/unit/machine.test.ts` ›
  "settles to done once the subagents have been quiet for the liveness window, and stays
  there" + the engine test's single-transition assertion
- AC6 (reason names the evidence) → unit `test/unit/machine.test.ts` › "a turn that ended while
  its subagent is still writing stays working and says so" and › "a registry busy session names
  its subagent evidence in the reason"
- AC7 (tick budget, metadata only) → unit `test/unit/subagentActivity.test.ts` › "a
  steady-state pass stats the directory and the recently written files only" and › "opens no
  subagent transcript"
- AC8 (no `subagents/` dir behaves as today) → unit `test/unit/subagentActivity.test.ts` ›
  "reports nothing when the session has no subagent directory" + existing › "behaves exactly as
  before for an agent version that writes no subagent transcripts" + the unchanged
  `test/unit/machine.test.ts` suite

## Done
