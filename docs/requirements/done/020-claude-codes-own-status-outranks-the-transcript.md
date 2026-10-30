---
id: 020
title: Claude Code's own status outranks the transcript
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The app works out every session's status by reading the tail of its transcript, because when
it was designed Claude Code published nothing better ([RESEARCH.md §1](../RESEARCH.md)).
That is no longer true. Since at least `2.1.312` every registry file carries `status`
(`busy` / `idle` / `waiting`), `waitingFor`, `updatedAt` and `statusUpdatedAt`, computed
inside Claude Code from the same state its own UI renders — and `busy` explicitly includes
background agents that are still running ([RESEARCH.md §6](../RESEARCH.md)).

The app reads the field and throws most of it away: `deriveStatus` acts on a reported
`waiting` only, and carries everything else "never acted on"
([machine.ts:89](../../src/core/state/machine.ts)). So on 2026-10-30, with two sprints
running, Claude Code said `busy` for both while the app said `done` for both — and then hid
them, because the app had just been restarted (see [018](018-a-hidden-session-says-it-is-hidden.md)).
Three of twelve live sessions were on screen. That is the "running stories are sometimes not
recognised" the user reported.

This is the same truth the user's `scrum-cockpit` mod works from — it sits inside Claude
Code and gets `agent.spawn` and turn events directly. The registry status is the closest the
app can get to that from outside, and it is the agent's own word, not an inference.

[CONCEPT.md](../CONCEPT.md) already decided what should happen when this day came: "If
Claude Code later exposes an authoritative upstream status field, it would supersede the
§6.2 derivation for the states it covers." This story does that.

What the user should get: a session that Claude Code considers busy is never shown as
finished, and a session Claude Code considers idle is never shown as working — on every
surface, the moment the registry file changes, not on the next poll.

## Acceptance Criteria

- [x] **AC1** — A live session whose registry says `busy` is never shown as `done`,
      `interrupted` or `starting`, whatever its transcript's last record is — including a
      session whose last record is `end_turn` after an async `Agent` launch
- [x] **AC2** — A live session whose registry says `idle` is never shown as `working` or
      `queued` — e.g. a turn that died mid-tool and left a tool result as the last record
- [x] **AC3** — A registry `waiting` keeps today's behaviour, and its `waitingFor` text is
      what the row, the toast and the detail pane say the session is waiting for
- [x] **AC4** — Transcript-only distinctions survive where the registry has no word for them:
      `idle` still resolves to `done` vs `interrupted` vs `starting` from the transcript, and
      `busy` still shows the current tool and the `working` / `stale` split
- [x] **AC5** — Every status says where it came from: the reason line (detail pane, CLI `-v`)
      distinguishes "Claude Code reports busy" from an inference
- [x] **AC6** — A registry file without a `status` field (older Claude Code, another
      entrypoint) behaves exactly as today — every existing machine test that passes no
      registry status stays green unchanged (the one test asserting that `busy`/`idle` are
      ignored encodes the rule this story reverses and is narrowed to unrecognised values)
- [x] **AC7** — A change to the registry file alone (status flips, transcript untouched)
      reaches the live surfaces within the watcher debounce, not on the next 5 s tick
- [x] **AC8** — No `done` toast fires while the registry says `busy`; the `done` toast for a
      delegating session fires once, when the registry goes `idle`

## Open Questions

<!-- S06: all resolved — the product questions by the user, the rest in refine; see Decisions (Sprint) -->

- **How much does `busy` override?** The cheapest version only lifts `done` / `interrupted`
  to `working`. The full one makes the registry the primary input and uses the transcript only
  for the sub-state (tool, overdue, done-vs-interrupted). The second is what CONCEPT §6.2's
  note implies; the first is what fixes the reported bug. Both satisfy AC1–AC8 if AC4 is kept.
- **Stale registry status.** `statusUpdatedAt` is stamped on change only, so an old `busy` is
  normal for a long sprint (observed: busy for 2 h 40 min, correctly). Is there any age after
  which `busy` is distrusted, or does liveness + `procStart` already cover the only failure
  (a dead process)? Recommendation: no age cut-off — the PID check is the guard.
- **`stale` under `busy`.** A session that is `busy` only because of `delegatedActive`, whose
  subagent files have not been written for 30 min — `working` because Claude Code says so, or
  `stale` because nothing moves? This is where 016's subagent-mtime evidence comes back in.
- **CONCEPT update.** §6.2 and the "Reported status field" row in the open-risks table both
  describe the field as absent; they need rewording as part of this story, not after it.

## Decisions (Sprint)

