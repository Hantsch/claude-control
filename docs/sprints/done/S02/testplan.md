# Sprint S02 — Manual Acceptance Test Plan

Covers the two stories built in this sprint:

- **003 — Reach the popover without hunting for it** (autostart, global shortcut, popover
  keyboard navigation)
- **004 — Noise control: abandoned sessions and actionable toasts** (orphan-session filter,
  toast buttons, mute)

Both were built and unit-tested in a headless session and have **not** been run live yet. This
plan is written for someone who has never read the story files or looked at the code — it only
assumes you can find the app, click things, and type. Every step that represents something a
user does is a real action in the running app (a click, a keypress, typing text); a console
command only ever appears where it is setting up a precondition the UI has no way to create
(e.g. "another app is already holding a hotkey") or checking a side effect that has no UI of its
own (e.g. a Windows registry entry). Where an acceptance criterion genuinely cannot be exercised
this way, that is called out explicitly under **Documented gaps** at the end instead of being
faked.

## 0. Preparation

You need Windows 10/11 and, for most cases, at least one folder where you can run the real
`claude` CLI (Claude Code) so the app has something to show. A couple of cases need **two**
terminal windows open on the **same** folder.

### Starting the app for development (used for almost everything below)

1. Open a terminal in the project folder (`c:\development\Hantsch\claude-control`).
2. **If you are running this from VS Code's integrated terminal**, first run:
   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   ```
   VS Code's extension host sets `ELECTRON_RUN_AS_NODE`, and every terminal it spawns inherits
   it. With it set, Electron runs the entry file as plain Node instead of starting the app —
   `app` from `require('electron')` is `undefined`, the process exits with code 1, and nothing
   is printed anywhere, so it looks like a silent crash with no clue why. Unsetting it first
   avoids that trap.
3. Run:
   ```powershell
   npm install
   npm run dev
   ```
4. Claude Control appears in the Windows tray (the `^` overflow area, unless you have dragged
   it out onto the visible taskbar). Left-click the tray icon to open the popover, right-click
   for the menu, double-click to open the main window on the Sessions tab.
5. Settings live in `%APPDATA%\claude-control\settings.json`. The Settings tab has a
   "Reset to defaults" button — use it between test cases if a previous case left a setting
   (shortcut, autostart, a checkbox) in a state that would confuse the next one.

Leave this `npm run dev` terminal running for every case below unless a step tells you to quit
or restart the app.

### Building the packaged EXE (needed only for case 3, the portable-EXE self-heal)

```powershell
npm run package
```

This produces `release\ClaudeControl-<version>-portable.exe`. Case 3 specifically needs this —
in `npm run dev` the "current executable" is `node_modules\electron\dist\electron.exe`, which
is not something you can meaningfully "move" to simulate a portable EXE relocating.

---

## Part A — Story 003: reach the popover without hunting for it

### A1. Autostart: turn it on, and it survives a restart

1. Open the main window (double-click the tray icon) → **Settings** tab.
2. Find **"Start with Windows"** and read the hint text next to it.
3. Click the checkbox to tick it.
4. Verify the side effect (no UI shows registry contents): open a **separate** PowerShell
   window and run
   ```powershell
   Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
   ```
   One of the listed values should reference the current Claude Control executable
   (`electron.exe ... --autostart` in a dev run, or `ClaudeControl-*.exe --autostart` for a
   packaged run) — look for a property whose value contains `--autostart`.
5. Quit the app (tray icon → right-click → **Quit**), then start it again (`npm run dev`, or
   run the EXE again).
6. Open Settings again. **Expected:** the "Start with Windows" checkbox is still ticked — the
   choice survived the restart.

### A2. Started at login: comes up to the tray with no window

1. Quit the app if it is running.
2. Start it with the login-item flag, exactly as Windows itself would at logon:
   ```powershell
   npm run dev -- --autostart
   ```
   (For a packaged build: `.\release\ClaudeControl-<version>-portable.exe --autostart`.)
3. **Expected:** the tray icon appears. No window opens on screen, and no "No Claude Code data
   found" dialog appears — even if you have no Claude Code data at all. (Without `--autostart`,
   an empty data directory would show that dialog; this is what confirms the flag is doing
   something.)

### A3. Portable EXE: a moved executable repairs its own registry entry

Requires the packaged EXE (see Preparation).

1. Copy `release\ClaudeControl-<version>-portable.exe` to a first location, e.g.
   `C:\temp\cc-a\ClaudeControl.exe`.
2. Run it from there and, in Settings, tick **"Start with Windows"**. Quit the app.
3. Verify: `Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'` shows an
   entry pointing at `C:\temp\cc-a\ClaudeControl.exe`.
