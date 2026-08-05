# Claude Control

A Windows tray application that shows you, at a glance, what every Claude Code session
on your machine is doing — and tells you when one is finished or needs you.

Inspired by [Irrlicht](https://github.com/ingo-eichhorst/Irrlicht) (macOS menu bar),
rebuilt for Windows with a Node/TypeScript core and an Electron tray shell.

## Status

**v1 implemented** — milestones M0–M7 of [docs/CONCEPT.md](docs/CONCEPT.md) §11 are in place:
core status engine, tray icon with badge, toasts, jump-to-session, main window with git
grouping / context gauge / subagent tree, history with filters, and a portable EXE.

- [docs/CONCEPT.md](docs/CONCEPT.md) — the design this was built to
- [docs/RESEARCH.md](docs/RESEARCH.md) — the measured facts about Claude Code's on-disk data
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — where each concept section lives in the
  code, and the decisions taken where the concept left a choice open

## What it does

- **Live status** for every running session: working / probably waiting / done / idle /
  queued
- **Tray indicator** that takes on the most urgent status across all sessions, with an
  overlay badge counting sessions that need attention
- **Windows toast** when a session finishes a turn or appears to be blocked on a permission
  prompt — click the toast to jump to that session's window
- **History** of past sessions, filterable by project, date and free text
- **Context pressure** gauge so you can intervene before auto-compaction degrades a session
- **Git context** (project / branch / worktree) and the subagent tree under each session

## What it does not do

- Send prompts to sessions, approve permissions, or start/kill sessions — it is read-only
- Track cost in USD (explicitly out of scope for v1)
- Expose anything over the network — local machine only, no HTTP server, no telemetry
- Support agents other than Claude Code in v1 (the adapter boundary is designed for it)

## Requirements

- Windows 10/11
- Node 22+ (for development only; the packaged EXE bundles its own runtime)
- Claude Code, with its state in `~/.claude` (or set the directory in Settings)

## Usage

```powershell
npm install

npm run cli            # M1: print the live session list and exit
npm run cli -- --watch # keep printing status changes
npm run dev            # run the tray app with hot reload
npm run package        # build release\ClaudeControl-<version>-portable.exe
```

The packaged EXE is portable: put it anywhere and start it manually. It lives in the tray —
left-click for the compact session popover, right-click for the menu, double-click to open
the main window. Settings are stored in `%APPDATA%\claude-control\settings.json`.

Useful flags when starting from a terminal:

```powershell
ClaudeControl.exe --show            # open the main window immediately
ClaudeControl.exe --show history    # …on the History tab
ClaudeControl.exe --show popover    # open the tray popover
```

## Development

```powershell
npm test               # vitest over core/ with fixtures, including the N2/N4/N5 checks
npm run typecheck      # tsc for the Node side and the renderer
npm run icons          # regenerate assets/icons from src/main/tray-icons.ts
```

```
src/
├─ core/        pure TypeScript; never imports Electron
│  ├─ adapters/claude/   the only code that knows Claude Code's files and JSONL schema
│  ├─ registry/          sessions/*.json + PID/procStart liveness
│  ├─ state/             state machine, context pressure, subagent tree, aggregation
│  ├─ store/             SessionStore behind a repository interface
│  └─ watch/             chokidar with a 250 ms trailing debounce
├─ main/        Electron: tray, toasts, window focus, IPC, settings
├─ renderer/    React; a pure view, no filesystem access
├─ shared/      the IPC contract
└─ cli/         the M1 command-line printout
```

`npm test` includes the three non-functional checks from CONCEPT.md §10: a status change is
observed within 2 s of an append (N4), the live tier resolves in under 2 s against a
synthetic ~250 MB / 300-file tree (N5), and no file's content, size or mtime changes after a
full pipeline run (N2).

## License

MIT — see [LICENSE](LICENSE).
