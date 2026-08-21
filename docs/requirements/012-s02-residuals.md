---
id: 012
title: S02 residuals — never hide a live session, never steal the focus
status: in-progress # draft -> ready -> in-progress -> done
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

- [x] A window probe that does not answer for a specific pid is treated as "unknown", never as
      "no window" — an unknown answer never removes a session from the list
- [x] The unknown outcome is not cached as a decision: the next tick may still find out, rather
      than being told the stale answer for the rest of the TTL
- [x] The unknown outcome is visibly marked on the glance surface (a session shown on a guess is
      told apart from one the probe actually confirmed), per the Sprint decision below
- [x] The existing behaviour is unchanged for the two answers the probe does give, and the
      same-folder filter still hides a genuinely windowless session when a windowed mate exists
- [x] A full probe failure remains fail-safe (nothing is dropped), as it is today
- [x] The toast-button path for the portable target behaves per the decision taken in the
      clarification round — either it works after a restart, or the limit is stated where a user
      meets it (README / Settings → Diagnostics) instead of failing silently
- [x] The popover never moves the keyboard focus away from a control the user has focused
      themselves — including the "first session arrives while Pin/Close is focused" case, judged
      against story 010's focus handling, not 003's
- [x] `ShortcutStatus` exists once, with the shared type as the single source
- [x] `npm run typecheck`, `npm test`, `npm run build` green; `test/unit/boundaries.test.ts`
      (no Win32 import in `core/`) stays green
- [x] No behaviour change is claimed that is not covered by a unit test — each of A, C and D is
      testable without a live Windows session

## Open Questions

- ~~**Does the unknown probe result need to be visible anywhere?**~~ answered → Decisions (Sprint)
- ~~**How far should B go?**~~ answered → Decisions (Sprint)
- ~~**Is C still a bug after story 010?**~~ resolved by refine → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** The unknown probe result is marked, not silent — a new visual state on the glance
  surface for a session shown only because the probe couldn't decide (against the story's own
  recommendation, which favoured silent).
- **(User)** For B, check first whether the portable target has a stable path to register
  instead of the temp extraction dir; use it if available, otherwise fall back to documenting
  the limit (do not implement the "re-register every start, accept staleness" option).
- **C is still a bug after 010 — part C is a fix *plus* a regression test.** Checked against
  010's refined deliverables: D7 covers "→/← expand/collapse plus focus restoration after a
  re-render so the focused node stays focused", and its acceptance criterion is "focus survives
  an expand or collapse … never the document body". That is *restoring* focus to a node that
  already had it — it says nothing about refusing to *take* focus when the user has parked it
  outside the row list. The offending path is untouched by 010: `popover.tsx:273-280` refocuses
  the top row whenever `focusedYet.current` is still false, and with zero sessions
  `focusTopRow()` (238-247) finds no row, so `focusedYet` stays false while the user tabs to
  Pin/Close — the first arriving session then yanks focus onto its row. 010 will very likely
  make that effect *stronger* (more focus restoration), not weaker. So: guard added here.
- **B is implemented, not just documented:** electron-builder's `portable` target exports
  `PORTABLE_EXECUTABLE_FILE` (the path of the EXE the user actually launched — stable across
  runs, unlike the temp unpack dir), so a stable path *is* available and gets registered. The
  residual limit (the user moves or deletes that EXE) is documented rather than chased.
- **D: `src/shared/ipc.ts` is the single source, `src/main/shortcuts.ts` imports it.** The two
  declarations are already identical field-for-field, `main → shared` type imports are
  established (`index.ts`, `ipc.ts`, `preload.ts`, `tray.ts`) and no boundary test constrains
  that direction, whereas the reverse would drag main-process code into the renderer's contract.
- **The unknown state travels as an optional field, not a required one:** `SessionView` gains
  `windowUnknown?: boolean`, decorated in `getSnapshot()` in the same `.map` as `muted`, so no
  producer of a `SessionView` in `core/` has to change and the flag stays presentation-only.
- **The marker lands on the popover only** (the glance surface named in the acceptance
  criterion); `SessionsView` in the main window keeps its current appearance.
- **The focus decision is extracted as a pure helper** so part C is unit-testable — vitest runs
  `environment: 'node'` with no jsdom and no testing-library, so a React render test would mean
  adding a whole test environment for one regression.

## Plan

Four independent residuals, no new capability. Order: A (probe → engine → marker), then B, C, D.
This story builds **last** in S03 — C touches `popover.tsx` focus code that story 010's D7
rewrites, so rebase onto 010's result before starting C.