4. Copy the same EXE to a second location, e.g. `C:\temp\cc-b\ClaudeControl.exe`, and delete (or
   just ignore) the copy at `cc-a`.
5. Run the EXE from `C:\temp\cc-b`.
6. Verify again: the registry entry now points at `C:\temp\cc-b\ClaudeControl.exe`.
   **Expected:** the entry follows the EXE to its new location without you touching the
   checkbox again — it is rewritten every time the app starts with autostart still on.

### A4. Autostart: turn it off

1. In Settings, untick **"Start with Windows"**.
2. Verify: `Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'` no longer
   lists a Claude Control entry.

### A5. Global shortcut opens and closes the popover

1. In Settings, confirm the **Global shortcut** field shows `Ctrl+Alt+C` (click **Reset** if it
   shows something else).
2. Click into any other application window (a browser, Notepad — anything) so it has focus.
3. Press **Ctrl+Alt+C**. **Expected:** the popover appears near the tray icon, regardless of
   which app had focus.
4. Press **Ctrl+Alt+C** again. **Expected:** the popover closes.

### A6. Reconfigure the shortcut

1. In Settings, click the button showing the current combination (`Ctrl+Alt+C`) to focus it.
2. Press **Ctrl+Alt+P**. **Expected:** the button now reads `Ctrl+Alt+P`.
3. Click any other app to give it focus, then press **Ctrl+Alt+P**. **Expected:** the popover
   opens.
4. Press **Ctrl+Alt+C** (the old combination). **Expected:** nothing happens — it no longer
   does anything.
5. Back in Settings, click **Reset**. **Expected:** the field shows `Ctrl+Alt+C` again and that
   combination works once more.

### A7. Registration conflict is reported, not silent

Global shortcuts are OS-wide, so to see a conflict you need another process already holding the
exact combination you are about to type. If you already have a utility bound to a hotkey (many
clipboard managers, PowerToys modules, etc. use one), you can use that instead of the script
below and skip to step 3 with its combination.

1. In a **separate** PowerShell window, run this to hold `Ctrl+Alt+P` hostage (this is only
   test scaffolding — a stand-in for "some other app already owns this combination", which has
   no UI of its own to create):
   ```powershell
   Add-Type -Namespace ClaudeControlTest -Name Hotkey -MemberDefinition @'
   [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
   [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
   '@
   $ok = [ClaudeControlTest.Hotkey]::RegisterHotKey([IntPtr]::Zero, 1, 0x1 -bor 0x2, 0x50) # Ctrl+Alt+P
   "Holding Ctrl+Alt+P: $ok"
   Read-Host 'Keep this window open. Press Enter here only after step 4 below is done'
   [ClaudeControlTest.Hotkey]::UnregisterHotKey([IntPtr]::Zero, 1)
   ```
   Leave this PowerShell window open and blocked on the `Read-Host` prompt — that is what keeps
   the hotkey held.
2. In Claude Control's Settings, click the shortcut field and press **Ctrl+Alt+P**.
3. **Expected:** the field shows `Ctrl+Alt+P`, but a visible warning appears underneath it
   ("... is already taken by another application — pick a different combination") — not
   silence.
4. Click **Reset** to go back to `Ctrl+Alt+C`, then go back to the PowerShell window and press
   Enter to release the test hotkey.

### A8. The shortcut is released on quit

1. Confirm the shortcut is `Ctrl+Alt+C` and works (press it from another app; popover opens and
   closes).
2. Quit Claude Control via the tray icon's right-click menu → **Quit**.
3. Press **Ctrl+Alt+C** again. **Expected:** nothing happens anywhere — no popover, obviously,
   since the app is not running, but also nothing else claims the keys.
4. To confirm the OS-level registration is actually gone (not just that there is no window to
   show it in), open a PowerShell window and run:
   ```powershell
   Add-Type -Namespace ClaudeControlTest -Name Hotkey2 -MemberDefinition @'
   [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
   [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
   '@
   [ClaudeControlTest.Hotkey2]::RegisterHotKey([IntPtr]::Zero, 2, 0x1 -bor 0x2, 0x43) # Ctrl+Alt+C
   ```
   **Expected:** this returns `True` — the combination is free again, proving Claude Control
   released it on quit rather than leaving it dangling. (Clean up with
   `[ClaudeControlTest.Hotkey2]::UnregisterHotKey([IntPtr]::Zero, 2)`.)
5. Restart Claude Control (`npm run dev`) for the remaining cases.

### A9. Popover keyboard navigation

Precondition: have at least two `claude` sessions running in **two different** project folders
(open two terminals, `cd` into two different folders, run `claude` in each) so the popover shows
at least two groups with a group header between them.

