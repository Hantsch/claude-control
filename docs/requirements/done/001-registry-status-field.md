---
id: 001
title: Registry status field — record its absence, use it if it returns
status: done # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

Status is currently inferred from the transcript. That inference is documented as a heuristic
(CONCEPT.md §6.3) and it is the only thing that works today — but the research record does not
say *why* it is the only thing that works, and it does not say what would replace it.

Two things follow from that, and both are cheap.

**The record is incomplete.** ClaudeSessionTray's entire status model rests on
`~/.claude/sessions/<pid>.json` carrying `status` (`busy` / `waiting` / `idle`), plus
`waitingFor` and `updatedAt` (`ClaudeSessionTray.Core/ClaudeSessionsWatcher.cs:142`). Measured
on this machine on 2026-08-13 against Claude Code `2.1.228`/`2.1.229`: **none of those three
fields is present in any of the 10 live session files**, and a grep for them over the whole
directory returns zero matches. That tool therefore falls into its own `_ => Working` default
and reports every session as working, with `LastActivity` degraded to the file mtime. This is
exactly the kind of version-dependent fact RESEARCH.md exists to pin down — the sample JSON in
§1 happens not to show a `status` field, but nothing there says the absence was checked. Caveat
to record honestly: all 10 observed sessions were `entrypoint: claude-vscode`, so pure terminal
sessions were not sampled.

**The app should take the answer if it is ever offered.** If a future Claude Code version
reintroduces the field, it is the authoritative answer to a question we currently guess at —
and permission prompts are the one case transcript watching cannot see at all. While the field
is absent, nothing changes.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [x] RESEARCH.md §1 states which fields were looked for, that they were absent, on which
      Claude Code versions, and carries the `claude-vscode`-only entrypoint caveat
- [x] CONCEPT.md §12 records that an authoritative upstream status field would supersede §6.2
      if it ever appears
- [x] A session file carrying `status: "waiting", waitingFor: "permission prompt"` derives
      `waiting` from that field, with a reason saying the agent reported it, and with no
      staleness threshold applied
- [x] Existing fixtures (no such field) produce byte-identical results to today
- [x] The detail pane can distinguish "reported by Claude Code" from "inferred"

## Open Questions

_None — all detail questions were decided during refinement, see below._

## Decisions (Sprint)

- **Only `waiting` overrides the transcript.** A reported `busy`/`idle`/anything else is parsed
  and carried but does not change the derived status — `waiting` (permission prompt) is the one
  state transcript watching provably cannot see (CONCEPT.md §6.3), while overriding `working`
  or `done` with a possibly-stale upstream value adds regression risk without adding information.
- **`idle` is not mapped at all.** Our vocabulary deliberately dropped `idle`
  (`src/core/model/status.ts:5-27`), so mapping it would resurrect a state the concept removed.
- **The `!alive` check still wins.** A dead process is `ended` regardless of what its leftover
  registry file claims — the file is explicitly treated as a candidate list that survives crashes
  (`registry.ts:1-9`).
- **No staleness threshold on `updatedAt`.** AC 3 demands it, and `machine.ts:21-24` already
  states that nothing in the state machine decays with age; age is a list concern (`isTrayWorthy`).
- **`updatedAt` accepts epoch-ms *and* ISO-8601 strings**, normalised to ms, `null` when
  unparseable — the field is unobserved on any current version, so the parser must not bet on
  one encoding. Same reason for trimming/lowercasing the `status` value.
- **Provenance is `statusSource: 'reported' | 'inferred'`** on `DeriveResult` and `SessionView`,
  not a boolean — it names the two cases AC 5 asks the pane to distinguish and leaves room for a
  third source (hooks) without a type break.
- **The reported facts travel on `LiveSessionRef`, not through a new engine lookup.** `ref`
  already carries every registry fact into `toView` (`engine.ts:385-421`), which keeps
  `deriveStatus` a pure function of its input.
- **The detail pane shows the marker only when the status is reported**; its absence means
  inferred (with a `title` tooltip saying so). A permanent "inferred from transcript" row would
  be noise on 100% of sessions on every version shipped today.
- **A reported `waiting` notifies and badges like an inferred one** — it is the *more* reliable
  form of the same condition, so suppressing it would be backwards.
- **`deriveHistoricalStatus` is untouched.** Registry files exist only for live sessions, so a
  finished transcript can never have a reported status.
- **No runtime IPC schema change needed** — `src/shared/ipc.ts` re-exports the `SessionView`
  type and `src/main/ipc.ts` passes it through without validation, so the type edit suffices.

## Plan

Four small steps, docs first, then core → renderer.

