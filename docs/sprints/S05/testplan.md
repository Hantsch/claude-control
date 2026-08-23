# S05 — Manual acceptance test plan

Covers the three stories built in this sprint:
[005](../../requirements/005-exact-context-windows.md) (opt-in exact context windows from
LiteLLM's table), [015](../../requirements/015-s04-residuals.md) (S04 residuals: truncated
history totals + timing-test hygiene) and
[014](../../requirements/014-tray-tile-on-a-light-taskbar.md) (light-taskbar tray tile).

All three stories' `## Done` sections say the live smoke pass was not performed (headless build
session, `live-smoke-required: true`). This plan is that pass.

## General preparation

1. From a terminal in the repo root, start the app in dev mode:
   ```powershell
   npm run dev
   ```
   **Known quirk:** if you launch this from a VS Code integrated terminal, first check that
   `ELECTRON_RUN_AS_NODE` is not set (`echo $env:ELECTRON_RUN_AS_NODE` in PowerShell). If it is
   set, clear it first — otherwise Electron silently runs as plain Node and exits with code 1
   instead of showing the tray icon.
2. The app lives in the Windows tray. Left-click opens the popover; right-click opens the context
   menu; double-click opens the main window (Sessions / History / Settings tabs).
3. Test content needed for this sprint's stories:
   - **A live Claude Code session on a well-known model** (e.g. `claude-opus-*` or
     `claude-sonnet-*`), so the exact-window lookup (story 005) has something to resolve.
   - **A history store with more than 200 finished sessions**, across at least two projects, for
     story 015's truncation checks. If you do not have 200+ finished sessions accumulated, this
     check can be run with a lower observable bar: any filter (e.g. no project filter, no date
     range) that returns more entries than the page size will show the same "Showing N of M"
     behaviour — the page size itself is fixed at 200 (unchanged by this sprint).
   - **Network connectivity you can toggle** (Wi-Fi off/on, or unplug the Ethernet cable) for
     story 005's offline checks.
   - **The Windows theme switch**, Settings → Personalization → Colors → "Choose your mode", for
     story 014's tray-tile checks. Have that Settings page ready in a second window so you can
     flip Light/Dark quickly.

---

## Story 005 — Exact context windows

### 1. Off by default — no network, gauge stays an estimate

**Preparation:** a fresh or unmodified `settings.json` (Settings → "Fetch exact context windows
online" unchecked). Stay online or offline, it does not matter for this step.

**Steps:**
1. Double-click the tray icon → **Settings**. Scroll to **Diagnostics**.
2. Read the **Exact context windows** row.
3. Open the main window's Sessions tab (or the popover) and look at a session's context gauge /
   context bar.

**Expected result:** the Diagnostics row reads exactly `off — no network requests`. The context
gauge's caption reads an estimate wording (starts with "Estimate:"), never "Exact:". No network
activity happens (nothing to click to verify this beyond the fact that nothing changes if you are
offline — see check 3 below for the positive proof).

### 2. Turning the setting on

**Preparation:** be online. Same Settings tab as above.

**Steps:**
1. Tick the **"Fetch exact context windows online"** checkbox under **Context windows**.
2. Watch the line directly under the checkbox.
3. Look at the **Diagnostics → Exact context windows** row again.
4. Go to a session running on a model that LiteLLM's table lists (e.g. any current Claude model)
   and read its context gauge caption.

**Expected result:** within a few seconds the line under the checkbox reports success (a fetched
count) or, if it fails, a readable failure message — it does not just say "Checking…" forever.
Diagnostics now reads `on · N models · fetched just now · last refresh ok` (or `failed` in the
warning colour if the fetch failed). The session's gauge caption now reads "Exact: window from the
fetched model table." instead of the estimate wording. If the session's model is not in the
table, its gauge keeps the estimate wording even with the setting on.

### 3. Startup does not wait on the network

**Preparation:** setting left **on** from check 2. Have a live session open in the tray/popover.

**Steps:**
1. Quit the app (tray menu → Exit, or close the dev process).
2. Disconnect the network (Wi-Fi off / cable unplugged).
3. Relaunch (`npm run dev`).
4. Time how quickly the tray icon and the session list appear.
5. Open Settings → Diagnostics.

**Expected result:** the tray icon and session list appear about as fast as with the setting off —
nothing visibly hangs waiting on the network. Diagnostics shows the previously cached fetch info
(model count, cache age) with `last refresh failed` once the background refresh attempt has had a
moment to fail. The gauge still uses the previously cached exact numbers for known models.

### 4. Offline with no cache

**Preparation:** still offline from check 3. Close the app first.

**Steps:**
1. In File Explorer, go to `%APPDATA%\claude-control` (or `%APPDATA%\Claude Control` for a
   packaged build) and delete `model-windows.json`.
2. Relaunch the app while still offline.
3. Open Settings → Diagnostics, and look at a session's gauge caption.

**Expected result:** nothing hangs and no error dialog/toast appears. Diagnostics reports the
failed refresh and no cached model count (or 0 models). Every session's gauge caption falls back
to the estimate wording.

**Cleanup:** reconnect the network before continuing to the next checks.

### 5. CLI honours the same setting

**Preparation:** reconnect the network; leave the setting **on** (from check 2) so the app has a
fetched cache for the CLI to read.

**Steps:**
1. In a terminal: `npm run cli -- --watch`.
2. Read the legend line and the `ctx=` column for each printed session.
3. Stop it (Ctrl+C), then in Settings turn the checkbox **off**, and run `npm run cli -- --watch`
   again.

**Expected result:** with the setting on, the output starts with
`ctx legend: ~ estimated window · = exact window (fetched table)`, and each session's `ctx=`
column ends in `=` for a model the table resolved, `~` otherwise. With the setting off, every
`ctx=` value ends in `~`.

### 6. Promise wording

**Steps:**
1. Open `README.md` → "What it does not do".
2. Open Settings → scroll to the bottom of Diagnostics.

**Expected result:** neither place claims an unconditional "no outbound requests". README reads
"...by default no outbound requests either; the optional exact-context-window lookup (opt-in, off
by default) is the one exception, making exactly one outbound request while it is on." The
Diagnostics footer paragraph reads the equivalent: read-only, no listening socket, no telemetry,
"by default sends nothing over the network — the exact-context-window lookup above is the only
exception, making exactly one outbound request while it is turned on."