1. Open the popover with the global shortcut (`Ctrl+Alt+C`).
2. **Expected:** the topmost row is visibly focused (an outline / focus highlight), with no
   click needed — this should be whichever session is the most urgent (the one that also
   colours the tray icon).
3. Press **↓** repeatedly. **Expected:** focus moves down one row at a time; it lands on every
   session row but **skips** the group header lines (the rows that just show a project name and
   a session count).
4. Keep pressing **↓** past the very last row. **Expected:** nothing happens — focus stays on
   the last row, it does not wrap back to the top.
5. Press **↑** repeatedly back to the top row, and past it. **Expected:** same clamping at the
   top — focus stays on the first row rather than wrapping to the bottom.
6. With some row other than the very first one focused, press **Enter**. **Expected:** that
   session's window/terminal comes to the front and the popover closes.

### A10. Esc closes the popover, but not through the notify menu

1. Reopen the popover.
2. Click the **"notify: ..."** button in the popover's header to open its menu.
3. Press **Esc**. **Expected:** only the notify menu closes; the popover itself stays open.
4. Press **Esc** again. **Expected:** now the popover closes.

---

## Part B — Story 004: noise control

Reset `hideOrphanSessions` to its default (on) via Settings → "Hide abandoned sessions" before
starting, and use a scratch folder you don't mind having a couple of `claude` sessions open in,
e.g. `C:\temp\cc-orphan-test`.

### B1. Two windowed sessions in one folder both stay

1. Open **Terminal window 1**, `cd C:\temp\cc-orphan-test`, run `claude`. Leave the window open.
2. Open **Terminal window 2** (a genuinely separate window, not a second tab of the same
   window), `cd C:\temp\cc-orphan-test` (the exact same folder), run `claude` there too. Leave
   this window open too.
3. Open the popover or the main window's Sessions tab. **Expected:** both sessions are listed,
   grouped under that one project/folder.

### B2. A windowless sibling disappears from the live surfaces

Continue directly from B1 — both sessions from that folder should still be open.

1. Close **Terminal window 2** the normal way (its window's close button), **without** using
   Task Manager or `taskkill` — the point is to close only the terminal, not necessarily the
   `claude` process running inside it.
2. Verify the process survived the window closing (this is checking a side effect the UI cannot
   show, not the test action itself):
   ```powershell
   Get-Process claude -ErrorAction SilentlyContinue
   ```
   If you still see a `claude` process listed, continue to step 3. **If the process is gone
   too**, your terminal application killed its whole process tree when the window closed (some
   terminals do, by design) — retry this case using classic `cmd.exe` (Win+R → `cmd`) for
   Terminal window 2 instead, or start session 2 as `start /b claude` from inside `cmd.exe` so
   it detaches from that console before you close it.
3. Within about a minute (the window probe re-checks periodically), look at the popover, the
   tray right-click menu, and the main window's Sessions tab. **Expected:** the session whose
   terminal you closed has disappeared from all three; the other session (still windowed) is
   still shown.

### B3. A lone windowless session stays visible

1. In a fresh, separate folder (e.g. `C:\temp\cc-orphan-test-2`, not the one used above), open
   one terminal, `cd` into it, run `claude`.
2. Close that terminal window the normal way, and again confirm with
   `Get-Process claude -ErrorAction SilentlyContinue` that the process is still running (retry
   with `cmd.exe`/`start /b` as in B2 if not).
3. Look at the popover / Sessions tab. **Expected:** this session **stays visible** — with
   nothing else in that folder to prefer over it, there is nothing to compare it against, so it
   is never hidden.

### B4. The filter is a setting you can flip live

Continue from the state left by B2 (one session hidden as an orphan) — if you've since closed
everything, redo B1+B2 to get back to that state.

1. Open the main window → Settings tab.
2. Untick **"Hide abandoned sessions"**.
3. Without restarting anything, check the popover/Sessions tab again. **Expected:** the hidden
   orphaned session reappears immediately.
4. Re-tick the checkbox. **Expected:** it disappears again, still without a restart.

### B5. A toast's "Jump" button

Precondition: notifications enabled in Settings (default), and a live session that is about to
finish a turn or hit a permission prompt.

1. Let a `claude` session finish a turn (or trigger a permission prompt) so a Windows toast
   notification pops up.
2. **Expected:** the toast shows two buttons: **Jump** and **Mute this session** (in addition to
   the session name/status text).
3. Click **Jump**. **Expected:** that session's terminal window is brought to the foreground.

### B6. A toast's "Mute this session" button, and the muted session's status elsewhere

1. Trigger another toast for a (different, or the same after some activity) session.
2. Click **Mute this session** on the toast itself (not through Settings).
3. Open the popover and the main Sessions tab. **Expected:** that session shows a visible mute
   indicator (a muted-bell icon/marker) on its row in both places.
4. Cause that same session to finish another turn (after whatever cooldown applies).
   **Expected:** **no** new toast appears for it.
5. While muted, check that session's row and its detail pane (click the row to open it).
   **Expected:** its status (`working` / `waiting` / `done` / `stale`), its age/last-activity
   time, and the tray icon's own colour/badge all behave exactly as they would for an unmuted
   session — muting only suppresses the toast, nothing else.

### B7. Unmute from the popover row

1. With a session muted (from B6), open the popover.
2. Click the mute icon on that session's row (this is a separate, nested button from the row
   itself — clicking it should not also jump to the session).