- **(User)** How much `busy`/`idle` override: the registry status is the primary input; the transcript only supplies the sub-state (tool, overdue, done-vs-interrupted).
- **(User)** `busy` via `delegatedActive` with quiet subagent files: stays `working` — trust Claude Code; no age cut-off, the PID check guards dead processes.
- `busy` + a transcript verdict of `done` / `interrupted` / `starting` / `unknown` / `queued` → `working`, because Claude Code's own word that a turn or a background agent is running outranks every passive transcript reading (AC1).
- `busy` + an open tool call keeps the transcript's tool and budget, but an overdue *fast* tool becomes `stale` instead of `waiting`, because Claude Code publishes permission prompts and dialogs itself as `waiting` — a `busy` session is therefore not blocked on the user.
- `idle` + an in-flight transcript verdict (`working` / `waiting` / `stale`) → `interrupted`, because nothing is running and nothing finished — the same "idle at its prompt, no toast, no badge" meaning `interrupted` already has.
- Under `idle` the queued-prompt override does not apply (the base rule decides), because AC2 forbids `queued` and an idle session's leftover enqueue record is not pending work.
- `idle` is trusted only when its stamp is not more than 2 s older than the newest transcript record; otherwise the registry has not caught up with a just-submitted prompt and the transcript decides (`inferred`), so a fresh prompt never flashes `interrupted` — `busy` gets no such guard, because an old `busy` next to a newer `end_turn` is exactly the delegating case.
- The registry stamp is `statusUpdatedAt`, falling back to `updatedAt`, because only the former moves when the status changes (RESEARCH §6).
- Any registry `status` other than `busy` / `idle` / `waiting` (or none) is ignored and the transcript decides as today, so an unknown future value cannot break AC6.
- `statusSource: 'reported'` whenever the registry decided or reshaped the status, and the reason reads `Claude Code reports <busy|idle> — <transcript sub-reason>`; the CLI `-v` and the detail pane already render `statusSource`, so no new UI is needed for AC5.
- `waitingFor` reaches the surfaces through one shared helper in `shared/presentation.ts` (toast body, main-window row, detail pane); the popover row already prints `statusReason`, which carries it — so no third copy of the "what is it waiting on" text exists.
- AC7 needs no new watcher code — `~/.claude/sessions/` is already a watch root and a registry event already re-runs discovery and re-derives cached snapshots (`engine.ts` `handleChanges` / `snapshotFor`); the story proves it with an engine test and fixes the engine only if that test fails.
- AC7 and AC8 share one engine test (same path: a delegating session flipping `busy` → `idle`), because they are one behaviour seen twice.
- Renderer components have no test environment (`vitest` runs in `node`, `e2e: none`), so AC3's row/detail-pane wiring is proven one level down through the shared helper — gap named under Acceptance Tests.
- CONCEPT §6.2 gets a "registry status first" block and §6.3/§12 are reworded in this story, and the user-facing fix gets a `CHANGELOG.md` entry; there is no `docs/systems` doc for the state machine to update.

## Plan

Make the registry status the primary input of `deriveStatus`; the transcript supplies only the
sub-state. Plumbing (`reportedStatus`, `waitingFor`, `reportedAt`, `statusSource`) already exists
end-to-end — only `machine.ts` ignores everything but `waiting`.

1. **Machine (D1).** In [machine.ts](../../src/core/state/machine.ts) compute the transcript
   verdict as today (split so the base verdict before the queued override is available), then
   apply the registry layer: `waiting` as today; `busy` lifts passive verdicts to `working` and
   turns an overdue fast tool into `stale`; `idle` (if fresh) turns in-flight verdicts into
   `interrupted` and skips the queued override; anything else → today. Parse `statusUpdatedAt`
   in [registry.ts](../../src/core/registry/registry.ts).
2. **`waitingFor` on the surfaces (D2, D3).** `SessionView.waitingFor`, one shared text helper,
   used by the toast, the main-window row and the detail pane.
3. **Engine proof (D4).** Real-watcher engine test: registry-only flip `busy` → `idle` produces
   exactly one `done` transition, event-driven, and none while `busy`.
4. **Docs (D5).** CONCEPT §6.2 / §6.3 / §12, CHANGELOG.

Order: D1 → D2 → D3, D4 after D1, D5 last. No new source files; no IPC change (`SessionView`
is serialised as a whole).

## Deliverables

