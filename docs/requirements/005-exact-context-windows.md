---
id: 005
title: Exact context windows — and the network promise it costs
status: in-progress # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

The context gauge exists so you can intervene before auto-compaction degrades a session. Its
denominator is currently guessed from a lookup table — the `widened` flag on `ContextPressure`
([types.ts:54](../../src/core/model/types.ts#L54)) exists precisely to admit that. The
200k-versus-1M case is where a guess stops being useful, and it is the case this project hits
daily. Both reference tools solve it the same way: LiteLLM's community-maintained
`model_prices_and_context_window.json`, which supplies each model's context window.
ClaudeSessionTray's report is worth trusting here — an earlier attempt at guessing the window
was "wrong often enough to be useless".

**The conflict to resolve before any code.** README.md and Settings → Diagnostics currently
promise the app "makes no network requests". This breaks that promise, so it cannot ship as a
silent default. It has to be an explicit opt-in with the wording updated in both places — and if
that trade is not wanted, the honest outcome is to close this story as rejected and keep
labelling the gauge an estimate. The story is not a refactor with a checkbox on top; the
decision is the story.

**Decision (user, 2026-08-22, S05 planning round): the trade is accepted.** The lookup ships as
an explicit opt-in, off by default, and the "makes no network requests" claim in README.md and
Settings → Diagnostics is reworded rather than quietly broken. A bundled snapshot of the table
was offered as the third way and declined — a table that goes stale inside a release is exactly
the "confident nonsense" the fourth acceptance criterion refuses. This unblocks M5; what is left
open below is how the opt-in presents itself and how an exact number is distinguished from a
guessed one, not whether it exists.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md),
which records the related web-dashboard rejection made on the same promise.

## Acceptance Criteria

- [x] The setting is off by default and the app makes no network request until it is turned on
- [x] Startup never waits on the network
- [x] Offline with no cache, the gauge falls back to today's estimate and stays labelled as one
- [x] **No hardcoded price/window table is added** — a stale table reports confident nonsense,
      which is worse than an admitted estimate
- [x] The cache lives under `%APPDATA%` and refreshes at most weekly, in the background
- [x] README.md and Settings → Diagnostics state what the app does when the setting is on, and
      no longer make a promise the app can break

## Open Questions

The blocking product question is answered above. What is left is for the sprint's clarification
round:

- ~~**Does the gauge say where its denominator came from?**~~ answered → Decisions (Sprint)
- ~~**A model that is not in the table.**~~ answered → Decisions (Sprint)
- ~~**A stale cache with no network.**~~ answered → Decisions (Sprint)
- ~~**Turning the switch on.**~~ answered → Decisions (Sprint)
- ~~**What Diagnostics shows once the setting exists.**~~ answered → Decisions (Sprint)
- ~~**Does the CLI honour the setting?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Exact vs. estimated labelling: the gauge, tooltip and CLI distinguish an exact
  fetched-table number from an estimated one — the marker does not just silently disappear when
  exact.
- **(User)** Model missing from the fetched table: the estimate marker stays visible on that row
  even though the setting is on, so the user does not assume every number is now exact.
- **(User)** Stale cache with no successful refresh for weeks: staleness is surfaced (see
  Diagnostics decision below), not used silently.
- **(User)** Turning the setting on: the first fetch happens immediately, inside the Settings
  interaction, rather than waiting for the next background tick.
- **(User)** Diagnostics: becomes a state line — setting on/off, cache age, last refresh outcome
  — mirroring how 013 surfaces a failed protocol registration.
- **(User)** CLI: honours the same opt-in setting from `settings.ts` — if enabled via the GUI,
  `npm run cli -- --watch` also uses/fetches the exact table.

Sprint-round decisions taken during refine (no user marker — these are mine):

- **Module home is `src/core/context/`**, not `core/pricing/` — cost tracking is explicitly out of
  scope for v1, so a folder named after prices would invite exactly the scope it excludes.
- **Pure split from IO:** `modelWindows.ts` (parse + model→window matching, no IO) and
  `windowSource.ts` (fetch, cache, refresh policy) — only the pure half is cheap to test, only the
  IO half needs a boundary exception.
- **Source URL** `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`,
  read with global `fetch` and a 10 s abort — no new dependency, and no `node:https` import that
  the N1 boundary rule would have to be widened for.
- **Only `max_input_tokens` is kept**, distilled to a `{ model: window }` map before caching: the
  raw file is megabytes of price data this story must not start carrying.
- **Matching mirrors `windowForModel`** (case-insensitive, exact → longest prefix) and additionally
  strips a `provider/` prefix from table keys, so `anthropic/claude-opus-5` resolves.
- **`ContextPressure` gains `windowSource: 'estimated' | 'exact'`** — one field every surface
  renders, so gauge, row tooltip, subagent chip and CLI can never disagree about provenance.
- **`widened` always forces `estimated`**, even with the setting on: auto-widening is a guess laid
  on top of a number, and calling that exact would be the confident nonsense AC4 refuses.
- **Setting shape `contextWindows: { useOnlineTable: boolean }`, default `false`** — no
  `SETTINGS_SCHEMA_VERSION` bump, because an absent field already merges to the default.
- **Cache file** `<userData>/model-windows.json` (`{ version, fetchedAt, source, windows }`),
  written atomically (temp + rename) mirroring [main/settings.ts](../../src/main/settings.ts).
- **Refresh policy:** ceiling of 7 days; the check runs at most every 6 h and only fires a fetch
  when the cache is older than the ceiling; a failed fetch is not retried for 1 h. Startup
  schedules the check and never awaits it (AC2).
- **A stale cache is still used** and still counts as exact — a context window does not rot the way
  a price does; its age is surfaced in Diagnostics per the user's staleness decision.
- **Toggle-on failure keeps the setting on**: the outcome is reported inline in Settings and in the
  Diagnostics state line, and the gauge stays estimated — silently flipping the user's choice back
  off would hide the failure.
- **Boundary tests are renegotiated explicitly, not deleted:** `test/unit/boundaries.test.ts` gets a
  one-file allowlist for `fetch(` (N1) and for the cache write under `core/` (N2), plus an assertion
  that the allowlisted module imports no network module and never writes below `claudeDir` — the
  read-only-towards-Claude-Code promise stays absolute.
- **CLI settings location:** the CLI reads the same persisted `settings.json`, resolving
  `%APPDATA%\Claude Control` then `%APPDATA%\claude-control` (packaged productName vs dev app name),
  overridable via `CLAUDE_CONTROL_DATA_DIR`; with no file it falls back to defaults, i.e. off.
- **`docs/CONCEPT.md` N1 and its §1 line are reworded too** — the design of record cannot keep
  claiming "no outbound requests" while the app has one; same edit, same story.
- **History is not retro-relabelled:** every surface renders the `windowSource` carried by the value
  it was handed, so stored history keeps the provenance it was computed with.

## Plan

The estimate stays as the floor; the opt-in fetched table is laid on top and every surface says
which of the two it is showing. Order matters: the promise is reworded before the network path
exists, and the boundary tests are renegotiated in the same step as the code that breaks them.

1. **Honesty first (D1).** Reword the absolute claim in `README.md`, `docs/CONCEPT.md` (N1 row +
   the §1 "never touches the network" line), the Diagnostics footer in `SettingsView.tsx` and the
   stale `disable-http-cache` comment in `src/main/index.ts`; add
   `contextWindows.useOnlineTable` (default `false`) to `core/model/settings.ts` + `mergeSettings`.
2. **Pure table (D2).** `core/context/modelWindows.ts`: parse LiteLLM JSON → `{ model: window }`
   from `max_input_tokens` only, plus a lookup mirroring `windowForModel`'s matching. No IO, no
   bundled numbers.
3. **Source + cache (D3).** `core/context/windowSource.ts`: `fetch` with abort, atomic
   `model-windows.json` under a caller-supplied data dir, 7-day ceiling / 6-h cadence / 1-h failure
   backoff, and a `ModelWindowStatus` object. Boundary test gets its narrow allowlist here.
4. **Consumption (D4).** `ContextPressure.windowSource`; `ContextWindowEstimator` takes an optional
   exact lookup; `engine.ts` (owner at `:104`, use at `:528`, re-wire in `updateSettings`) and
   `createEngine.ts` wire it from the setting. The estimate path and `widened` stickiness keep
   today's behaviour exactly.
5. **Surfaces.** D5 renderer gauge/row/subagent chip, D6 main + IPC (`cc:refresh-model-windows`,
   `DiagnosticsInfo.modelWindows`, non-blocking scheduled check), D7 the Settings checkbox +
   Diagnostics state line, D8 the CLI.

Affected files by layer: `README.md`, `docs/CONCEPT.md` · `src/core/model/{settings,types}.ts`,
`src/core/context/*`, `src/core/state/contextPressure.ts`, `src/core/engine.ts`,
`src/core/createEngine.ts` · `src/shared/ipc.ts`, `src/main/{ipc,preload,index}.ts` ·
`src/renderer/components/{ContextGauge,ContextBar,SettingsView}.tsx`,
`src/renderer/lib/subagentParts.ts` · `src/cli/index.ts` · `test/unit/boundaries.test.ts` + new
unit tests.

## Deliverables

- [x] **D1 — The reworded promise and the switch itself (no network yet).**
      `contextWindows: { useOnlineTable: boolean }` (default `false`) in
      [settings.ts](../../src/core/model/settings.ts) incl. `mergeSettings` validation; reworded
      claim in `README.md` ("What it does not do"), `docs/CONCEPT.md` (N1 row + the §1 line), the
      Diagnostics footer in
      [SettingsView.tsx](../../src/renderer/components/SettingsView.tsx) and the
      `disable-http-cache` comment in `src/main/index.ts`. Wording: no listening socket, no
      telemetry, nothing ever sent — and exactly one outbound request, only while the setting is
      on. *Accept:* the text says what the app does when the setting is on; `mergeSettings({})`
      yields `useOnlineTable: false`; a unit test covers the new field.
- [x] **D2 — Pure model→window table (`src/core/context/modelWindows.ts`, new).** Parse the LiteLLM
      payload into `{ model: window }` from `max_input_tokens` only (skip entries without it, ignore
      every price field); `lookupWindow(table, model)` case-insensitive, exact →
      provider-prefix-stripped → longest prefix, mirroring `windowForModel` in
      [contextPressure.ts](../../src/core/state/contextPressure.ts). No IO, no bundled numbers.
      *Accept:* new `test/unit/modelWindows.test.ts` with a small fixture payload covers
      `anthropic/…` keys, entries without `max_input_tokens`, and unknown model → `null`.
- [x] **D3 — Fetch + `%APPDATA%` cache (`src/core/context/windowSource.ts`, new).** `fetch` with a
      10 s abort; atomic write of `model-windows.json` into a caller-supplied data dir (mirror the
      temp+rename in [main/settings.ts](../../src/main/settings.ts)); read-on-construct;
      `refresh({ force })` honouring ceiling, cadence and failure backoff; `status():
      ModelWindowStatus` (enabled, entryCount, fetchedAt, ageMs, last outcome + message). Never
      throws, never blocks. Also narrow the two rules in `test/unit/boundaries.test.ts` to allowlist
      this one file and assert it imports no network module and never writes below `claudeDir`.
      *Accept:* new `test/unit/windowSource.test.ts` with a stubbed `fetch` and a temp dir covers
      cold fetch, cache hit inside the ceiling, forced refresh, HTTP error and offline — plus a
      green `boundaries.test.ts`.
- [x] **D4 — Consumption in core.** `ContextPressure.windowSource: 'estimated' | 'exact'` in
      [types.ts](../../src/core/model/types.ts); `pressureFor` / `ContextWindowEstimator` in
      [contextPressure.ts](../../src/core/state/contextPressure.ts) take an optional exact lookup;
      `widened` forces `'estimated'`; wiring in `src/core/engine.ts` and `src/core/createEngine.ts`
      (incl. `updateSettings`). *Accept:* with no lookup every existing pressure test still passes
      and reports `'estimated'`; with a lookup the exact window is used and reported `'exact'`; a
      widened session stays `'estimated'`.
- [x] **D5 — Renderer provenance labelling.**
      [ContextGauge.tsx](../../src/renderer/components/ContextGauge.tsx),
      [ContextBar.tsx](../../src/renderer/components/ContextBar.tsx) and
      [subagentParts.ts](../../src/renderer/lib/subagentParts.ts) render provenance both ways —
      "Exact: window from the fetched model table" against today's estimate wording; the marker
      never just disappears. *Accept:* `test/unit/subagentParts.test.ts` extended; gauge/bar title
      assertions for both values.
- [x] **D6 — Main wiring + IPC surface.** `ModelWindowStatus` and `DiagnosticsInfo.modelWindows`
      plus a `refreshModelWindows` channel in `src/shared/ipc.ts`; handler in `src/main/ipc.ts`
      (mirror the `diagnostics`/`protocolTarget` pattern at `main/ipc.ts:92`); method in
      `src/main/preload.ts`; ownership and the non-blocking scheduled check in `src/main/index.ts`,
      wired into `createEngine`. *Accept:* nothing is fetched while the setting is off; enabling
      fetches immediately inside the IPC call and resolves with the outcome; startup never awaits
      it.
- [x] **D7 — Settings UI: switch + Diagnostics state line.** Checkbox in
      [SettingsView.tsx](../../src/renderer/components/SettingsView.tsx) with an explanatory line
      (which URL, how often, that it is the only request the app makes), the inline outcome right
      after toggling on, and the Diagnostics state line "Exact context windows: on/off · N models ·
      fetched 3 d ago · last refresh ok/failed", styled like the `protocolTarget` line at
      `SettingsView.tsx:386-392` (failure uses the `warning` class). *Accept:* toggling on shows
      success or failure without leaving the tab; off reads "off — no network requests".
- [x] **D8 — CLI honours the setting.** [src/cli/index.ts](../../src/cli/index.ts) loads the
      persisted `settings.json` (resolver per Decisions; explicit flags still win), wires the window
      source into `createEngine`, and marks provenance in the `ctx=` column (`~` estimated, `=`
      exact) with a legend line. *Accept:* `test/unit/cli.test.ts` extended for both markers; with
      the setting off, no fetch happens.

**AC coverage:** off by default / no request until on → D1 + D6 · startup never waits → D3 + D6 ·
offline no cache falls back to a labelled estimate → D3 + D4 + D5 · no hardcoded table → D2 + D3
(review gate) · `%APPDATA%` cache, weekly ceiling, background → D3 + D6 · README + Diagnostics
wording → D1 + D7.

## Model Hints

- `D3 → deliverable-hard` — the app's first network path: abort/timeout, atomic cache write, three
  time-based policies (ceiling, cadence, backoff) and a renegotiated boundary test in one file; a
  wrong failure path here refetches on every tick or blocks startup.
- `D4 → deliverable-hard` — touches the estimator every session runs through: the `widened`
  stickiness and the unchanged estimate fallback are the regression risk, and `windowSource` must be
  right on both branches.
- All other Ds: default tier (text, UI wiring, CLI output).
- `Review: → story-review-hard` — the story changes two documented product promises, adds the first
  outbound request and spans core/IPC/renderer/CLI; a cheap review would check the diff, not the
  promise.

## Test Plan (manual acceptance)

Run `npm run dev` (tray app). Every step goes through the real UI.

1. **Off by default.** With a fresh settings file, open Settings → Diagnostics: "Exact context
   windows: off". Open a session's detail pane — the gauge still says *Estimate*. Nothing was
   fetched.
2. **Turning it on.** Tick the checkbox. Within seconds the inline outcome reports the table was
   fetched, and Diagnostics shows the model count and "fetched just now · ok". The gauge for a
   session on a known model now reads *Exact*; a model missing from the table keeps *Estimate*.
3. **Startup does not wait.** Quit, unplug the network, relaunch with the setting on — the tray icon
   and session list appear as fast as before; Diagnostics shows the cache age and the failed last
   refresh; the gauge keeps using the cached exact numbers.
4. **Offline with no cache.** Delete `model-windows.json` from the app's `%APPDATA%` folder, stay
   offline, relaunch: the gauge falls back to *Estimate*, Diagnostics reports the failed refresh.
   Nothing hangs and nothing toasts.
5. **CLI.** With the setting on, `npm run cli -- --watch` marks `ctx=` values `=` where exact and
   `~` where estimated; with it off, everything is `~`.
6. **Promise wording.** README "What it does not do" and the Diagnostics footer no longer claim an
   absolute "no network requests" and describe the opt-in instead.

## Done

**Summary.** All 8 deliverables implemented. The absolute "no network requests" promise in
README.md, `docs/CONCEPT.md`, and the Settings → Diagnostics footer was reworded first (D1),
alongside the inert `contextWindows.useOnlineTable` setting (default `false`). A pure
model→window parser/matcher (`src/core/context/modelWindows.ts`, D2) sits underneath the app's
first-ever network path (`src/core/context/windowSource.ts`, D3): a 10 s-aborted `fetch` of
LiteLLM's table, an atomically written `%APPDATA%` cache, and a ceiling/cadence/backoff refresh
policy, with a narrowly renegotiated `boundaries.test.ts`. `ContextPressure.windowSource` now
travels with every pressure value (D4), rendered on the gauge, bar and subagent chip (D5) and
surfaced end-to-end through main/IPC (D6), the Settings checkbox + Diagnostics state line (D7),
and the CLI's `~`/`=` markers (D8).

**Commit message:**
```
005: opt-in exact context windows from LiteLLM's table
```

**Verification:**
- `npm run typecheck` — clean.
- `npm run build` — clean (main/preload/renderer all build).
- `npm test` — 21 files, 364 tests, all passing.
- `lint` — not configured (`none` per profile).
- Clean-agent review (`story-review-hard`): verdict **PASS**, all 6 acceptance criteria
  individually confirmed PASS with file:line evidence, including the D3 risk paths (abort/timeout,
  atomic write, the three time policies, boundary-test narrowness). Two CONFIRMED findings were
  fixed and re-verified (full suite re-run, 364/364 green):
  1. Toggling the setting **off** in Settings left the Diagnostics state line showing stale
     "on · N models · …" text — fixed in `SettingsView.tsx` so the off-path also updates local
     diagnostics state immediately.
  2. D5's "gauge/bar title assertions for both values" had no coverage (no component-testing
     library in this repo) — the provenance title logic was extracted into pure functions in
     `src/renderer/lib/contextProvenance.ts` and covered by `test/unit/contextProvenance.test.ts`.

