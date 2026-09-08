# Claude Control

A Windows tray application that shows you, at a glance, what every Claude Code session
on your machine is doing — and tells you when one is finished or needs you.

Inspired by [Irrlicht](https://github.com/ingo-eichhorst/Irrlicht) (macOS menu bar),
rebuilt for Windows with a Node/TypeScript core and an Electron tray shell.

## Download

**[Get the latest release](https://github.com/Hantsch/claude-control/releases/latest)** —
one portable `ClaudeControl-<version>-portable.exe`. No installer: put it anywhere and start
it. It lives in the tray — left-click for the compact session popover, right-click for the
menu, double-click to open the main window.

The EXE is **not code-signed**, so on first run Windows SmartScreen shows *"Windows protected
your PC"*. Choose **More info** → **Run anyway**. Each release also ships a `SHA256SUMS.txt`
if you want to verify the download:

```powershell
(Get-FileHash .\ClaudeControl-1.0.0-portable.exe -Algorithm SHA256).Hash
```

Settings are stored in `%APPDATA%\claude-control\settings.json`.

### Auto-update

Off by default. Turn it on in Settings and, once a day, the app checks the GitHub releases page
for a newer version, downloads its portable EXE and verifies it against the release's
`SHA256SUMS.txt` before staging it. A staged update is swapped into the file you launched the
next time you start the app — never a self-restart, never a session interrupted to apply it —
and you get a one-time "Updated to vX.Y.Z" toast on the first run of the new version. Any
failure (offline, GitHub unreachable, a checksum mismatch) is silent and leaves the app exactly
as it was; it's the only outbound request the app makes besides the also-opt-in
exact-context-window lookup. With it off, leave the app to watch the releases page, or the
repository, for you.

**Requirements:** Windows 10/11, and Claude Code with its state in `~/.claude` (or point the
app at another directory in Settings). The packaged EXE bundles its own runtime; you do not
need Node to run it.

## What it does

- **Live status** for every running session: working / needs you? / stale / done / queued.
  A status says what is going on, never how long ago it was — a turn that finished an hour
  ago still reads `done`, and a subagent that has been running for ten minutes still reads
  `working`
- **Tray indicator** that takes on the most urgent status across all sessions, with an
  overlay badge counting sessions that need attention. The tile is drawn in code and follows
  the Windows light/dark taskbar. The popover shows what is running, what you have not
  acknowledged, and what you touched recently — not every live session
- **Popover with drill-down**: sessions grouped by project, collapsible groups with per-status
  counts, the waiting reason spelled out rather than ellipsized, and one click to see what the
  session last said plus a row per subagent with its own model and context
- **Windows toast** when a session finishes a turn or appears to be blocked on a permission
  prompt — click the toast to jump to that session's window
- **History** of past sessions, filterable by project, date and free text, and grouped by
  project / branch / model with totals
- **Context pressure** gauge so you can intervene before auto-compaction degrades a session
- **Git context** (project / branch / worktree) and the subagent tree under each session
- **Autostart and a global hotkey**, both configurable, plus keyboard navigation in the popover
- **Light theme** that follows the OS colour scheme

## What it does not do

- Send prompts to sessions, approve permissions, or start/kill sessions — it is read-only
- Track cost in USD (explicitly out of scope for v1)
- Expose anything over the network — no listening socket, no HTTP server, no telemetry, and by
  default no outbound requests either; the optional exact-context-window lookup and the optional
  auto-update check (both opt-in, off by default) are the two exceptions, each making its own
  request only while it is turned on
- Support agents other than Claude Code (the adapter boundary is designed for it; a second
  agent is the next milestone)
- See sessions running inside WSL — the app reads one Windows-side `~/.claude` root

## Known limits

The toast buttons (Jump, Mute this session) work by relaunching the EXE path that was recorded
in the Windows protocol registry entry when the app last registered it — for the portable build
that is the actual EXE you started, not a fixed install location. Moving or deleting that EXE
therefore breaks the buttons until the app is started once from its new location, which
re-registers the handler. Settings → Diagnostics shows the currently registered path.

The history view fetches 200 entries per page. A filter matching more than that shows totals
marked `≥`, and a "Showing 200 of N sessions" line — the totals are a lower bound, not a
complete sum.

## Contributing

Building from source, the project's status and roadmap, and the release process live in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
