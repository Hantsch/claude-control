# Changelog

All notable changes to Claude Control. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/).

Notes for the next release go under `## Unreleased` — the release workflow refuses to publish
while that section is empty, and promotes it to the new version section on release.

## Unreleased

<!-- Add your changes here as '- ...' items. A release is blocked while this section is empty. -->

- First public release.
- **Live session status** for every running Claude Code session: working / needs you? / stale /
  done / queued. A status says what is going on, never how long ago — a turn that finished an
  hour ago still reads `done`.
- **Tray indicator** taking on the most urgent status across all sessions, with an overlay badge
  counting the sessions that need attention. The tile is drawn in code and follows the Windows
  light/dark taskbar.
- **Popover** with sessions grouped by project, collapsible groups, per-group status counts, the
  waiting reason spelled out, and a drill-down showing what the session last said plus one row
  per subagent with its own model and context.
- **Windows toasts** when a session finishes a turn or looks blocked on a permission prompt.
  Click to jump to that session's window; act on it without opening the app.
- **History** of past sessions, filterable by project, date and free text, grouped by
  project / branch / model with totals.
- **Context pressure gauge** so you can intervene before auto-compaction degrades a session.
  Exact context windows are available as an opt-in (off by default) that fetches LiteLLM's
  community table; without it the gauge shows a clearly marked estimate.
- **Autostart and a global hotkey**, both configurable, so the popover is reachable without a
  mouse and the app is running when it matters.
- **Light theme** following the OS colour scheme, contrast-tested against WCAG ratios.
- **Read-only towards Claude Code** — the app never writes into `~/.claude`, and exposes nothing
  on the network: no listening socket, no HTTP server, no telemetry.
