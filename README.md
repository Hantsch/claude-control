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

Settings are stored in `%APPDATA%\claude-control\settings.json`. Auto-update is opt-in and off
by default, same as the exact-context-window lookup — leave it off and watch the releases page,
or the repository, for a new version.

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
  update check (both opt-in, off by default) are the two exceptions, each making its own request
  only while it is turned on
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

## Status

**v1 released.** Phases 1 and 2 are complete and Phase 3 (accuracy & breadth) is in progress —
see [docs/ROADMAP.md](docs/ROADMAP.md) for where each milestone stands.

- [docs/CONCEPT.md](docs/CONCEPT.md) — the design this was built to
- [docs/RESEARCH.md](docs/RESEARCH.md) — the measured facts about Claude Code's on-disk data
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — where each concept section lives in the
  code, and the decisions taken where the concept left a choice open
- [docs/ROADMAP.md](docs/ROADMAP.md) — the one source of status and planning; the open stories
  live in [docs/requirements/](docs/requirements/)
- [CHANGELOG.md](CHANGELOG.md) — what changed per release

## Development

Node 22+ required.

```powershell
npm install

npm run cli            # print the live session list and exit
npm run cli -- --watch # keep printing status changes
npm run dev            # run the tray app with hot reload
npm run package        # build release\ClaudeControl-<version>-portable.exe

npm test               # vitest over core/ with fixtures, including the N2/N4/N5 checks
npm run typecheck      # tsc for the Node side and the renderer
npm run icons          # rebuild assets/icons from the art in output/imagegen (Python + Pillow)
```

Useful flags when starting the app from a terminal:

```powershell
ClaudeControl.exe --show            # open the main window immediately
ClaudeControl.exe --show history    # …on the History tab
ClaudeControl.exe --show popover    # open the tray popover
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
└─ cli/         the command-line printout
```

`npm test` includes the three non-functional checks from CONCEPT.md §10: a status change is
observed within 2 s of an append (N4), the live tier resolves in under 2 s against a
synthetic ~250 MB / 300-file tree (N5), and no file's content, size or mtime changes after a
full pipeline run (N2).

### Releasing

Merging a PR into `main` releases — there is no separate publish step.
[`.github/workflows/release.yml`](.github/workflows/release.yml) derives the version from the
commit messages (Conventional Commits — `feat:` minor, `<type>!:`/`BREAKING CHANGE` major,
`chore:`/`docs:`/`ci:`/`test:`/`style:`/`build:` no release, anything else patch), bumps
`package.json`, builds the portable EXE and publishes a GitHub release with the EXE and its
checksum attached. A merge whose commits are all no-release types releases nothing.

The very first release is the one case with no tag to derive from, so it ships whatever version
`package.json` already carries, verbatim and unbumped. Every release after that is derived.

The notes come from the `## Unreleased` section of [CHANGELOG.md](CHANGELOG.md), and a release
with an empty section fails rather than shipping without notes. `npm run typecheck`, `npm test`
and a full `npm run package` run on every PR, so the artifact is known to build before `main`
promises it.

```powershell
pwsh -File scripts/plan-release.ps1   # what would the next merge release, and why
pwsh -File scripts/check-notes.ps1    # the PR gate's verdict, locally
pwsh -File scripts/release.ps1 -Bump minor   # bump + open a changelog section by hand
```

## License

MIT — see [LICENSE](LICENSE).
