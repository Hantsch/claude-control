# Claude Control

A Windows tray application that shows you, at a glance, what every Claude Code session
on your machine is doing — and tells you when one is finished or needs you.

Inspired by [Irrlicht](https://github.com/ingo-eichhorst/Irrlicht) (macOS menu bar),
rebuilt for Windows with a Node/TypeScript daemon and an Electron tray shell.

## Status

**Concept phase.** No implementation yet. See [docs/CONCEPT.md](docs/CONCEPT.md) for the
design and [docs/RESEARCH.md](docs/RESEARCH.md) for the measured facts about Claude Code's
on-disk data that the design rests on.

## What it will do

- **Live status** for every running session: working / waiting for you / done / idle
- **Tray indicator** that takes on the most urgent status across all sessions, with an
  overlay badge counting sessions that need attention
- **Windows toast** when a session finishes a turn or appears to be blocked on a permission
  prompt — click the toast to jump to that session's window
- **History** of past sessions, filterable by project
- **Context pressure** gauge so you can intervene before auto-compaction degrades a session
- **Git context** (project / branch / worktree) and the subagent tree under each session

## What it will not do

- Send prompts to sessions, approve permissions, or start/kill sessions — it is read-only
- Track cost in USD (explicitly out of scope for v1)
- Expose anything over the network — local machine only, no HTTP server, no telemetry
- Support agents other than Claude Code in v1 (the adapter boundary is designed for it)

## License

MIT — see [LICENSE](LICENSE).