- [x] **D1 — Registry status is the primary input of the state machine.** Files:
      `src/core/state/machine.ts`, `src/core/registry/registry.ts`,
      `test/fixtures/builders.ts`, `test/unit/machine.test.ts`, `test/unit/pipeline.test.ts`
      (adapter-parsing block only).
      *Rules* (the `!alive → ended` check stays first; reported `waiting` stays as today):
      compute the transcript verdict exactly as today, keeping the *base* verdict before the
      queued override available. Then, by `reported.status`:
      - `busy`: base/final verdict `done` / `interrupted` / `starting` / `unknown` / `queued` →
        `working`; open tool call → keep the pending tool, budgets and the subagent quiet-clock,
        `working` below budget, over budget → `stale` for every tool (fast or slow — Claude Code
        reports prompts itself as `waiting`). `end_turn` under `busy` is `working` with no age
        cut-off (background agents, `delegatedActive`).
      - `idle`, when `reported.at === null` or `reported.at >= last.at - 2000`: queued override
        skipped; base verdict `working` / `waiting` / `stale` → `interrupted`; `done` /
        `interrupted` / `starting` / `unknown` kept. When the stamp is older than that, the
        registry lags → today's inference, `statusSource: 'inferred'`.
      - any other value or `null`: exactly today.
      - Whenever the registry decided or reshaped the status: `statusSource: 'reported'`, reason
        `Claude Code reports busy — <today's sub-reason>` (resp. `idle`), e.g. for `end_turn`
        under `busy`: "Claude Code reports busy — the turn ended, background agents are still
        running". Update the file's header comment and the `reported` field doc ("absent on every
        version observed" is no longer true — CC `2.1.312`).
      - `registry.ts`: `reportedAt = dateMs(raw.statusUpdatedAt) ?? dateMs(raw.updatedAt)`;
        update the field comment. `registryEntry()` in builders gains `statusUpdatedAt?`.
      *Tests* (in `machine.test.ts`, reusing the existing `withReported` helper in the
      `a registry-reported status (§1)` block): the AC1, AC2, AC4, AC5, AC6 tests listed under
      Acceptance Tests. Narrow the existing test "carries any other reported status without
      acting on it" to `['running', '', null]` (busy/idle now act); every other existing
      machine test stays unchanged. In `pipeline.test.ts` add one adapter test:
      "prefers `statusUpdatedAt` over `updatedAt` as the registry status stamp".
- [x] **D2 — `waitingFor` in the view model and the toast.** Files:
      `src/core/model/types.ts` (`SessionView.waitingFor: string | null`, doc comment),
      `src/core/engine.ts` (`toView`: `waitingFor: derived.status === 'waiting' &&
      derived.statusSource === 'reported' ? ref.waitingFor : null`),
      `src/shared/presentation.ts` (new `waitingOnText(view: { status; waitingFor; pendingTool })
      : string | null` — `null` unless `status === 'waiting'`; registry `waitingFor` →
      `Waiting for <waitingFor>`; else today's toast text from `src/main/notifier.ts:52-55`
      — `<tool> has been pending[: hint]`, or `A fast tool is overdue — probably a prompt
      waiting for you`), `src/main/notifier.ts` (use the helper for the `waiting` body),
      `test/unit/presentation.test.ts`. Any other place that constructs a `SessionView`
      literal (test builders, fixtures) gets `waitingFor: null` so `npm run typecheck` passes.
      *Test:* `presentation.test.ts` › "a waiting session says what Claude Code reports it is
      waiting for" — reported text wins over a pending tool; inferred `waiting` keeps today's
      text; a non-waiting status yields `null`.
- [x] **D3 — `waitingFor` on the main-window row and detail pane.** Files:
      `src/renderer/components/SessionsView.tsx` (row, around `:164` — when
      `waitingOnText(session)` is non-null and `session.waitingFor` is set, show it in place of
      the pending-tool name), `src/renderer/components/SessionDetailPane.tsx` (the
      pending-tool line around `:131` shows `waitingOnText(session)` when the session is
      `waiting`). Reuse the D2 helper from `src/shared/presentation.ts`; no new text. The
      popover row already prints `statusReason` for waiting rows — leave it. *Accept:*
      `npm run typecheck` + `npm run build` green; behaviour proven by D2's helper test (no
      renderer test environment exists).