3. **Expected:** the row's mute indicator clears.
4. Let that session finish another turn. **Expected:** a toast appears again for it.

### B8. Unmute from the detail pane, and both surfaces agree

1. Mute a session again — this time from the detail pane: open the main window, click the
   session's row to select it, then click **"🔔 Mute"** next to "Jump to session" in the detail
   pane.
2. Check the popover. **Expected:** the same session shows as muted there too, without needing
   a refresh.
3. Click **"🔇 Unmute"** in the detail pane.
4. Check the popover again. **Expected:** it now shows as unmuted there too — both surfaces
   stayed in sync through either action.

### B9. The mute badge is visible without opening anything

1. Mute a session (either surface).
2. Without clicking into it, just glance at the popover row and the Sessions tab row.
   **Expected:** you can tell it is muted from the row alone (icon/marker), without opening the
   detail pane or hovering for a tooltip.

### B10. Mutes do not survive a restart

1. Mute a session.
2. Quit Claude Control (tray → right-click → Quit) and start it again (`npm run dev`).
3. Check that session's row. **Expected:** it comes back **unmuted** — mutes are in-memory only
   by design, reset on every restart.

---

## Documented gaps — not exercisable through the UI

A few acceptance criteria describe internal guarantees with no user-facing surface at all. Per
this project's UI-acceptance policy, these are named here rather than worked around with a fake
UI step:

- **"`core/` imports no Win32, and a probe that is absent or hasn't answered yet never drops a
  session."** This is an architectural/safety guarantee about code that has no observable
  difference in the running app (the visible outcome — nothing is ever wrongly hidden — is
  already covered by B3). It is verified by the automated test suite instead:
  `test/unit/boundaries.test.ts` (no Win32 import in `core/`) and the `hasTerminalWindow`
  branches in `test/unit/derivations.test.ts`.
- **"A single session in a folder triggers no PowerShell call at all"** (story 004, D2). This is
  a cost-control detail inside the window-probe cache with no visible effect for a manual
  tester to check one way or the other — a lone session simply stays visible either way (B3).
  Covered by `test/unit/windowProbe.test.ts` and `test/unit/processChain.test.ts`.
- **`ShortcutManager.dispose()` being unused**, and the `ShortcutStatus` type being declared
  independently in two files — both are code-hygiene notes from the story's own `## Done`
  section, not acceptance criteria, and have no UI surface either way.

## Coverage

| Case(s) | Story | Acceptance criterion |
| --- | --- | --- |
| A1, A4 | 003 | Settings checkbox registers/unregisters the login item, survives restart |
| A2 | 003 | Started at login, comes up to the tray without a window |
| A3 | 003 | Portable-EXE caveat handled and stated in the hint |
| A5, A6 | 003 | Configurable global shortcut opens and closes the popover |
| A7 | 003 | Registration conflict reported in Settings |
| A8 | 003 | Shortcut released on quit |
| A9 | 003 | ↑/↓ skip group headers, Enter jumps, focus clamps at the ends |
| A9 (step 2) | 003 | Opening focuses the most urgent row |
| A10 | 003 | Esc closes the popover; Esc inside the notify menu closes only the menu |
| B1, B2 | 004 | Windowless session next to a windowed one disappears |
| B1 | 004 | Two windowed sessions in one folder both stay |
| B3 | 004 | A lone windowless session stays |
| B4 | 004 | The filter is a setting, default on |
| B5 | 004 | Toast carries "Jump" |
| B6 | 004 | Toast carries "Mute this session"; a muted session shows its real status everywhere |
| B7, B8 | 004 | Mute is visible and revocable in both the popover row and the detail pane |
| B9 | 004 | The mute is visible at a glance |
| B10 | 004 | Mutes reset on restart (sprint decision) |