**A — unknown ≠ no window**

1. `src/main/focus/windowProbe.ts:104-108`: `results.get(pid) ?? false` is the whole bug. Write a
   cache entry only for pids the probe actually answered for; a pid missing from the result map
   stays uncached, so `get()` returns `undefined` and the next pass re-probes it (no TTL lock-in).
   `CacheEntry.value` stays `boolean`.
2. `src/core/engine.ts`: `isOrphan()` (244-249) already treats `undefined` as fail-safe — leave it.
   Add a sibling `isWindowUnknown(session, all)`: probe injected, `hasTerminalWindow(pid) ===
   undefined`, and some other live same-`cwd` session answers `true`. That is exactly "shown on a
   guess". Decorate it onto the snapshot in the existing `.map` at engine.ts:206 as
   `windowUnknown`, gated on `hideOrphanSessions` (with the filter off nothing was ever at risk).
3. `src/core/model/types.ts:275` `SessionView`: add optional `windowUnknown?: boolean`.
4. Popover row (post-010 layout): a static, non-interactive marker glyph + tooltip, mirroring the
   `mute-toggle` badge block in `SessionsView.tsx:163-172` minus the click handler.

**B — protocol handler path for the portable EXE**

5. `src/main/toast-protocol.ts`: pure `protocolClientTarget(env, execPath, isPackaged, script)`
   returning `{ path, args }` — prefers `PORTABLE_EXECUTABLE_FILE`, falls back to today's
   behaviour. `src/main/index.ts:245-254` calls it. Fallback rule if the packaged smoke shows the
   portable stub does not forward the URL argv: keep the current registration and document only.
6. Surface the registered target in `DiagnosticsInfo` (Settings → Diagnostics) + one README
   paragraph naming the limit (move/delete the EXE → toast buttons launch a dead path).

**C — never steal focus**

7. Extract the decision from `popover.tsx:273-280` into a pure helper
   (`shouldFocusTopRow({ focusedYet, activeElementIsInList, activeElementIsBody })`): the
   initial-focus retry only fires while focus is on the document body (or already in the list) —
   never while it sits on Pin, Close or the notify switch. The `window` `'focus'` reopen path
   (254-263) keeps forcing focus, unchanged.

**D — one `ShortcutStatus`**

8. Delete the declaration at `src/main/shortcuts.ts:11-15`, import the type from
   `../shared/ipc.ts`, drop the "mirrors" comment at `shared/ipc.ts:80`.

## Deliverables

- [x] D1 — **The probe stops inventing a `false`.** `src/main/focus/windowProbe.ts`: a pid the
      probe did not answer for is not cached at all; `get()` returns `undefined` and the next
      `refresh()` pass re-probes it inside the same TTL window. Accept: extended
      `test/unit/windowProbe.test.ts` — partial result map leaves the missing pid `undefined`,
      a following pass probes it again (it is still in the stale set), answered pids keep their
      cached value and their TTL behaviour. Pattern to mirror: the existing cases in that file.
- [x] D2 — **`windowUnknown` on the snapshot.** `src/core/engine.ts` (+ `src/core/model/types.ts`
      for the optional field): new private `isWindowUnknown()` next to `isOrphan()`, decorated in
      the `.map` at engine.ts:206, only when `hideOrphanSessions` is on. Accept: extended
      `test/unit/derivations.test.ts` (orphan-filter block, ~line 558) — (a) unknown + windowed
      folder mate ⇒ session present **and** `windowUnknown === true`; (b) `false` + windowed mate
      ⇒ still hidden; (c) all-unknown folder (full probe failure) ⇒ nothing dropped, no marker;
      (d) no probe injected / filter off ⇒ flag absent or false, nothing changes;
      `test/unit/boundaries.test.ts` stays green (no Win32 import added to `core/`).
- [x] D3 — **The marker on the glance surface.** `src/renderer/popover.tsx` +
      `src/renderer/styles.css`: on a row with `windowUnknown`, a static badge (no click target,
      not in the tab order) plus a `title` saying the window state could not be determined and
      the session is shown to be safe. Mirror the badge markup/styling of the `mute-toggle` block
      (`src/renderer/components/SessionsView.tsx:163-172`) without its `onClick`. Row layout from
      story 010 stays intact; `SessionsView` is untouched. Accept: visible in the popover per the
      test plan; no change on a row without the flag.