- [x] **D4 — Registry-only flips are event-driven and toast once.** File:
      `test/unit/pipeline.test.ts` (`engine` block; mirror "observes a status change within 2 s
      of an append (N4)": real `FileWatcher`, `tickIntervalMs: 60_000`, real timestamps).
      Fixture: registry `status: 'busy'`, transcript ending `Agent` launch → tool result →
      `assistant end_turn`. Assert snapshot `working` after start; rewrite the registry file
      only (`status: 'idle'`, `statusUpdatedAt` = now) without touching the transcript; assert
      exactly one non-seeded transition to `done` arrives in < 2 s, none to `done` before the
      flip, and a `NotificationGate` (`src/core/state/notifications.ts`, default notification
      settings) fed the batches notifies exactly once. If the test fails, fix the cause in
      `src/core/engine.ts` (`handleChanges` / `snapshotFor`), not the test.
- [x] **D5 — Concept and changelog.** Files: `docs/CONCEPT.md` — §6.2 gains a "Registry status
      first" block before the transcript rules (the D1 table in five lines, citing RESEARCH §6),
      §6.3 notes that a registry `waiting` is exact and the heuristic only remains for
      registries without `status`, §12 row "Reported status field" reworded to "Present since
      `2.1.312`, authoritative for busy/idle/waiting; transcript supplies sub-state; older
      registries fall back to §6.2"; `CHANGELOG.md` `## Unreleased` gets one Fixes-style entry
      ("a session Claude Code calls busy is no longer shown as done or hidden at start…").
      *Accept:* `test/unit/networkPromiseWording.test.ts` and the full `npm test` stay green.

## Model Hints

- D1 → deliverable-hard — the registry layer has to interleave with the existing transcript
  verdict (queued override, subagent quiet-clock, `waiting`→`stale` under `busy`, the idle
  freshness guard) without moving any of the ~40 table rows that pass no registry status; a
  misplaced branch silently regresses AC6 or re-opens the 016 `done`-while-delegating bug.
- Review: → default

## Acceptance Tests

- AC1 → unit `test/unit/machine.test.ts` › "a session Claude Code reports busy is never done, interrupted or starting, whatever its last record" (cases: `end_turn` after an async `Agent` launch, interrupt marker, empty transcript, queued prompt) — D1
- AC2 → unit `test/unit/machine.test.ts` › "a session Claude Code reports idle is never working or queued — a turn that died mid-tool reads interrupted" — D1
- AC3 → unit `test/unit/presentation.test.ts` › "a waiting session says what Claude Code reports it is waiting for" (D2; toast body uses it directly) + existing machine test "overrides a transcript that would otherwise be done" (reason carries `waitingFor`). **Gap:** the main-window row and detail pane (D3) have no renderer test environment (`e2e: none`, vitest `node`); they render the tested helper, proven one level down.
- AC4 → unit `test/unit/machine.test.ts` › "under idle the transcript still tells done from interrupted from starting" and "under busy an open tool keeps its name and the working/stale split" — D1
- AC5 → unit `test/unit/machine.test.ts` › "a status shaped by the registry says so in its reason and source" (reason starts `Claude Code reports busy`, `statusSource: 'reported'`; a lagging `idle` stays `inferred`) — D1. CLI `-v` and detail pane already render `statusSource` (`src/cli/index.ts:229`, `SessionDetailPane.tsx:101`).
- AC6 → unit `test/unit/machine.test.ts` — the existing `deriveStatus` table (unchanged) plus the narrowed "carries any other reported status without acting on it" — D1
- AC7 → unit `test/unit/pipeline.test.ts` › "a delegating session turns done only when the registry goes idle, without waiting for the tick" — D4
- AC8 → same test as AC7 (no `done` while `busy`, exactly one notifying `done` on the flip) — D4

Coverage: AC1/2/4/5/6 → D1 · AC3 → D2+D3 · AC7/8 → D4 · CONCEPT rewording (Requirement) → D5.

## Done

Registry `status` is now the primary input of `deriveStatus`: `busy` lifts passive transcript verdicts to `working`, a fresh `idle` turns in-flight ones into `interrupted` and never queued, `waiting` as before; the transcript only supplies the sub-state. `waitingFor` reaches toast, row and detail pane through `waitingOnText`. CONCEPT §6.2/§6.3/§12 and CHANGELOG updated.

Commit message: `020: registry busy/idle/waiting outranks transcript inference; waitingFor on surfaces`

Verification (narrow gate, `npx vitest run --changed HEAD`: 9 files / 290 tests green; `npm run build`, `npm run typecheck` green; e2e none, full gate pending sprint). Review: default tier, 1 cycle; one finding (whole-file reformat of the two renderer files) fixed and re-verified.
AC -> test, all passed: AC1/2/4/5 machine.test.ts (names as in Acceptance Tests) · AC6 existing table + narrowed "carries any other reported status…" · AC3 presentation.test.ts helper test · AC7/AC8 pipeline.test.ts "a delegating session turns done only when the registry goes idle…". No manual residue. Gap: row/detail-pane rendering of `waitingFor` has no renderer test env — proven via the helper.

Decisions:
- Busy reasons for interrupted/starting/queued verdicts and for a fast tool over budget use new wording (`Claude Code reports busy — …`); slow-tool stale reason kept.
- `idle` with no stamp or no transcript record is trusted (stamp guard only applies when both exist).
- No engine change needed for AC7/AC8 — the real-watcher test passed as written.
- Review untested edge (idle with `reported.at === null`) left as is: spec-mandated, harmless.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 10
