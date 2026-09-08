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
- 007 — Light theme · S03 · Added a `prefers-color-scheme: light` branch over the existing custom
  properties (no in-app toggle), tokenised the four dark-assuming effect rules, made the window
  background follow `nativeTheme` live and the tray badge rim theme-aware, with WCAG plus OKLab
  distinguishability enforced by a unit test against the dark scheme's own worst pair; accepted
  2026-08-21.
- 010 — Popover drill-down — branch, context, model, subagents · S03 · Replaced story 002's
  eight-column row with the prototype's two-line block (identity and numbers on line 1, prose at
  full width on line 2), added collapsible group headers with a status rollup and a session detail
  block (title, last message, one row per subagent), and lifted the testable logic into
  `popoverModel.ts` + `subagentParts.ts` so popover and main window cannot describe a run
  differently; accepted 2026-08-21.
- 011 — Subagent detail — final message and declared model · S03 · Extracted a finished subagent's
  final message (clipped to 120 chars at the adapter boundary) and the model declared in the
  `Agent` call, rendered in both popover and main window, without reading the subagent's prompt and
  without the rejected `≈`-marked inherited-model guess; accepted 2026-08-21.
- 012 — S02 residuals — never hide a live session, never steal the focus · S03 · Closed all four
  points S02 left open: an unanswered pid stays unknown and re-probed (explicit `|FALSE` negative)
  and is marked on the row, the portable EXE registers its stable `PORTABLE_EXECUTABLE_FILE`
  protocol path, the popover's initial focus refuses to take focus off Pin or Close, and
  `ShortcutStatus` is declared once; accepted 2026-08-21.
- 006 — Activity matrix and history attribution · S04 · Moved the per-status group counts out of the
  popover's renderer-local `groupStatusRollup` into `ProjectGroup.statusCounts` in `aggregate.ts` and
  rendered them through a shared `StatusRollup` in both the popover (output unchanged) and the main
  window's group header, and gave `HistoryEntry` a tail-derived `usage`/`usageComplete` that
  `groupHistory()` sums per project, branch or model into collapsible sections with an explicit
  not-counted count and a `~` marker on partial totals; N5 measured at 441 ms of a 2000 ms budget;
  accepted 2026-08-22.
- 013 — S03 residuals — report what was registered, rank what is unseen · S04 · Diagnostics now
  reports the `ProtocolRegistration` startup actually wrote (including a visible failure and the real
  `process.execPath` for a packaged install) instead of recomputing a string, the popover's group
  order demotes an already-seen `waiting`/`done` below `ended` via `popoverGroupRank()` with
  `compareSessions` untouched, `--text-faint` and the light `--muted-opacity` clear 3:1 / 4.5:1 on all
  four surfaces, and the subagent list's flat-hierarchy note left `role="list"`; accepted 2026-08-22.
- 005 — Exact context windows, and the network promise it costs · S05 · Gave the app its first
  network path as an opt-in that is off by default — a pure LiteLLM `max_input_tokens`
  parser/matcher under an aborting fetch with an atomic `%APPDATA%` cache and a refresh ceiling —
  and made `ContextPressure.windowSource` carry `estimated`/`exact` to gauge, bar, CLI and
  Diagnostics so no two surfaces can disagree about where a denominator came from; the absolute
  "no network requests" promise was reworded rather than quietly broken; accepted 2026-08-23
  (opt-in half not exercised live).
- 015 — S04 residuals — a total that admits its page, and a test that cannot miss its event ·
  S05 · Gave a truncated history group total a `≥` prefix and both GUI and CLI a "Showing 200 of 438
  sessions" line, with marker and wording single-sourced in `presentation.ts` and composing with
  006's `~`, and moved the N5/N2 timing listeners ahead of `engine.start()` — which exposed and
  fixed a real pre-existing race where the initial refresh ran before `indexingHistory` was set;
  accepted 2026-08-23 (History-view half not exercised live).
- 014 — Tray tile on a light taskbar · S05 · Made the tray tile follow
  `nativeTheme.shouldUseDarkColors` with `LIGHT_STATE_COLORS` as its light palette; the derived
  light art set the story built was superseded a day later when the user rejected the generated
  tiles as unreadable, so the tile is now drawn in code from the app's own status-dot vocabulary
  and the contrast test measures an absolute floor per theme; accepted 2026-08-23 (AC 3, theme
  flip without restart, left unticked).
- 019 — The app updates itself · — · Gave the portable EXE an opt-in, off-by-default self-update:
  a daily GitHub-release check, SHA256-verified download and stage, an in-place swap right before
  the single-instance lock on the next launch, a one-time toast on the following start, a
  Settings toggle and status line, and a second named exception in N1/the README/Diagnostics —
  two `story-review-hard` rounds, the first catching stale single-exception wording plus four
  hardening gaps in the download/swap paths, both fixed and confirmed.