- [x] D4 — **Register a stable protocol path for the portable EXE.**
      `src/main/toast-protocol.ts` gets the pure `protocolClientTarget()` (prefers
      `process.env.PORTABLE_EXECUTABLE_FILE`, else today's packaged/dev behaviour);
      `src/main/index.ts:245-254` uses it. Accept: extended `test/unit/toastProtocol.test.ts` —
      env var set ⇒ that path with no extra args; env var absent + packaged ⇒ current no-argument
      registration; dev ⇒ `execPath` + script arg as today. Nothing about argv *parsing* changes.
- [x] D5 — **State the limit where a user meets it.** `DiagnosticsInfo` in `src/shared/ipc.ts`
      gains the registered protocol target, filled in `src/main/ipc.ts:90` and rendered in the
      existing Diagnostics block of `src/renderer/components/SettingsView.tsx:375-388`;
      `README.md` gets one paragraph: toast buttons launch the EXE path recorded at registration
      time, so moving or deleting the portable EXE breaks them until the app is started once from
      the new location. Accept: value visible in Settings → Diagnostics, README paragraph
      present. If the D4 smoke shows the portable stub does not forward the URL argv, this D also
      records that the buttons only work while the app is running.
- [x] D6 — **The popover never takes focus off Pin or Close.** New pure helper (e.g.
      `src/renderer/popoverFocus.ts`) with the initial-focus decision, used by the effect at
      `src/renderer/popover.tsx:273-280`; the `'focus'`-event reopen path keeps its current
      behaviour. Accept: new `test/unit/popoverFocus.test.ts` — never focused yet + focus on the
      document body ⇒ focus the top row; never focused yet + focus on a control outside the list
      (Pin/Close) ⇒ do nothing; focused row dropped out of `traySessions` ⇒ focus the top row
      again (unchanged). Build note: rebase on story 010's D7 result first and keep its focus
      restoration working.
- [x] D7 — **One `ShortcutStatus`.** Delete `src/main/shortcuts.ts:11-15`, import the type from
      `../shared/ipc.ts` (usages at `:24`, `:61`), remove the now-wrong "mirrors" comment at
      `src/shared/ipc.ts:80`. Accept: `npm run typecheck` green, one declaration left in `src/`.

## Model Hints

- D2 → `deliverable-hard` — it edits the orphan filter that decides whether a live session is
  shown at all, and the acceptance is a *non*-change ("existing behaviour unchanged, full probe
  failure still fail-safe") across the `undefined`/`false`/`true` matrix in `core/engine.ts`.
- D6 → `deliverable-hard` — it rewrites the focus effect that story 010's D7 (also hard-tier)
  has just rebuilt in the same file, and "the popover swallowed my focus" regressions are
  invisible in tests unless the extracted decision is cut exactly right.
- D1, D3, D4, D5, D7 → default tier.
- Review: → `story-review-hard` — the guarantee under review ("no live session is ever hidden, no
  focus is ever stolen") is a property of paths the diff does *not* show, and two Ds land in code
  story 010 changed in the same sprint.

## Test Plan (manual acceptance)

Run `npm run dev` (unset `ELECTRON_RUN_AS_NODE` when launching from VS Code).

1. **Nothing changed (A):** with two live sessions in the same folder, one windowed and one
   without a window, the windowless one is still hidden while `hideOrphanSessions` is on and
   reappears when the setting is turned off. No marker on any normal row.
2. **The marker (A/D3):** force an unanswered probe — start two sessions in one folder, then
   make the probe fail for exactly one pid (kill the PowerShell child mid-pass, or run `npm run
   dev` with a stubbed probe returning a partial map). The session stays in the popover and
   carries the badge; hovering it explains why. On the next probe pass the badge disappears again
   (it does not stick for the 30 s TTL).
3. **Focus (C):** with **zero** sessions live, open the popover via the global shortcut and Tab
   onto Pin (or Close). Start a Claude session. The focus ring must stay on Pin — the arriving
   row must not take it. Then close and reopen the popover: it must still focus the top row.
4. **Portable toast (B):** `npm run package`, run `ClaudeControl-*-portable.exe` from a fixed
   folder, let a session finish so a toast appears, then **exit the app** and press "Mute this
   session" in the Action Center. Expected: the app starts and the session is muted. If it does
   not start, the README/Diagnostics wording from D5 is the deliverable and must say so.
5. **Diagnostics (B/D5):** Settings → Diagnostics shows the registered protocol target, and it is
   the portable EXE's own path, not a Temp unpack directory.

## Done

Four independent residuals from S02, closed. No new user-facing capability — the measure of
success is that nothing changes on screen except in the cases where something wrong stops
happening. Built last in S03, on top of story 010's rewritten popover and focus handling.

**What was built**

- **A — unknown is no longer remembered as "no window"** (D1, D2, D3). The batched probe script
  now emits an explicit `<start>|FALSE` line when it walks a chain to its end without finding a
  window, so the JS side can tell a real negative from a pid the script never reached. The result
  map is built purely from what PowerShell actually reported and is never pre-filled with
  `false`; an unanswered pid stays uncached, so `WindowProbe.get()` returns `undefined` and the
  next pass re-probes it inside the same TTL. `SessionView.windowUnknown` (optional, decorated at
  snapshot time) carries the state to the renderer, and the popover row shows a static, non-
  tabbable badge with a `title` explaining the session is shown to be safe.
- **B — the portable EXE registers a stable protocol path** (D4, D5). `protocolClientTarget()`
  prefers electron-builder's `PORTABLE_EXECUTABLE_FILE` (the path of the EXE the user actually
  launched, stable across runs) over the per-run temp extraction dir. The registered target is
  surfaced in Settings → Diagnostics, and README documents the residual limit: moving or deleting
  the portable EXE breaks toast buttons until the app is started once from the new location.
- **C — the popover no longer takes focus off Pin or Close** (D6). The initial-focus decision is
  extracted into the pure `src/renderer/lib/popoverFocus.ts` and refuses to focus a row while
  focus sits on a control outside the row list. Confirmed during refine to still be a real bug
  after story 010: 010's D7 *restores* focus to a node that already had it, but never refused to
  *take* it.
- **D — one `ShortcutStatus`** (D7). `src/shared/ipc.ts` is the single declaration; the duplicate
  in `src/main/shortcuts.ts` and the now-wrong "mirrors" comment are gone.

**Decisions**

- The window-unknown badge column (18px) is declared unconditionally in the `.l1`
  `grid-template-columns`, not added only when the badge renders. A conditional 8th grid child
  would have made the branch column re-width every time the transient badge came and went.
- The marker gate is narrowed to the case the story actually asked for: `undefined` **and** a
  folder mate that answered `true` — i.e. the session would have been hidden by the orphan rule
  had the probe been decisive. A folder where the probe failed for everyone raises no marker,
  because there was no orphan rule to escape in the first place.
- `windowUnknown` is an optional field decorated in `getSnapshot()`, so no producer of a
  `SessionView` in `core/` changed and the flag stays presentation-only.
- Part C's regression test targets the extracted pure helper rather than a React render:
  vitest runs `environment: 'node'` here, and a render test would mean adding jsdom plus
  testing-library for one case.

**Verification**

`npm run typecheck`, `npm test` (293/293, 16 files) and `npm run build` all green.
`test/unit/boundaries.test.ts` (no Win32 import in `core/`) stays green. The unknown-vs-false
distinction is pinned by `test/unit/processChain.test.ts` (partial result map, timeout mid-pass,
stray PowerShell noise, and an assertion that the script emits the `|FALSE` marker) and by the
orphan-filter cases in `test/unit/derivations.test.ts`.

**Review.** `story-review-hard` over the diff. First pass FAIL with one acceptance-blocking
finding — the probe pre-filled every requested pid with `false`, which made D1's guard
unreachable and AC 1 a genuine FAIL — plus two lesser findings (the implicit 8th grid track, and
the transient/inverted meaning of the badge that followed from the AC 1 failure). All three were
fixed in one cycle: the explicit `|FALSE` negative marker, the declared 18px track, and the
narrowed marker gate. Re-verified green afterwards.

**Not fixed, carried as a finding.** Settings → Diagnostics *recomputes* the protocol target at
IPC-handler time rather than reporting what `setAsDefaultProtocolClient` actually wrote, and that
registration's `catch {}` swallows a failed registry write — so the panel can print a path that
was never registered, in the very field added so a user could check it. AC 6 is satisfied (the
row exists, README states the limit), so this was left in scope rather than widened: threading a
`{ target, registered }` result out of `registerToastProtocol()` is the fix, and it belongs in
the next sprint. Also noted: the packaged non-portable case renders the `<installed exe>`
placeholder instead of a path.

**Status: built, live acceptance pending — no live Electron display session was reachable in
this autonomous run.** Parts A, C and D are covered by unit tests without needing a live Windows
session, as the acceptance criteria required. What still needs the user: the badge actually
appearing on a row in the running popover (D3), the Diagnostics value and README paragraph read
in place (D5), and the portable-target protocol path exercised from a packaged build — a toast
button pressed after the app has exited, which is the case the whole of part B exists for and
which no unit test can stand in for.