1. **Docs (D1).** `docs/RESEARCH.md` §1 (lines 12-47) gets a negative finding in the section's
   existing style (bold lead, **Verification:**, **Unverified:**): which three fields were looked
   for (`status`, `waitingFor`, `updatedAt`), that all were absent in all 10 live session files,
   measured 2026-08-13 on Claude Code `2.1.228`/`2.1.229`, plus the caveat that all 10 samples were
   `entrypoint: claude-vscode`. `docs/CONCEPT.md` §12 (the `| Item | Position |` table, lines
   562-574) gets one row: an authoritative upstream status field would supersede the §6.2
   derivation for the states it covers.
2. **Registry (D2).** `parseRegistryEntry` (`registry.ts:66-104`) currently copies only known keys.
   Add three optional reads — `reportedStatus`, `waitingFor`, `reportedAt` — to `RegistryEntry`,
   using the existing `str()`/`num()` helpers plus a new date coercion. Carry them onto
   `LiveSessionRef` (`types.ts:23-39`) and the mapping in `adapter.ts:129-141`.
3. **State machine (D3).** `DeriveInput` gains an optional `reported` block; `deriveStatus`
   inserts one rule directly after the `!alive` guard (`machine.ts:56-58`) and before the
   `facts.last` handling: reported status `waiting` → `waiting`, reason naming the agent and the
   `waitingFor` text, `statusSource: 'reported'`. Every other path returns `'inferred'`.
   `DeriveResult` and `SessionView` gain `statusSource`; `engine.ts:385-421` passes `ref` through
   and copies it.
4. **Surface (D4).** `SessionDetailPane.tsx:66-68` renders the marker next to status + reason;
   `src/cli/index.ts:171` adds it to the verbose `why:` line so the manual smoke test is checkable.

## Deliverables

- [x] **D1 — Negative finding in the record.** `docs/RESEARCH.md` §1 gains the "fields looked for,
      absent, on these versions, with this entrypoint caveat" block; `docs/CONCEPT.md` §12 gains
      the superseding-source row. Files: `docs/RESEARCH.md`, `docs/CONCEPT.md`.
      *Acceptance:* both sections name the three fields, the two versions, the date and the
      `claude-vscode`-only caveat; §12's row points at §6.2.
- [x] **D2 — Registry parses the optional fields.** `reportedStatus` (trimmed/lowercased),
      `waitingFor`, `reportedAt` (epoch-ms or ISO, else null) on `RegistryEntry`, carried through
      `LiveSessionRef` and the adapter mapping. Builder + tests extended.
      Files: `src/core/registry/registry.ts`, `src/core/model/types.ts`,
      `src/core/adapters/claude/adapter.ts`, `test/fixtures/builders.ts` (extend
      `registryEntry(...)`, line 324), `test/unit/pipeline.test.ts`.
      *Acceptance:* a fixture with the three fields parses them; a fixture without them yields the
      exact same `RegistryEntry` as today plus three `null`s; junk values become `null`, never throw.
- [x] **D3 — Highest-priority reported rule + provenance.** New rule in `deriveStatus` ahead of all
      transcript rules, `statusSource` on `DeriveResult` and `SessionView`, wired in `toView`.
      Files: `src/core/state/machine.ts`, `src/core/model/types.ts`, `src/core/engine.ts`,
      `test/unit/machine.test.ts` (mirror the existing `describe('deriveStatus', ...)` cases, line 310).
      *Acceptance:* `status: "waiting", waitingFor: "permission prompt"` on a transcript that would
      otherwise derive `working`/`done` yields `waiting`, `statusSource: 'reported'`, a reason
      naming Claude Code and the `waitingFor` text, and is unaffected by how old `reportedAt` is;
      `!alive` still yields `ended`; every existing machine/pipeline test passes unchanged and
      reports `statusSource: 'inferred'`.
- [x] **D4 — Provenance visible.** Detail pane shows a "reported by Claude Code" marker on the
      status line when `statusSource === 'reported'` (with a tooltip; absent = inferred); CLI
      verbose `why:` line carries the same distinction.
      Files: `src/renderer/components/SessionDetailPane.tsx` (line 66-68),
      `src/cli/index.ts` (line 171). Mirror the existing `STATUS_HINT`/`title` pattern in the pane.
      *Acceptance:* with a reported session the pane shows the marker, with an inferred one it does
      not; `npm run cli -- -v` prints the source either way.

## Model Hints

- D1 → default (documentation edit, no code risk)
- D2 → default (additive parsing next to existing `str()`/`num()` helpers)
- D3 → **deliverable-hard** — the new rule sits ahead of the *entire* existing derivation cascade
  and must leave every current verdict byte-identical (AC 4) while threading a new field through
  machine → engine → view; that is the one real regression surface in this story.
