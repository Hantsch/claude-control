# S03 — Manual acceptance test plan

Covers the four stories built in this sprint: [010](../../requirements/010-popover-drilldown.md)
(popover drill-down), [011](../../requirements/011-subagent-detail-from-result.md) (subagent
final message + declared model), [007](../../requirements/007-light-theme.md) (light theme), and
[012](../../requirements/012-s02-residuals.md) (S02 residuals: probe-unknown marker, portable
protocol path, popover focus, `ShortcutStatus` dedupe).

None of this sprint's work has had a live human pass yet — every story's own `## Done` section
says so explicitly. This plan is that pass.

## General preparation

1. From a terminal in the repo root, start the app in dev mode:
   ```powershell
   npm run dev
   ```
   **Known quirk:** if you launch this from a VS Code integrated terminal, first check that
   `ELECTRON_RUN_AS_NODE` is not set in your shell (`echo $env:ELECTRON_RUN_AS_NODE` in
   PowerShell). If it is set, `unset`/clear it before running `npm run dev` — otherwise Electron
   silently runs as plain Node and the process exits with code 1 instead of showing the tray icon.
2. The app lives in the Windows tray. Left-click the tray icon opens the popover; right-click
   opens the context menu; double-click opens the main window. These are the three entry points
   used throughout this plan.
3. Test content: you need at least one Claude Code session running in a project folder that
   Claude Control watches (see Settings → the watched directory, default `~/.claude`). Starting a
   Claude Code session is done from a terminal (`claude` in a project folder) exactly as you
   normally would — Claude Control only observes it, it never starts or drives sessions itself.
   Where a scenario needs two projects, two subagents on different models, or a permission
   prompt, that is created by what you type into that Claude Code session, not through Claude
   Control's own UI (which has no way to create any of this — it is read-only by design).

---

## Story 010 — Popover drill-down

### 1. Glance: groups expanded, sessions collapsed by default

**Preparation:** have Claude Code sessions running in at least two different watched project
folders, so more than one project group appears.

**Steps:**
1. Left-click the tray icon to open the popover.

**Expected result:** each project appears as its own collapsible group header (chevron ▶, project
name, a rollup of coloured status dots with counts, and "N sessions" on the right); a group with
at least one waiting session additionally shows an "N waiting" badge. Groups start expanded.
Under each group, session rows start collapsed (no expanded detail block visible). Each row's
first line shows, without any click: a status dot, its position number in the group, the branch
name (or the project name if there is no branch), the context cell as an absolute token count
(e.g. `49k`) coloured by band, and the model name. Sessions running longer than an hour show
`↑<duration>` in the `age` cell on the second line. If a session has subagents, the second line
shows a small pip row plus a `done/total` count (e.g. `1/3`) without needing to expand anything.

### 2. Groups: collapse / expand, single-project suppression

**Steps:**
1. Click a group header (or its chevron) to collapse it.
2. Click it again to expand it.
3. Stop all Claude Code sessions in every project but one, so only one project group remains.

