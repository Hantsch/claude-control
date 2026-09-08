# Changelog

All notable changes to Claude Control. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/).

Notes for the next release go under `## Unreleased` — the release workflow refuses to publish
while that section is empty, and promotes it to the new version section on release.

## Unreleased

<!-- Add your changes here as '- ...' items. A release is blocked while this section is empty. -->

## 1.1.0 — 2026-09-08

- **An aborted turn is its own status.** Interrupting a session (Esc) leaves a `user` record
  behind, which read as "a prompt was just submitted" → `working`. Because `working` means a
  turn is in flight, the row could never leave the popover and "Mark as seen" refused to touch
  it. Such a session now reads `interrupted`: it never notifies, never counts towards the
  badge, and leaves the popover the ordinary way. The marker no longer becomes the row's label
  or resets the run clock either.
- **Refresh in the popover** (⟳ in its header) forces a re-read of every live transcript, for
  when you want the list confirmed rather than watched. Its tooltip says how old the current
  snapshot is.
- **"Mark all as seen" is hidden instead of greyed out** when there is nothing settled to
  clear.
- **The app can update itself now — if you let it.** Flip it on in Settings and it checks
  GitHub once a day, downloads and checksum-verifies the release, and swaps itself in the next
  time you start it. No relaunch, no releases page to babysit, no EXE to overwrite by hand. Off
  by default, and Settings tells you exactly when it last checked, what's staged, and why it
  didn't work if it didn't.
- **A one-time "Updated to vX.Y.Z" toast** on the first start that's actually running the new
  version, so you know it happened.

## 1.0.0 — 2026-09-07

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
- Sessions are named the way VS Code names them. The generated title is written once, early in
  the transcript, so on a session that had been running a while it fell outside the read window
  and the row fell back to Claude Code's derived slug (`q2-launcher-7e`); it is now looked up
  once per session and kept.
- **A start shows only what still matters:** a session that was already `done` when Claude
  Control started is not news, so it stays out of the list, the popover and the tray badge
  until it does something new — then it comes back on its own. Settings → Session list →
  "Hide sessions already done at start" turns it off; history is unaffected.
- **Show in Claude Control** in a popover row's right-click menu: opens the main window on that
  session, whose detail now shows the **session ID with a copy button**.