- D4 → default (two small render/format sites)
- Review: → default — the diff is small and well specified, and its main risk (changed existing
  verdicts) is already fenced by the existing machine/pipeline fixture suite.

## Test Plan (manual acceptance)

The field does not exist on any shipped Claude Code version, so it has to be simulated. The app
resolves its data dir via `CLAUDE_CONFIG_DIR` (`src/core/adapters/claude/paths.ts:19-34`), and a
registry entry with `procStart: null` passes the liveness check for any live PID
(`src/core/registry/liveness.ts:41`).

1. Create a fake dir, e.g. `%TEMP%\cc-fake\sessions\<PID>.json`, where `<PID>` is any process that
   is actually running (e.g. the current shell). Content: `pid`, `sessionId`, `cwd` (an existing
   directory), `name`, `entrypoint: "claude-vscode"`, `startedAt` (epoch ms), `procStart: null`,
   and `"status": "waiting", "waitingFor": "permission prompt", "updatedAt"` set to *two hours ago*.
2. `CLAUDE_CONFIG_DIR=%TEMP%\cc-fake npm run dev` — the tray app starts against the fake dir.
3. Open the popover and select that session. **Expected:** status `needs you?`, the reason names
   Claude Code and "permission prompt", and the detail pane shows the "reported by Claude Code"
   marker — despite `updatedAt` being two hours old and despite there being no transcript.
4. Remove the three fields from the JSON, restart. **Expected:** the marker is gone and the status
   is whatever the transcript rules say (`unreadable`/`no prompt yet` for this fake session).
5. Restart against the real `~/.claude` with no override. **Expected:** the popover looks exactly
   as it did before this story — no markers anywhere.

## Done

**Summary.** RESEARCH.md §1 and CONCEPT.md §12 now record the negative finding (three fields
absent in all 10 live sessions, Claude Code `2.1.228`/`2.1.229`, `claude-vscode`-only caveat).
`RegistryEntry`/`LiveSessionRef` carry three new optional fields (`reportedStatus`,
`waitingFor`, `reportedAt`), parsed defensively (junk → `null`, never throws). `deriveStatus`
gained one rule ahead of the whole cascade: a reported `waiting` wins unconditionally (no
staleness check), everything else stays inferred; every `DeriveResult`/`SessionView` now
carries `statusSource: 'reported' | 'inferred'`. The detail pane shows a "reported by Claude
Code" badge only when reported; the CLI's verbose `why:` line states the source either way.

**Decisions.**
- Field semantics exactly as scoped in the story's sprint Decisions: only `waiting` overrides,
  `idle` unmapped, `!alive` still wins, no staleness threshold on `reportedAt`, epoch-ms/ISO
  accepted for `updatedAt`, provenance is a string union not a boolean.
- `ageMs` on the new reported-waiting branch is set from `facts.last`'s age when a transcript
  exists (else `null`), rather than always `null` — harmless, since nothing outside
  `machine.ts` consumes `ageMs` for this branch; kept as the reviewing agent found no issue.
- Live smoke was driven through `npm run cli -- -v` against a faked `CLAUDE_CONFIG_DIR`
  (a real, currently-alive Windows process supplied its PID so the liveness check passes) —
  the project's own profile says GUI automation is unavailable for this Electron tray app and
  acceptance is CLI-output-based. Verified: (1) `status: "waiting", waitingFor: "permission
  prompt", updatedAt` two hours old → CLI prints `needs you?`, reason names Claude Code and
  "permission prompt", tagged "(reported by Claude Code)", despite the stale `updatedAt` and no
  transcript; (2) removing the three fields → session derives `starting` ("no prompt yet"),
  `statusSource: 'inferred'`, no reported marker — exactly what the story's Test Plan predicts.
  The actual popover badge (`SessionDetailPane.tsx`) was not visually screenshotted (no browser
  automation for the native tray window); its conditional-render logic was read and confirmed
  by the clean-agent review and by a green `npm run build` (which typechecks the `.tsx`).
- One cosmetic-only review note: `SessionDetailPane.tsx`'s new badge references a CSS class
  (`status-source-badge`) with no matching stylesheet rule yet — left unfixed, since it does not
  affect the DOM-visible distinguishability the acceptance criterion asks for, and adding
  bespoke styling was out of this story's scope.

**Verification.** `npm run build` (includes typecheck): clean. `npm test`: 150/150 passed.
`npm run typecheck`: clean, standalone. Clean-agent review: PASS, no findings requiring a fix
(one cosmetic note above). Manual/live smoke: passed via CLI as described above; steps 1-4 of
the story's own Test Plan were executed, step 5 (real `~/.claude`, no override) is covered by
the byte-identical-fixtures acceptance criterion and by the unaffected shape of every existing
test.

**Commit message.**
```
001: reported registry status field overrides waiting, with provenance
```