---

## Story 015 — S04 residuals (truncated history totals)

### 1. Truncated count line and `≥` group totals

**Preparation:** a history filter that matches more than 200 sessions (e.g. no project filter, no
date range, on a data directory with 200+ finished sessions).

**Steps:**
1. Open the main window → **History** tab, with no filters set.
2. Look above the table for a count line.
3. Switch the **None / Project / Branch / Model** segmented control to **Project**.
4. Hover over one group's total.

**Expected result:** a line reading `Showing 200 of N sessions` (N = the real total) appears above
the table. After switching to Project grouping, every group's token total is prefixed `≥`
(`≥ 1.2M tokens`, for example — possibly followed by `~` too if that group also has unusable-usage
entries). Hovering (or focusing, for a screen reader) any total shows a tooltip explaining both
symbols: "≥ means the page was truncated, so this total is a lower bound, not the whole group; ~
means some entries in this group had no usable usage number."

### 2. Narrowing the filter clears the marker

**Steps:**
1. In the same History tab, set the Project filter to one specific project, or a short date range,
   until fewer than 200 sessions match.

**Expected result:** the `Showing N of M sessions` line disappears entirely. No group total is
prefixed `≥` any more. A group that already carried `~` (some entries with no usable usage number)
keeps the `~` — narrowing the filter does not affect that marker.

### 3. Grouping stays consistent while truncated

**Preparation:** back to the broad, truncated filter from check 1.

**Steps:**
1. Click through **None → Project → Branch → Model → None** in the segmented control.

**Expected result:** the `Showing 200 of N sessions` line stays visible through every grouping
choice; every group's total keeps its `≥` while truncated; the session counts across all groups
for a given dimension add up to 200 (the fetched page), not to the true total N.

### 4. CLI shows the same truncation line

**Preparation:** the same 200+-session history store.

**Steps:**
1. In a terminal: `npm run cli -- --history`.
2. Read the block under `History (...)`.

**Expected result:** if the store holds more history than the CLI's 40-row text limit, a line
`Showing 40 of N sessions` appears right under the `History (40 shown)` header. (The CLI has no
grouping feature, so this is the only truncation qualification it shows — no per-group `≥` is
expected here, by design.) If the store's total fits within 40 rows, no such line appears.

---

## Story 014 — Tray tile on a light taskbar

> Reworked on 2026-08-23: the generated tiles were rejected as unreadable in the tray, so the
> tile is drawn in code (`renderTrayTile`) from the app's own status-dot vocabulary and the
> theme picks a palette rather than a folder. The checks below are the story's original ones,
> restated against what actually ships.

### 1. `npm run icons` no longer produces tray art

**Steps:**
1. In a terminal: `npm run icons`.
2. `git status`, and `ls assets/icons`.

