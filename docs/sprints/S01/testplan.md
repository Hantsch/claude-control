# Sprint S01 — manual test plan

Covers only what S01 actually shipped:

- **Story 001 — Registry status field.** A session can report `status: "waiting"` itself; the
  app trusts that over the transcript heuristic and marks it as such.
- **Story 002 — Popover at a glance.** The tray popover groups sessions by project, and each
  row shows a model badge, the waiting reason, the current tool/subagent, an uptime marker,
  a "just now" age, and a header notification quick-switch.

All steps that look at the result are done by clicking in the real UI (tray icon, popover,
main window) — never by reading a file or running a CLI command as the "observation" step.
Console commands are only used to start the app or to prepare test fixtures.

## Before you start

1. Make sure Node 22+ and the project's dependencies are installed: from the repository root
   (`C:\development\Hantsch\claude-control`), run:
   ```powershell
   npm install
   ```
2. This app is an Electron **tray** app — it has no taskbar window by default. After starting
   it, look for its icon in the Windows system tray (the row of small icons near the clock;
   click the `^` arrow to show hidden icons if you don't see it right away).
3. If you launch from VS Code's integrated terminal, make sure the environment variable
   `ELECTRON_RUN_AS_NODE` is **not** set, otherwise the app silently runs as plain Node and
   exits immediately without showing a tray icon:
   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   ```
4. Two of the scenarios below (001, and the notification quick-switch in 002) need a normal
   run against your real `~/.claude` data. One scenario (001's reported-status case) needs a
   fake, prepared data directory because the field it tests does not exist in any real Claude
   Code session file yet. Each scenario says which one to use.

---

## Story 001 — Registry status field

### UC1 — A session that reports "waiting" wins over the transcript, and the app says so

The `status`/`waitingFor`/`updatedAt` fields this story adds support for do not exist in any
shipped Claude Code version, so they have to be faked in a session file. This is fixture setup,
not the observation — the observation itself is done by looking at the popover and the detail
pane.

**Preparation**

1. Find a process ID (PID) of something that is actually running right now, so the app's
   liveness check passes. Easiest: your own PowerShell window.
   ```powershell
   $PID
   ```
   Note the number it prints, e.g. `12345`.
2. Create a fake Claude data directory with one crafted session file:
   ```powershell
   New-Item -ItemType Directory -Force "$env:TEMP\cc-fake\sessions" | Out-Null
   ```
3. Create the file `%TEMP%\cc-fake\sessions\<PID>.json` (replace `<PID>` with the number from
   step 1, e.g. `C:\Users\<you>\AppData\Local\Temp\cc-fake\sessions\12345.json`) with exactly
   this content (adjust `pid` to match, `cwd` to any folder that exists on your machine, and
   set `updatedAt` to a timestamp roughly two hours in the past — `[DateTimeOffset]::UtcNow.AddHours(-2).ToUnixTimeMilliseconds()` in PowerShell gives you that number):
   ```json
   {
     "pid": 12345,
     "sessionId": "11111111-1111-1111-1111-111111111111",
     "cwd": "C:\\development\\Hantsch\\claude-control",
     "name": "fake-waiting-session",
     "entrypoint": "claude-vscode",
     "startedAt": 1755000000000,
     "procStart": null,
     "status": "waiting",
     "waitingFor": "permission prompt",
     "updatedAt": 1755007200000
   }
   ```
   (`procStart: null` makes the liveness check accept any live PID; `updatedAt` being two
   hours old is deliberate — it should be ignored.)

**Steps**

1. Start the app pointed at the fake directory instead of your real `~/.claude`:
   ```powershell
   $env:CLAUDE_CONFIG_DIR = "$env:TEMP\cc-fake"
   npm run dev
   ```
2. Click the tray icon to open the popover.
3. Find the row named `fake-waiting-session` and click it to open the main window's detail
   pane for that session (or open the main window directly and select it from the session
   list).

**Expected result**

- In the popover, the row's status reads **needs you?**, its dot has a halo, and the `.where`
  cell (where the project/branch would normally be) shows the text **permission prompt** in
  the waiting colour (orange/red, matching the halo).
- In the main window's detail pane for that session, the status line reads **needs you? —**
  followed by a reason naming Claude Code and "permission prompt", **and** a small badge/text
  next to it reading **"reported by Claude Code"**.
- This holds despite `updatedAt` being two hours old and despite the session having no real
  transcript.

**Cleanup:** stop the app (tray menu → Quit, or close the terminal), then:
```powershell
Remove-Item Env:CLAUDE_CONFIG_DIR
```

### UC2 — Without the reported fields, nothing changes (regression check)

**Preparation:** edit the same fake file from UC1 and delete the three lines `"status"`,
`"waitingFor"`, `"updatedAt"` (keep `pid`, `sessionId`, `cwd`, `name`, `entrypoint`,
`startedAt`, `procStart`).

**Steps**

1. Restart the app the same way as UC1 (`$env:CLAUDE_CONFIG_DIR = "$env:TEMP\cc-fake"; npm run dev`).
2. Open the popover and look at the `fake-waiting-session` row; open its detail pane in the
   main window.

**Expected result:** the "reported by Claude Code" badge is gone from the detail pane; the
status is whatever the transcript rules alone produce for a session with no transcript
content (reads **no prompt yet** / a starting-style status). No waiting halo, no orange
`.where` text.

**Cleanup:** same as UC1.

### UC3 — Real data is unaffected

**Steps**

1. Close the app, unset `CLAUDE_CONFIG_DIR` if still set, and start it normally:
   ```powershell
   Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue
   npm run dev
   ```
2. Open the popover and click through a few real sessions in the main window.

**Expected result:** the popover and detail pane look exactly as before this story — no
"reported by Claude Code" badges anywhere, since no real Claude Code session file carries
these fields today.

---

## Story 002 — Popover at a glance

These scenarios are best driven with **real, live Claude Code sessions** rather than fake
files, because the states involved (a running tool, a subagent, a permission prompt) come from
actually using Claude Code. Prepare the scenario by using Claude Code normally in one or more
project folders; do all the actual checking by clicking around in the Claude Control tray
popover and main window.

**Preparation (shared):** have Claude Code running as at least two sessions in two different
project folders (e.g. open `claude-control` in one VS Code window/Claude Code session, and any
other git repo you have locally in a second one). Start Claude Control normally:
```powershell
npm run dev
```

### UC4 — Grouping by project, most urgent group on top

**Steps**

1. With both sessions live and doing different things (e.g. leave one idle/finished and get
   the other one to run a tool, see UC6), click the tray icon to open the popover.

**Expected result:**

- Rows are grouped under a header per project (the project's folder name, plus "N session(s)"),
  sitting above that project's rows.
- The group containing the most urgent session (the one that would colour the tray icon —
  waiting first, then working/stale, then done) is the **top** group.
- No scrollbar appears and there is no extra gap below the last row — the popover window has
  resized to fit exactly.

### UC5 — Single project shows no group header

**Steps**

1. Make sure only one project currently has a live session (close/end sessions in the other
   project, or just check while only one is open).
2. Open the popover.

**Expected result:** no project header line appears at all — just the row(s) directly under
the popover's top bar. Window height still fits exactly (no scrollbar, no bottom gap).

### UC6 — Working row shows the tool, and a subagent marker

**Steps**

1. In one of your live Claude Code sessions, give it a prompt that will keep a tool running
   for a bit (e.g. ask it to run a slow `Bash` command, or read a large file).
2. While that tool is running, open the popover quickly and look at that session's row.
3. (Best-effort) If you can get Claude Code to spin up a subagent (e.g. ask it to delegate a
   sub-task), open the popover again while the subagent is running.

**Expected result:**

- While a tool is running, the row's status cell reads **working · `<ToolName>`** (e.g.
  `working · Bash`), not just `working`.
- If a subagent is running at the same time, the status cell additionally reads
  **working · `<ToolName>` · subagent**.
- Once the tool finishes and no tool is pending, the cell goes back to plain `working` or
  whatever status follows.

### UC7 — Waiting row: reason inline, halo, header count

**Steps**

1. In a live Claude Code session, trigger something that needs your permission (e.g. ask it to
   run a command or edit a file in a way that requires an approval prompt), and **do not**
   respond to the prompt yet.
2. Open the popover.

**Expected result:**

- That row's dot has a visible **halo** (a soft glow ring) around it — it is the only dot on
  the whole list with a halo, even if other rows are `working` or `done`.
- The `.where` cell (which normally shows `project · branch`) instead shows the **reason** for
  waiting (e.g. mentioning a permission prompt), rendered in the same orange/red waiting colour
  as the dot.
- If you can produce a very long reason (long tool name/argument), confirm it gets cut off with
  an ellipsis (`…`) and the popover window does **not** get wider.
- The popover's header count line shows something like `3 sessions (1 waiting)`, with the
  `(1 waiting)` part in the waiting colour — and that number matches exactly how many haloed
  dots are visible in the list.
3. Answer the permission prompt (approve or deny it) and reopen the popover — the halo, the
   reason text and the header's waiting count should all be gone for that row.

### UC8 — Model badge

**Steps**

1. In a live Claude Code session, run `/model` and pick a specific model (e.g. Opus).
2. Open the popover and find that session's row; also open its detail pane in the main window.

**Expected result:**

- The popover row shows a small dim badge with a readable model name, e.g. **Opus 5**, or
  **Opus 5 · 1M** if a `[1m]`-style context-window suffix applies. Hovering it shows the raw
  model id as a tooltip.
- The main window's detail pane's "Model" row shows the same readable name (with the raw id as
  the tooltip), instead of the raw `claude-opus-5[1m]`-style string.
- If a session has no model information at all, its model cell in the popover is simply empty
  — not a dash or placeholder.

### UC9 — Uptime marker for long-running sessions

**Steps**

1. Leave a Claude Code session open and running for over an hour (this one needs real elapsed
   time — start it and check back later, or use a session you know has been open that long).
2. Open the popover and look at that row; hover over its uptime cell.

**Expected result:**

- The row shows a small `↑` marker followed by a duration, e.g. `↑1h 12m`, in its own column
  to the left of the "time since last activity" column — clearly a different number from the
  "Xm ago"/"just now" age next to it.
- Hovering it shows a tooltip like "Running for 1 hour 12 minutes".
- A session younger than one hour shows nothing in that column.

### UC10 — "Just now" for very fresh activity

**Steps**

1. Send a prompt to a live Claude Code session (or otherwise cause activity) and immediately
   open the popover within about 5 seconds.
2. Wait about 10 more seconds and reopen the popover.

**Expected result:** immediately after the activity, the row's age reads **just now** (not
`0s ago`). After roughly 10 seconds it reads something like `10s ago`. Check the same session
in the main window's session list and its detail pane ("Last activity" row) — both should show
the same wording convention (`just now` under 5 s).

### UC11 — Notification quick-switch in the popover header

**Steps**

1. Open the popover. In the header, find the button reading **`notify: <mode> ▾`** (next to
   the pin and close buttons).
2. Click it. **Do not** click anywhere outside the popover.
3. While the dropdown menu is open, confirm the popover itself is still showing (it must not
   have closed because of the menu).
4. Click **"When a session is done"**.
5. Without closing Claude Control, open the main window (popover footer → "Open Claude
   Control") and go to the **Settings** tab.
6. Reopen the popover afterward and check the header button's label again.

**Expected result:**

- The popover stays open the entire time the dropdown menu is showing (step 3).
- After picking "When a session is done" (step 4), the button label updates to reflect that
  mode (e.g. `notify: done ▾`) and the menu closes.
- The main window's Settings tab (step 5), opened without restarting the app, shows
  notification checkboxes matching "notify only when a session is done" — no reload needed.
- Reopening the popover (step 6) still shows the mode you picked, confirming it persisted.
- Pressing `Escape`, or clicking elsewhere inside the popover, also closes the menu without
  changing the mode.

---

## Known gaps (not covered above)

- **UC6's subagent marker** depends on Claude Code actually spinning up a subagent during the
  test session, which cannot be forced through the UI on demand; treat it as best-effort and
  note in the sprint review if it could not be observed.
- **UC9's uptime threshold (≥ 1 h)** cannot be sped up through the UI — there is no user-facing
  way to fast-forward a session's start time, so this check genuinely needs an hour of wall
  clock time (or reusing a session you already know is that old).