**Decisions (documented, not fixed — outside the 6 acceptance criteria):**
- Subagent chip metrics (`src/core/state/subagents.ts:86`, `pressureFor` called with no exact
  lookup) always render `'estimated'` provenance, even when the setting is on and the parent
  session's gauge for the same model reads `'exact'`. Wiring the lookup through
  `buildSubagentTree`/`toMetrics` would require threading it across `adapter.ts` and
  `summarize.ts` call sites — a larger change than D4's listed files. None of the 6 acceptance
  criteria require subagent-level exactness (they're all about the main gauge/README/
  Diagnostics/cache); the Sprint decision that "gauge, row tooltip, subagent chip and CLI can
  never disagree about provenance" is technically unmet for this one case. Left as a follow-up.
- The CLI (`src/cli/index.ts`) constructs a `WindowSource` when the setting is on but never calls
  `refresh()` itself — it only reads whatever cache the Electron app's background check already
  wrote to the shared data dir, falling back to `~` if none exists yet. The Sprint decision phrase
  "also uses/fetches the exact table" is read here as "uses the exact table (when available)"
  rather than "performs its own independent fetch" — this keeps fetch ownership single-sourced in
  the main process and avoids a second, CLI-triggered network path. If a bare CLI run before the
  app has ever fetched is a real use case, a follow-up could add an explicit `--refresh` flag.
- Minor cosmetic leftovers flagged by review but not fixed (no acceptance criterion references
  them): a stray "no network features at all" comment in `src/main/windows.ts:6` and a
  "Labelled an estimate on purpose" comment in `ContextGauge.tsx:4`, both now only partially
  accurate; and `test/unit/boundaries.test.ts`'s compensating fs-verb blocklist doesn't cover
  `*Sync`/promise-form deletion calls (the file only ever writes, never deletes, so this has no
  live impact today).

**Manual acceptance:** not performed this session — `live-smoke-required: true` applies (visible
UI surface) and this session has no way to drive the Electron tray UI. Status is left
`in-progress`; `## Test Plan (manual acceptance)` above already has the exact steps. Handing over
for a human (or a session with `npm run dev` access) to run through those 6 steps before setting
`status: done`.
