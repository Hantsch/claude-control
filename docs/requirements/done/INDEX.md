# Story history

One line per finished story, appended by `/ai-scrum:build` when it moves the file here.
Format: `- NNN — <title> · <sprint or —> · <one-sentence result>`.

The full texts live next to this file. This index is the fast overview — do not turn it into a
second roadmap.

- 001 — Registry status field — record its absence, use it if it returns · S01 · Documented the
  field's absence on all sampled Claude Code versions and wired a highest-priority, non-decaying
  `waiting` override plus reported/inferred provenance through the state machine, engine and UI.
- 002 — Popover at a glance · S01 · Grouped popover rows by project with model, waiting-reason,
  tool/subagent and uptime cells, a haloed waiting dot, a waiting count in the header and an
  in-renderer notification quick-switch; live acceptance completed 2026-08-21.
- 003 — Reach the popover without hunting for it · S02 · Autostart via login item (re-applied
  every start, so a moved portable EXE self-heals), a configurable global shortcut (default
  `Ctrl+Alt+C`) with conflict warning, and arrow/Enter/Esc keyboard navigation in the popover;
  accepted 2026-08-21.
- 004 — Noise control — abandoned sessions and actionable toasts · S02 · Same-folder orphan
  filter behind an injected fail-safe window probe, an in-memory per-session toast mute, and
  two-button Windows toasts ("Jump", "Mute this session") via `toastXml` + protocol activation;
  accepted 2026-08-21.
