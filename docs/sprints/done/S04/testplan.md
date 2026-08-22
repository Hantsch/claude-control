# S04 — Manual acceptance test plan

Covers the two stories built in this sprint:
[006](../../../requirements/done/006-activity-and-history-attribution.md) (activity matrix and history
attribution) and [013](../../../requirements/done/013-s03-residuals.md) (S03 residuals: reported protocol
registration, seen-aware group order, contrast fix, subagent list ARIA fix).

Both stories' own `## Done` sections say the live smoke pass was not performed (headless build
session). This plan is that pass.

## General preparation

1. From a terminal in the repo root, start the app in dev mode:
   ```powershell
   npm run dev
   ```
   **Known quirk:** if you launch this from a VS Code integrated terminal, first check that
   `ELECTRON_RUN_AS_NODE` is not set in your shell (`echo $env:ELECTRON_RUN_AS_NODE` in
   PowerShell). If it is set, clear it before running `npm run dev` — otherwise Electron silently
   runs as plain Node and the process exits with code 1 instead of showing the tray icon.
2. The app lives in the Windows tray. Left-click opens the popover; right-click opens the context
   menu; double-click opens the main window. These are the three entry points used below.
3. Test content needed for this sprint's stories:
   - **At least two Claude Code sessions running in two different watched project folders**
     (`claude` in a project folder, as you normally would — Claude Control only observes, it
     never starts sessions). Put them in different statuses (e.g. one `waiting` on a permission
     prompt, one mid-turn `working`) so the group headers show more than one status dot.
   - **Existing history**: some finished Claude Code sessions from before this test pass, ideally
     across at least two projects, two branches and (if you have used more than one model) two
     models, so the History view's grouping has more than one group per dimension to show. If you
     have none, finish a couple of the live sessions above (end the `claude` process normally) and
     they will appear in History once the index runs.
   - **A session with subagents** for the ARIA check (ask a Claude Code session to launch two or
     more subagents via the Task tool).

---

## Story 006 — Activity matrix and history attribution

### 1. Main window group header shows status counts (replaces the old line)

**Preparation:** at least two projects live, with a mix of statuses across them (e.g. one
`waiting`, one `working`, one `done`).

**Steps:**
1. Double-click the tray icon to open the main window, on the Sessions tab.
2. Look at each project group's header row.

**Expected result:** each project header shows the project name, its path, and a compact rollup of
small coloured dots with a count next to each status actually present (e.g. a red dot "1" and a
blue dot "2") — **not** the old text line `N sessions · M need attention`. A status with no
sessions in that group shows no dot at all, not a dot with `0`.

### 2. Popover looks unchanged

**Preparation:** the same two-or-more-project setup as above.

**Steps:**
1. Left-click the tray icon to open the popover.
2. Compare a project's group head here against the same project's group head in the main window
   from step 1.

**Expected result:** the popover's group head looks exactly as it did before this sprint — same
chevron, project name, "N waiting" badge (if applicable), the same rollup of dots and counts, and
the "N sessions" text on the right. The dots and counts themselves match the main window's for the
same project (same numbers, same colours, same left-to-right order), even though the popover also
keeps its own "N sessions" text that the main window's header no longer has.

### 3. Rollup colours follow the theme

**Steps:**
1. Switch Windows Settings → Personalization → Colors → "Choose your mode" between Light and Dark
   while the popover and main window are open.

**Expected result:** in both surfaces, the rollup dots recolour exactly like the ordinary status
dots on the session rows — no dot stays the "wrong" scheme's colour.

### 4. History, flat list with a token column

**Preparation:** some finished sessions already in history (see General preparation).

**Steps:**
1. Open the main window's History tab.

**Expected result:** the table looks as before (Ended / Project / Branch / Final state / Title /
Size columns), plus a new **Tokens** column. Recently-finished sessions show a token count (e.g.
`12.3k`); older entries that predate this sprint's indexing show `—` rather than `0`.

### 5. History grouping by project / branch / model

**Steps:**
1. In the History tab, use the segmented control (None / Project / Branch / Model) and click
   "Project".
2. Click "Branch", then "Model".
3. Click a group header's chevron to collapse it, then expand it again.
4. Click "None".

**Expected result:** each grouped view replaces the flat table with collapsible group headers (one
per project / branch / model value present), each showing the group name, its session count, a
per-group token total (e.g. "128.4k tokens"), and — if any entries in that group have no usable
token count — a "· N not counted" note. A "no branch recorded" / "unknown model" group, if any
entries qualify, sorts to the bottom regardless of its total. Collapsing a group hides its rows but
keeps its header visible. "None" restores the original flat table.

### 6. Grouping composes with the existing filters

**Steps:**
1. In History, set the Project filter to one specific project (and/or a date range).
2. Switch the grouping control to "Branch".

**Expected result:** only entries matching the filter appear, now grouped by branch; the per-group
totals reflect only the filtered entries, not the whole history.

### 7. Lazy fill-in of usage totals on detail open

**Preparation:** find a History row showing `—` (no total yet) or a `~`-prefixed partial total in
its group.

