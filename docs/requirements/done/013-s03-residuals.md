---
id: 013
title: S03 residuals — report what was registered, rank what is unseen
status: done # draft -> ready -> in-progress -> done
created: 2026-08-21
---

## Requirement

Four points that S01–S03 left open in their reviews. None of them is a new capability; each is a
place where the app currently says something that is not quite true. Bundled deliberately, the
way story [012](012-s02-residuals.md) bundled S02's residuals — separately they would each
be too small to schedule and would keep being carried forward.

**A — the Diagnostics field that can lie.** Settings → Diagnostics exists so a user can check
which executable Windows will start when they press a toast button. It does not report that: it
*recomputes* the target at IPC-handler time
([ipc.ts:131](../../../src/main/ipc.ts#L131)) instead of reporting what
`registerToastProtocol()` ([index.ts:254](../../../src/main/index.ts#L254)) actually wrote, and that
registration's `catch {}` swallows a failed registry write. So the panel can print a path that was
never registered, in the very field added so the user could verify it. On a packaged
non-portable install it prints the placeholder `<installed exe>`
([ipc.ts:132](../../../src/main/ipc.ts#L132)) rather than a path at all. Found while building 012,
left in scope there because 012's own acceptance criterion was satisfied.

**B — a group can outrank the group the tray badge is about.** The badge counts *unacknowledged*
sessions in `waiting` or `done` ([aggregate.ts:43](../../../src/core/state/aggregate.ts#L43)), but the
group order ranks on raw status ([popover.tsx:601](../../../src/renderer/popover.tsx#L601), via
`STATUS_SORT_RANK`) with no special case for a session you have already seen. So a group whose
waiting session you have already looked at can sit above the group that is actually colouring the
badge — the one you opened the popover for. Open since S01; not taken in 010 because it turned out
to be shared with the tray badge rather than local to the group rollup.

**C — two contrast edges below target.** Found and deliberately not fixed in 007, to keep the
colour diff honest: `--text-faint` on `--bg-active` (2.75:1 light, 2.81:1 dark) and `.muted` body
text at `--muted-opacity: 0.6` (~4.47:1, just under 4.5:1). Both are effect tokens
([styles.css](../../../src/renderer/styles.css)), both fail the target the rest of the palette is
held to by `test/unit/theme.test.ts`.

**D — one ARIA slip.** In 010's subagent list the "flat hierarchy" note sits inside a
`role="list"` without being a `listitem`, so a screen reader announces a list item count that does
not match what it then reads out.

Background: [S03 review](../../sprints/done/S03/review.md) ("Carried into the next planning"),
[S01 review](../../sprints/done/S01/review.md) for B.

## Acceptance Criteria

- [x] Settings → Diagnostics shows the protocol target that was actually registered at startup,
      not one recomputed on request — if the two could differ, the panel shows the registered one
- [x] A registration that fails is visible as a failure instead of being silently reported as a
      path
- [x] On a packaged non-portable install the field shows a real path or an explicit, truthful
      wording — not the `<installed exe>` placeholder
- [x] With one already-seen waiting session and one unseen one in different projects, the group
      the tray badge is counting is the one at the top of the popover
- [x] Ranking still ends up identical to today when nothing has been seen yet, and is covered by a
      test that fails on the old behaviour
- [x] `--text-faint` on `--bg-active` and `.muted` body text both meet the contrast target the
      theme test enforces for the rest of the palette, in both schemes
- [x] The subagent list announces the same number of items to a screen reader as it renders

## Open Questions

- ~~**Does a failed protocol registration need to be visible outside Diagnostics** — a warning row
  in Settings, or is the Diagnostics field enough? (Toast buttons are the only thing affected, and
  the app is otherwise fully usable.)~~ answered → Decisions (Sprint)
- ~~**Where does the seen/unseen ranking belong?** Only in the popover's *group* order (narrow, the
  observed symptom), or in `compareSessions` itself — which every surface sorts by, including the
  main window's session list, and which would therefore also reorder rows inside a group?~~
  answered → Decisions (Sprint)
- ~~**Is "seen" the same thing the badge means?** The badge counts unacknowledged `waiting`/`done`.
  Should the ranking use exactly that acknowledgement flag, or the popover's own "seen" notion if
  those differ?~~ answered → Decisions (Sprint)
- ~~**Contrast fix scope:** raise `--text-faint` / `--muted-opacity` in *both* schemes — which
  changes the dark theme that was already accepted twice — or only in the light branch, leaving
  dark's 2.81:1 as is?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** A failed protocol registration only needs to be visible in the Diagnostics field —
  no separate warning row elsewhere in Settings.
- **(User)** The seen/unseen ranking fix is scoped narrowly to the popover's group order, not
  `compareSessions` itself — the main window's session list is unaffected.
- **(User)** "Seen" for the ranking is exactly the badge's acknowledgement flag, not a separate
  popover-local notion.
- **(User)** The contrast fix raises `--text-faint` on `--bg-active` and `.muted` body text to
  the target in both the light and dark schemes.
- The Diagnostics field carries a **structured** registration record (`registered` / `failed` /
  `unsupported` plus path), not a formatted string — otherwise the renderer cannot tell a failure
  from a path.
- The record is produced by the *real* registration call in `index.ts` (including
  `setAsDefaultProtocolClient`'s boolean return and any thrown error) and threaded through
  `IpcDeps`; `describeProtocolTarget()` in `ipc.ts` is deleted — "reported, not recomputed" is the
  criterion.
- On a packaged non-portable install the reported path is `process.execPath`, because that is
  exactly what `setAsDefaultProtocolClient(scheme)` registers — a real path instead of a
  placeholder.
- A failed registration renders inside the existing Diagnostics list as a warning-coloured value
  ("not registered — toast buttons will not work"), reusing the `.hint.warning` colour; no new row,
  per the user decision above.
- Group rank scans **all** sessions of a group for the lowest effective rank instead of using
  `sessions[0]`: within-group order stays `compareSessions`, so a seen `waiting` can still be the
  group's first row while an unseen `done` sits behind it.
- A seen `waiting`/`done` session is demoted to the bottom of the rank scale (below `ended`),
  waiting-before-done preserved among the demoted — the badge does not count it at all, so the
  group order should not let it lead either.
- The comparator is one pure exported function next to the shared group code story 006 landed
  (`src/core/state/aggregate.ts` unless 006 chose another shared module), and `popover.tsx` is its
  only caller — the narrow scope is enforced by the call site, not by a copy.
- The contrast fix moves `--text-faint` in both schemes rather than `--bg-active`: `--bg-active` is
  already used as a parity threshold in `theme.test.ts`, so moving it would shift other checks.
- Targets: `--text-faint` at least 3:1 on `--bg-active` (the file's target for dimmed text) and
  `.muted` body text at least 4.5:1 on every surface — dark's `--muted-opacity: 0.7` already clears
  that (6.8:1), light's `0.6` (4.09:1 worst) does not.
- `theme.test.ts` gains a both-schemes block for exactly these two and loses the "deliberately not
  asserted" exemption in its header comment — that exemption is what would let the fix rot again.
- The ARIA fix moves the flat-list note **out of** the `role="list"` element rather than labelling
  it a `listitem`: it is a note about the list, not a member of it.
- The failed-registration path is accepted by unit test, not by the manual plan — a blocked
  registry write cannot be provoked reliably from the UI; the field itself is accepted through the
  real Settings UI.

## Plan

Four independent fixes, in the order A → C/D → B. B lands last because story 006 rewrites the
popover group-order area first in this sprint — read the post-006 state of `popover.tsx` and of the
shared group module before touching it, do not assume the pre-006 layout described above.

**A — Diagnostics reports what was registered** (`src/main/toast-protocol.ts`,
`src/main/index.ts`, `src/main/ipc.ts`, `src/shared/ipc.ts`,
`src/renderer/components/SettingsView.tsx`)

1. `toast-protocol.ts`: add `ProtocolRegistration` (`{state:'registered', path, args}` |
   `{state:'failed', path, reason}` | `{state:'unsupported'}`) plus a **pure** builder mapping
   platform + `protocolClientTarget()` result + outcome to that record.
2. `index.ts`: `registerToastProtocol()` returns the record — captures the boolean from
   `setAsDefaultProtocolClient`, turns a `false` or a thrown error into `failed`, and reports
   `process.execPath` when no explicit target path was passed. `bootstrap()` keeps the record and
   hands it to `registerIpc` via `IpcDeps`.
3. `ipc.ts`: the `IPC.diagnostics` handler returns that record; `describeProtocolTarget()` and the
   `protocolClientTarget` import go away. `DiagnosticsInfo.protocolTarget` changes type in
   `shared/ipc.ts`.
4. `SettingsView.tsx`: renders the path (mono), a warning-coloured failure line, or
   "n/a — Windows only".

**C — contrast** (`src/renderer/styles.css`, `test/unit/theme.test.ts`): darken light
`--text-faint` and lighten dark `--text-faint` until both clear 3:1 on `--bg-active` (about
`#74747b` light, `#7d7d85` dark — the test picks the final value, not the eye); raise light
`--muted-opacity` from 0.6 to ~0.65. Assert both, in both schemes, and drop the exemption from the
file's header comment.

**D — ARIA** (`src/renderer/popover.tsx`, `src/renderer/styles.css`): `role="list"` wraps only the
`SubagentRow`s; the flat-list note becomes a sibling below the list, CSS selector follows.

**B — seen-aware group order** (shared group module, `src/renderer/popover.tsx`, unit test):
export `popoverGroupRank(group)` = the minimum over the group's sessions of
`STATUS_SORT_RANK[status]`, where a session with `seen && needsAttention(status)` is instead ranked
below `ended` (bottom of the scale, waiting before done). `popover.tsx` sorts groups by that rank,
then by project name — replacing the `sessions[0]!.status` lookup.

## Deliverables

- [x] **D1 — protocol registration record (pure).** `ProtocolRegistration` type + pure builder in
  `src/main/toast-protocol.ts`; tests in `test/unit/toastProtocol.test.ts` (mirror the existing
  `protocolClientTarget` describe block). *Accepted when:* non-Windows → `unsupported`;
  portable / dev → `registered` with the explicit path and args; packaged non-portable →
  `registered` with `process.execPath`, and the string `<installed exe>` appears nowhere in `src/`;
  a `false` return and a thrown error both → `failed` with a reason.
- [x] **D2 — report it instead of recomputing it.** `src/main/index.ts` (registration returns the
  record, `bootstrap` threads it), `src/main/ipc.ts` (`IpcDeps` gains the record, handler uses it,
  `describeProtocolTarget` deleted), `src/shared/ipc.ts` (`DiagnosticsInfo.protocolTarget` retyped).
  *Accepted when:* typecheck and build are green, no `protocolClientTarget` call remains in
  `ipc.ts`, and the handler returns the record captured at startup.
- [x] **D3 — Diagnostics renders the truth.** `src/renderer/components/SettingsView.tsx` (mirror the
  existing `dl.kv` rows), `src/renderer/styles.css` only if a warning variant is missing.
  *Accepted when:* "Toast button target" shows the registered path in mono; a failure shows as a
  warning-coloured "not registered — toast buttons will not work"; non-Windows shows
  "n/a — Windows only".
- [x] **D4 — seen-aware popover group order.** Pure `popoverGroupRank` + comparator in the shared group
  module 006 landed (`src/core/state/aggregate.ts` by default), used by
  `src/renderer/popover.tsx`; test in `test/unit/derivations.test.ts` (which already covers
  `groupSessions`). *Accepted when:* with one seen `waiting` in project A and one unseen `waiting`
  in project B, B is first; with nothing seen, the order is identical to today (the test proves
  both, and the first assertion fails against the old `sessions[0]` sort); row order **inside** a
  group and `compareSessions` are untouched.
- [x] **D5 — contrast to target in both schemes.** `src/renderer/styles.css` (`--text-faint` in both
  `:root` blocks, light `--muted-opacity`), `test/unit/theme.test.ts` (new both-schemes block,
  header-comment exemption removed). *Accepted when:* the new assertions fail on the pre-fix values
  and pass after, the pinned `DARK_SEMANTIC` values are untouched, and the existing light-scheme
  suite still passes.
- [x] **D6 — subagent list announces what it renders.** `src/renderer/popover.tsx`,
  `src/renderer/styles.css`. *Accepted when:* `role="list"` contains exactly the rendered
  `SubagentRow`s and the flat-list note sits outside it, unchanged in wording and position.

**Coverage gate — every AC has a D**

| Acceptance criterion | Deliverable |
| --- | --- |
| Diagnostics shows the registered target, not a recomputed one | D1, D2 |
| A failed registration is visible as a failure | D1, D2, D3 |
| Packaged non-portable shows a real path, no `<installed exe>` | D1, D3 |
| Badge's group at the top with one seen / one unseen waiting | D4 |
| Ranking unchanged when nothing is seen, test fails on the old behaviour | D4 |
| `--text-faint` on `--bg-active` and `.muted` body text meet target, both schemes | D5 |
| Subagent list announces the same item count it renders | D6 |

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- **D4 → deliverable-hard** — it has to land on popover group-order code that story 006 rewrote
  earlier in this sprint and must not move the accepted 010 popover by a single row when nothing
  has been seen.
- D5 → default
- D6 → default
- **Review: → story-review-hard** — the diff touches three already-accepted stories' surfaces (007
  colour tokens, 010 popover order and subagent list, 012 toast protocol) plus an IPC contract
  change, so a regression here breaks a signed-off milestone rather than a new feature.

## Test Plan (manual acceptance)

Run `npm run dev` (Electron dev; unset `ELECTRON_RUN_AS_NODE` if launched from VS Code).

1. **Diagnostics (A):** tray → open Claude Control → Settings → scroll to Diagnostics. "Toast
   button target" shows a real path — in a dev run the Electron exe plus the script, never
   `<installed exe>` and never empty. Then trigger a toast with a button (let a session reach
   `waiting`/`done`) and press it: the session focuses, i.e. the path shown is the one that
   actually works. *(The failure wording is accepted by D1's unit test — a blocked registry write
   cannot be provoked from the UI.)*
2. **Group order (B):** have two projects with a `waiting` session each. Open the popover, click
   project A's waiting row (that acknowledges it), close and reopen the popover: project B — the
   one the tray badge is still counting — is the top group, A below it. Then use "mark all as seen"
   and reopen: the order is stable and alphabetical, nothing jumps.
3. **Contrast (C):** switch Windows between light and dark mode (Settings → Personalisation →
   Colours) with the main window and the popover open; faint text on a *selected* row (click a row
   so it takes `--bg-active`) and a muted session row are comfortably readable in both schemes.
4. **Subagent list (D):** open a session with subagents in the popover and expand it: the
   flat-list note still sits below the last subagent row, wording unchanged. With Narrator on
   (Win+Ctrl+Enter), the announced item count matches the number of subagent rows.

## Done

**Summary:** All four S01–S03 residuals fixed. Diagnostics now reports the `ProtocolRegistration`
record captured by the real `setAsDefaultProtocolClient` call at startup (`registered` / `failed`
/ `unsupported`) instead of recomputing a string on request; `describeProtocolTarget()` and the
`<installed exe>` placeholder are gone. The popover's group order now uses `popoverGroupRank()`
(`src/core/state/aggregate.ts`), which scans every session in a group and demotes an already-seen
`waiting`/`done` below `ended` — so a group the badge is no longer counting can no longer outrank
the one it is. `--text-faint` and light `--muted-opacity` were raised in both schemes to clear the
theme test's 3:1 / 4.5:1 targets, including the selected-row (`--bg-active`) case the first pass
missed. The subagent list's flat-hierarchy note is now a DOM sibling of `role="list"`, not a
non-`listitem` member inside it.

**Commit message:**
```
013: S03 residuals — reported registration, seen-aware group order, contrast, ARIA
```

**Verification:**
- Build: green (`npm run build`).
- Test: green, 320/320 (`npm test`), including new coverage in `test/unit/toastProtocol.test.ts`,
  `test/unit/derivations.test.ts`, `test/unit/theme.test.ts`.
- Typecheck: green (`npm run typecheck`).
- Lint: none configured.
- Review: one cycle. `story-review-hard` returned FAIL on AC6 only — the `.muted`-on-`--bg-active`
  (selected + muted row) case was still under 4.5:1 (4.35:1) because the fix and its guarding test
  were both scoped to the two page surfaces only, not every surface the AC's wording actually
  covers. Fixed: light `--muted-opacity` raised 0.62 → 0.65 (clears 4.5:1 on all four surfaces,
  worst case `--bg-active` at 4.69:1) and the test widened from `PAGE_SURFACES` to `SURFACES`.
  Re-verified green (build/test/typecheck) after the fix; no second review cycle requested since
  the fix is a narrow, mechanically-verified numeric change to the exact code the review flagged.
- All other review findings across D1–D6 and all 7 acceptance criteria: PASS, no scope creep, no
  weakened tests, `compareSessions` and the pre-existing attention-based group sort left untouched.
- Non-blocking note from review (not fixed, cosmetic only): moving `.flat-note` from a child of
  `.popover-subagents` to a sibling loses the 1px flex `gap` it inherited from that flex container;
  its own padding/margin still separates it from the last row, so this is a sub-pixel spacing
  change, not a behaviour or wording change, and is left for the live smoke to eyeball.

**Decisions:** all already recorded under `## Decisions (Sprint)` above; no further decisions were
needed during implementation beyond the D5 opacity value (0.65, chosen to clear 4.5:1 on every
surface rather than only the page surfaces, per the review fix above) and the exact demoted-rank
encoding in `popoverGroupRank` (`STATUS_SORT_RANK.ended + 1` for a demoted `waiting`, `+ 2` for a
demoted `done` — both below `ended` = 7, order preserved).

**Open points:** `live-smoke-required: true` applies (visible UI: Diagnostics field, popover order,
theme contrast, subagent list ARIA). This session has no way to launch and drive the Electron app
or a screen reader, so the manual `## Test Plan` below is unexecuted. Status is left `in-progress`;
manual acceptance is handed to the user.

**Live acceptance: performed by the user on 2026-08-22**, following the manual `## Test Plan`
below, as part of the S04 sprint review. Accepted — status set to `done`.