**Expected result:** collapsing a group hides its session rows but keeps the header's rollup and
session count visible — a waiting session inside a collapsed group is still announced by the
rollup and the "N waiting" badge. With only one project live, there is no group header at all
(the rows appear directly under the popover title, matching story 002's original rule).

### 3. Waiting: full-width reason

**Preparation:** get a session into the `waiting` state — e.g. ask Claude Code to run a command
that needs your permission approval, and don't answer it yet.

**Steps:**
1. Open the popover and locate that session's row.

**Expected result:** the row's second line shows the full waiting reason across the entire
popover width, in the waiting colour, not truncated after a handful of words, and the popover
window itself does not get any wider than usual (`POPOVER_WIDTH` stays fixed).

### 4. Drill down: expand a session with subagents

**Preparation:** in a Claude Code session, ask it to launch two or more subagents in parallel on
different models (in the prompt you type into Claude Code, e.g. "use the Task/Agent tool to run
two subagents in parallel, each writing a short report; explicitly set one to run on the sonnet
model").

**Steps:**
1. Open the popover.
2. Click the chevron (▶) on the left of that session's row (or click the row itself is the
   jump-to-window action — use the small chevron button specifically, not the row body).

**Expected result:** the row expands into a detail block showing the session's title
(`sessionLabel`) and its last assistant message (or the literal text "nothing said yet" if there
is none), followed by one row per subagent. Each subagent row shows a status dot, its label, an
agent-type pill, and — once finished — its own model name and its own context chip (`🟢/🟡/🔴/⚠️
ctx NN%`). A subagent that is still running shows neither a model number nor a context chip and
instead shows the plain sentence "No report yet — a subagent's progress isn't observable until it
finishes." — never a placeholder, never `0%`.
Cross-check: open the main window (double-click the tray icon) and look at the same session's
subagent tree in the detail pane — the numbers, model names and status wording must match the
popover exactly, since both surfaces render from the same shared helper module.

### 5. Failure case (not reproducible on demand)

If a subagent happens to fail (e.g. hits a real API error) during your testing, check that its
row keeps its error text visible and shows no report. This cannot be triggered on demand through
the UI — treat it as opportunistic; the story's own standing coverage is a unit test
(`popoverModel.test.ts`), not this manual step.

### 6. Keyboard only

**Preparation:** with at least one project group, one expandable session, and one session with
subagents visible.

**Steps:**
1. Open the popover via the global shortcut configured in Settings (story 003; check Settings →
   Shortcuts for the exact key combo, or use the tray icon if you have not set one).
2. Use ↓/↑ to move focus down and up across group headers, session rows and (once a session is
   expanded) subagent rows — one flat list in that order.
3. On a group header, press → to expand, ← to collapse.
4. On a session row, press → to expand its detail block, ← to collapse it.
5. Press Enter on a session row.
6. Press Esc.

**Expected result:** arrow keys move the focus ring one node at a time in visual order; →/←
expand and collapse the focused group or session (a subagent row does nothing on →/←, since it
has nothing to expand); after every expand/collapse the focus ring stays on the node you were on
(never jumps to the browser body) and that node is scrolled into view if it was off-screen. Enter
on a session row jumps to that session's window (same as a mouse click). Esc closes the popover.

### 7. Height: accept the scroll

**Preparation:** at least two sessions, each with several subagents, so their combined expanded
height exceeds 560 px.

**Steps:**
1. Expand two sessions with subagents at the same time.
2. Close the popover and reopen it.

**Expected result:** the popover window grows up to at most ~560 px tall and then the row list
scrolls internally (no window taller than that, no clipped content, no gap under the footer
buttons). Reopening the popover always comes back fully collapsed (groups expanded, sessions
collapsed) — the previous expansion is not remembered.

---

## Story 011 — Subagent final message and declared model

Requires story 010's drill-down to be visible (steps 2–4 below).

### 1. While subagents are running: declared vs. no model

**Preparation:** in a Claude Code session, start two subagents in one message — the prompt you
type into Claude Code should give one an explicit `model` (e.g. "use the Task tool: launch one
subagent explicitly on the sonnet model, and one with no model specified; both should produce a
report of a few paragraphs, not one line").

**Steps:**
1. While both subagents are still running, open the popover and expand that session.

**Expected result:** the subagent with a declared model shows it, title-cased (e.g. "Sonnet"), and
hovering it shows a tooltip saying it was declared in the call and not yet confirmed by the run.
The subagent with no declared model shows **no model cell at all** — no `≈`, no dash, no
placeholder. Neither subagent shows any report text yet; both show the "No report yet…" sentence
plainly.

### 2. After they finish: resolved model + report

**Steps:**
1. Wait for both subagents to finish, then re-open (or leave open) the popover on that session.

**Expected result:** each finished subagent now shows a report line — one line, ellipsized at the
end rather than wrapping. The model cell for the one that had a declared alias now shows the
resolved model instead (e.g. "Sonnet 5" rather than "Sonnet"), and hovering it now says the run
resolved to it. The one with no declared model now shows the model it actually resolved to.

### 3. Cross-check the surfaces

**Steps:**
1. Open the main window (double-click the tray icon, or use the popover's "Open Claude Control"
   button) and find the same session's subagent tree in the detail pane.
2. Optionally, in a separate terminal, run `npm run cli` and locate the same subagent line.

**Expected result:** the report text and the model name are character-for-character identical
across the popover, the main window's subagent tree, and (if checked) the CLI output.

### 4. Nothing new on disk / in logs

**Steps:**
1. With the app running through the above steps, open Windows Explorer to the app's userData
   directory (`%APPDATA%\claude-control\`) and note its contents.
2. Watch the DevTools console (if running a dev build) and the terminal output of `npm run dev`
   while the subagents run and finish.

**Expected result:** no new file appears under the userData directory beyond `settings.json`, and
no subagent report text appears in the DevTools console or the terminal output.

### 5. Failure case (not reproducible on demand)

If a subagent dies with an error during testing, its row should keep showing the error text and
no report. Cannot be triggered on demand — check opportunistically; the unit test in the story's
D1 deliverable is the standing coverage.

### 6. N5 budget

**Steps:**
1. In a terminal: `npm test`.

**Expected result:** the cold-start/N5 test passes (asserts under the 2 s budget); the story's
`## Done` records a measured 136–138 ms on the build machine as a reference point, not something
you need to reproduce exactly.

---

## Story 007 — Light theme

The Windows scheme is switched under **Settings → Personalization → Colors → "Choose your mode"**
→ *Light* / *Dark* (a Windows OS setting, not Claude Control's).

### 1. Light, cold start

**Steps:**
1. Set Windows to Light mode.
2. Start the app (`npm run dev`, or relaunch if already running).
3. Left-click the tray icon to open the popover; double-click to open the main window.

**Expected result:** both windows render light immediately — no dark flash on open. Text is
comfortably readable. Arrow onto a popover row to see the focus ring; it and the scrollbar (if
the list is tall enough) are visible against the light background.

### 2. Statuses side by side

**Preparation:** have sessions in different states live at once (working, waiting, done, stale) —
in practice this means a few Claude Code sessions in different phases of a turn.

**Steps:**
1. In the popover or the main window, look at each session's status dot without reading its text
   label.
2. Watch a `working` session's dot through a full pulse cycle (it dims and brightens).

**Expected result:** every status is identifiable by its dot colour alone, including at the
pulsing dot's dimmest point, and the `waiting` halo is still visible against the light background.

### 3. The four context bands

**Steps:**
1. In the main window, compare the context bar/gauge colour across sessions at different context
   fill levels (or watch one session's context climb over a long turn).

**Expected result:** green, yellow, red and critical read as four visually distinct steps, not
two pairs that collapse into each other.

### 4. Live switch, no restart

**Steps:**
1. With the app running and the popover open, flip Windows to Dark, then back to Light, without
   restarting the app.

**Expected result:** both the popover and the main window follow the OS change immediately, the
tray icon is repainted, and nothing is left half-themed (no stray dark panel in a light window or
vice versa).

### 5. Tray badge on both taskbars

**Preparation:** leave at least one session unseen in a waiting or done state so the tray badge is
showing.

**Steps:**
1. Look at the tray icon with the Windows taskbar in light mode, then in dark mode, at 100% and
   (if you can change it) 150% display scaling.

**Expected result:** the badge is visually separable from the tray tile and from the taskbar
background in every combination. Note the verdict for each of the six tray states in this plan's
results (the story's own `## Done` already ships a rendered reference,
`output/007-tray-badge-check.png`, that you can compare against).

### 6. Dark regression

**Steps:**
1. Back in Dark mode, walk through the popover and both main-window tabs (Sessions, History).

**Expected result:** nothing looks different from before this story — dark is the unchanged
baseline.

---

## Story 012 — S02 residuals

### A — a session is never hidden on an unanswered probe

**Steps:**
1. In Settings, find the "Hide abandoned sessions" checkbox (Settings → the list section) and
   make sure it is checked.
2. With two live sessions in the same project folder — one that has a visible window, one that
   does not — open the popover or main window and confirm the windowless one is hidden.
3. Uncheck "Hide abandoned sessions" in Settings.

**Expected result:** with the checkbox on, the windowless session in a folder that has a windowed
mate stays hidden (unchanged from story 004). Unchecking it makes it reappear. No badge appears
on any ordinary row in this scenario.

**The "unknown" marker case is hard to reproduce on demand.** It requires the window-probe
PowerShell helper to fail to answer for exactly one process id within a single pass (a timing
condition, not something reachable by clicking anything in the app). This is a GAP for manual
testing — the standing coverage is `test/unit/processChain.test.ts` and the orphan-filter cases
in `test/unit/derivations.test.ts`, both of which construct the partial-answer condition directly
rather than through the UI. If you do happen to see the marker (a small "❓" badge on a row, next
to the mute toggle) during ordinary use, hovering it should explain that the window state could
not be determined and the session is shown to be safe, and it should not persist across the next
probe pass (roughly 30 s).

### B — portable protocol path (packaged build only, optional)

This check needs a packaged portable build, not `npm run dev`. Treat it as a separate, optional
check outside the normal dev-mode pass:
1. `npm run build`, then `npm run package` to produce `release\ClaudeControl-<version>-portable.exe`.
2. Copy that EXE to a fixed folder (not a Downloads/temp path that might get cleaned) and run it
   from there.
3. Let a Claude Code session finish so a Windows toast notification appears.
4. **Exit the app entirely** (Quit from the tray menu or the popover's Quit button).
5. Open Windows Action Center, find the toast, and press its "Mute this session" button.

**Expected result:** the app starts back up and the session is muted. This is the one case that
cannot be exercised from `npm run dev` at all — the whole point of the fix is that it registers
the portable EXE's own stable path (`PORTABLE_EXECUTABLE_FILE`) instead of a temp extraction
directory that stops existing once the app exits, so the button only works after this specific
packaged-build path.

Also check, still in the packaged build:
6. Open the main window → Settings → Diagnostics.

**Expected result:** the "Toast button target" row shows the portable EXE's own path (the folder
you put it in), not a path under `%TEMP%`. Note: this value is computed at the moment you view
Diagnostics, not read back from what Windows actually has registered — if registration itself
silently failed, this field can show a path that isn't really registered (see Gaps below).

### C — the popover never steals focus from Pin or Close

**Preparation:** stop every Claude Code session so the popover shows "No live sessions".

**Steps:**
1. Open the popover via the global shortcut.
2. Press Tab until keyboard focus is visibly on the Pin button (or Close).
3. In a terminal, start a new Claude Code session in a watched project.
4. Wait for that session to appear in the popover.
5. Close the popover and reopen it.

**Expected result:** in step 4, the focus ring stays on Pin (or Close) — the newly arrived session
row does not steal it. In step 5, reopening focuses the top (most urgent) row as usual — the fix
only refuses to *take* focus away from a control you deliberately parked it on; it does not break
the normal focus-on-open behaviour.

### D — one `ShortcutStatus` declaration

No user-facing surface exists for this — it is a type-level de-duplication
(`src/shared/ipc.ts` is now the only declaration; `src/main/shortcuts.ts` imports it). Verified by
`npm run typecheck` passing; there is nothing to click.

---

## Gaps and things this plan cannot verify

1. **010 D8 (popover height across expand/collapse) — not live-measured.** The story's `## Done`
   states the recorded heights (398 px / 645 px / 770 px) are static estimates from reading the
   CSS, not a live Electron measurement. Step 7 above is the first live check of this.
2. **010/011 failure-case rows (a subagent's error text).** Cannot be triggered on demand — no UI
   action forces a subagent to fail. Opportunistic only; standing coverage is unit tests.
3. **012-A, the "window unknown" badge.** Reproducing the exact partial-probe-answer condition
   requires timing a PowerShell process failure against a specific tick of the 250 ms watcher —
   not reachable through any UI action. Standing coverage is unit tests
   (`processChain.test.ts`, `derivations.test.ts`); this plan can only describe what to look for
   if it is seen opportunistically.
4. **012-B, the portable protocol path failure case** (pressing a toast button after the app has
   exited) needs a packaged `electron-builder` portable build — it is described above as a
   separate, optional check, not part of the normal `npm run dev` pass.
5. **012-B Diagnostics field is not authoritative.** Per the story's own `## Done`, the
   "Toast button target" row in Settings → Diagnostics *recomputes* the intended path rather than
   reporting what `app.setAsDefaultProtocolClient` actually wrote to the registry, and that
   registration call swallows its own errors (`catch {}`). A value showing there does not
   guarantee the OS-level registration succeeded — this is a known, carried-over finding from the
   story's review, not something this manual pass can additionally expose.
6. **007 tray badge check** is inherently visual/subjective (six tile states × badge/no-badge ×
   two taskbar themes × two DPI scales) — this plan can point at what to look at, but "legible"
   is a judgement call; the story's own artifact (`output/007-tray-badge-check.png`) is the
   closest thing to an objective baseline to compare against.
7. **N5 timing (011 D5)** depends on the machine it runs on; the 136–138 ms figure in the story's
   `## Done` is a reference from the build machine, not a pass/fail threshold beyond the existing
   `< 2 s` assertion in the test itself.
8. **012-D** has no user-facing behaviour to verify manually at all (see above) — included only
   for completeness, not because it needs a human pass.