**Steps:**
1. Click that row to open its detail panel at the bottom of the History view.
2. Close the detail panel (or just look at the row/group again after a moment).

**Expected result:** the row's Tokens cell now shows an exact total (no `~`, no `—`), and if it was
grouped, the group's total has been recalculated to include the upgraded number.

---

## Story 013 — S03 residuals

### A — Diagnostics reports the registered protocol target

**Steps:**
1. Open the main window → Settings, scroll to the Diagnostics section.
2. Read the "Toast button target" row.

**Expected result:** in a `npm run dev` session it shows a real path in monospace (the Electron
executable plus the dev script) — never the placeholder `<installed exe>` and never blank. If you
have a packaged (non-portable) build available, the same row there shows a real executable path
too, not a placeholder.

*(A failed registration cannot be provoked from the UI — that path is covered by
`test/unit/toastProtocol.test.ts`, not this manual step. If you do see a warning-coloured "not
registered — toast buttons will not work" line, that itself confirms the failure path renders
correctly.)*

**Follow-up, functional check:** let a session reach `waiting` or `done` so a Windows toast
appears, and press a button on it (e.g. Jump). The action succeeds — confirming the path shown in
Diagnostics is the one actually in effect.

### B — Seen-aware popover group order

**Preparation:** two projects, each with one `waiting` session (e.g. two Claude Code sessions each
paused on a permission prompt, in different watched folders).

**Steps:**
1. Open the popover. Note both projects appear as groups.
2. Click project A's waiting session row once (this acknowledges/"sees" it) — a single click
   selects it and marks it seen; do not close the popover if the click alone doesn't register it,
   in which case briefly open its detail (chevron) and close it again.
3. Close the popover, then reopen it.

**Expected result:** project B — the one still lighting the tray badge — is now the top group;
project A (whose only waiting session has been seen) sits below it. Then, from the tray menu or
popover footer, use "mark all as seen" (if available) and reopen the popover: the order becomes
stable and alphabetical by project name, with nothing jumping around on repeated opens.

*Regression check:* with nothing marked seen yet (before step 2), the group order must be
identical to what it was before this sprint — the same urgency-first ordering.

### C — Contrast fix (light and dark)

**Steps:**
1. With Windows in Light mode, open the main window and click a session row so it becomes the
   selected (highlighted) row; also look at a muted session row.
2. Read the faint/secondary text in that selected row, and the muted row's body text.
3. Switch Windows to Dark mode and repeat.

**Expected result:** in both schemes, the faint text on the selected row's background and the
muted row's body text are comfortably readable — no washed-out, barely-visible grey text on either
background.

### D — Subagent list ARIA fix

**Preparation:** a session with at least two subagents, visible in the popover.

**Steps:**
1. Open the popover and expand that session's detail (chevron), so the subagent list and the
   flat-hierarchy note below it are both visible.
2. Turn on Windows Narrator (Win+Ctrl+Enter) and navigate into the subagent list.

**Expected result:** the flat-hierarchy note still sits visually below the last subagent row,
wording unchanged. Narrator announces a list item count that matches exactly the number of
subagent rows rendered — the note itself is not counted as one of the list items.

*(If a screen reader is not available, an accessibility inspector — e.g. Chrome/Electron DevTools'
Accessibility pane on the popover's `role="list"` element — can confirm the same thing: the list
node's children are exactly the subagent rows, with the note as a sibling outside it.)*

---

## Gaps and things this plan cannot verify

1. **013-A failure wording.** A blocked Windows Registry write cannot be provoked from the UI on
   demand; the "not registered — toast buttons will not work" rendering is accepted by
   `test/unit/toastProtocol.test.ts`, not by this manual pass. Only the success path (a real path
   shown, and the toast button working) is checked live above.
2. **013-A packaged non-portable path.** Confirming the field shows `process.execPath` rather than
   a placeholder on a genuinely *installed, non-portable* build requires a build/install this plan
   does not produce; the portable/dev-mode case is checked instead, which already proves the
   placeholder string is gone.
3. **006 N5 timing.** The story's `## Done` records a measured 441 ms cold start with history
   usage indexing included, against a 2000 ms budget; this is verified by `npm test`
   (`test/unit/pipeline.test.ts`), not by anything clickable — run `npm test` separately and read
   the logged figure if you want to reproduce it.
4. **006 D2/D3 "one computation" guarantee** (both surfaces render through the same
   `StatusRollup`/`statusCounts`) is a source-level property enforced by
   `test/unit/statusRollupWiring.test.ts`; this plan's steps 1–2 can only observe that the two
   surfaces currently agree, not that they are structurally incapable of drifting apart.
5. **013-C contrast** is a subjective legibility judgement, same caveat as story 007's tray badge
   check in the S03 plan — the objective pass/fail is `test/unit/theme.test.ts`'s contrast ratio
   assertions (3:1 / 4.5:1 targets), not this manual look.
6. **013-D screen reader check** inherently requires assistive technology or an accessibility
   inspector to verify, as noted in the step itself — there is no way to observe an ARIA role
   count through ordinary visual inspection.