**Expected result:** the command completes without error and reports only `app.ico`, `app.png`,
`app-waiting.png` and `app-done.png`. `assets/icons` contains those four files and no `tray/` or
`tray-light/` folder; `git status` shows no new files under `assets/icons/`.

### 2. Light taskbar — tile legibility and six distinguishable states

**Preparation:** Windows Settings → Personalization → Colors → "Choose your mode" → **Light**
(or at least "app mode: Light" if you use custom light/dark combos). Start (or restart) `npm run
dev` after switching.

**Steps:**
1. Look at the tray tile.
2. Drive the six states: start a Claude Code session (`working`), let it finish (`done`), leave
   one paused on a permission prompt (`waiting`), use CLI-driven/older sessions if available for
   `stale`, have both a live and a finished session together for `mixed`, and close everything for
   `none` (idle tray icon).

**Expected result:** each of the six states is legible and distinguishable from the other five at
a glance, and the mark is the same one the popover shows for that session — same colour (`waiting`
amber, `done` green, `working` blue, `stale` muted amber, `none` grey), and a shape that differs
per state: `done` a filled dot, `waiting` a notched dot with a halo, `working` a dot with a white
core, `none`/`stale` hollow rings, `mixed` a blue ring around a green core.

### 3. Badge legibility on the light tile

**Preparation:** light taskbar from check 2. A session that reaches `waiting` or `done`
unacknowledged (so a numbered badge appears on the tray icon).

**Steps:**
1. Look at the badge disc and its digit on top of the light tray tile.

**Expected result:** the red badge disc and its white digit both stay clearly readable against the
light tile — no washed-out edge where the disc meets the mark under it.

### 4. Dark taskbar

**Steps:**
1. Switch Windows back to **Dark** mode.
2. Look at the tray tile through the same six states as in check 2.

**Expected result:** the same six marks, in the dark scheme's brighter status colours. This is
*not* the picture from before the rework — the near-black plate with the glowing ring is gone on
both taskbars, which is the point of the change.

### 5. Live theme flip without restart

**Preparation:** app already running (`npm run dev`), either theme.

**Steps:**
1. With the app running, switch Windows Settings → Personalization → Colors between **Light** and
   **Dark** two or three times, without restarting the app.

**Expected result:** the tile swaps between the light and dark palettes shortly after each switch,
with no app restart required. The shape does not change — only the colours do.

### 6. Display scaling

**Steps:**
1. Repeat check 2's look at the tile at your normal display scaling.
2. If you can change display scaling to 150% (Settings → System → Display → Scale), repeat the
   look there too, and set it back afterwards.

**Expected result:** the tile stays legible and the six states stay distinguishable at both the
16 px (100%) and 24 px (150%) tray icon sizes, and the mark stays crisp — it is redrawn at the new
size rather than resampled.

---

## Gaps and things this plan cannot verify

1. **005 — subagent chip provenance.** The story's own `## Done` records that subagent metric
   chips (`src/core/state/subagents.ts`) always render `'estimated'` provenance today, even when
   the setting is on and the model is in the fetched table — wiring the exact lookup through the
   subagent tree was left as a documented follow-up, not a defect. This plan does not test the
   subagent chip's provenance label as a pass/fail item; only the main session gauge/bar (checks
   005-1/2) are asserted.
2. **005 — cache staleness display.** Diagnostics' "fetched N d ago" wording (multi-day-old cache)
   cannot be produced through the UI without either waiting several real days or hand-editing the
   cache file's `fetchedAt` timestamp outside the app — neither is a normal user action, so this
   plan only exercises the "fetched just now" and "never fetched" ends of that line.
3. **014 — the fallback-tile check is gone with the art.** The story's D4 was about the tile
   drawn in code *when the shipped art could not be read*. There is no shipped tray art any more,
   so that path is the only path: check 2 exercises it directly, and there is nothing left that
   this plan cannot reach.
4. **014 — pixel-level contrast numbers.** The exact contrast ratios and the OKLab
   distinguishability floor (`MIN_SEPARATION`) are numeric assertions in
   `test/unit/trayTileContrast.test.ts`, measured on the rendered tiles; this plan's checks 2/3/6
   are a subjective "is it legible/distinguishable" look, the same kind of caveat used for 013-C's
   contrast check in the S04 plan.
5. **015 — N5/N2 timing-test hygiene (D4).** Purely a test-suite change inside
   `test/unit/pipeline.test.ts` (listener-attach-order race fix), with no user-facing surface at
   all — accepted via `npm test`, not a manual step.
