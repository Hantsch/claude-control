# Implementation notes

How [CONCEPT.md](CONCEPT.md) maps onto the code, and the decisions taken where the concept
left a choice open. Written after building v1 (2026-08-05); the concept itself is unchanged
and remains the reference.

---

## 1. Where each part of the concept lives

| Concept | Code |
|---|---|
| §3 core / no Electron imports | `src/core/**` — enforced by `test/unit/boundaries.test.ts`, which scans every file under `src/core` for an Electron import (typecheck does *not* enforce this: `tsconfig.node.json` covers `core/` and `main/` in one project) |
| §3 `ClaudeAdapter` boundary | `src/core/adapters/claude/{adapter,paths,records,jsonl,tail,summarize,ide}.ts` |
| §4 registry as authoritative liveness | `src/core/registry/registry.ts`, `src/core/registry/liveness.ts` |
| §4 `ide/*.lock` privacy constraint | `src/core/adapters/claude/ide.ts` — `parseIdeLock` picks three fields by name; `authToken` is never read into a variable |
| §5.1 three tiers | live: `ClaudeAdapter.readStatus`; history index: `ClaudeAdapter.indexHistory`; detail: `ClaudeAdapter.readDetail` |
| §5.2 tail reading, window doubling | `src/core/adapters/claude/tail.ts` |
| §5.2 torn write / bookkeeping tail | `src/core/adapters/claude/jsonl.ts`, `records.ts` (`SEMANTIC_TYPES` allow-list) |
| §5.3 250 ms debounce, 5 s tick | `src/core/watch/watcher.ts`, `ControlEngine.startTick` |
| §5.4 repository seam | `src/core/store/sessionStore.ts` (`SessionRepository` + `InMemorySessionStore`) |
| §6.1/§6.2 state machine | `src/core/state/machine.ts` |
| §6.3 per-tool thresholds | `src/core/model/settings.ts` (`DEFAULT_THRESHOLDS.perToolWorkMs`) |
| §6.4 context pressure + auto-widening | `src/core/state/contextPressure.ts` |
| §6.5 tray aggregation | `src/core/state/aggregate.ts`, `src/main/tray.ts` |
| §6.6 notification discipline | `src/core/state/notifications.ts` (pure decision), `src/main/notifier.ts` (rendering) |
| §7 jump to session | `src/main/focus/{focuser,win32,processChain}.ts` |
| §8 tray popover | `src/renderer/popover.tsx`, `src/main/windows.ts` |
| §8 main window | `src/renderer/App.tsx` + `components/**` |
| §9 adapter interface | `src/core/adapters/types.ts` |
| §10 fixtures and tests | `test/fixtures/samples/**` (committed files, see `test/fixtures/README.md`), `test/fixtures/builders.ts`, `test/unit/**` |
| §11 M1 CLI | `src/cli/index.ts` |
| N3 portable EXE | `electron-builder.yml`, `npm run package` |

---

## 2. Decisions taken where the concept left a choice

### Single-instance lock — added (§12 said "Recommendation: add it in M2, awaiting your call")

`app.requestSingleInstanceLock()` in `src/main/index.ts`. A second launch focuses the
existing window instead of starting a second observer. Without it every toast would fire
twice, which defeats the purpose of the app. **Revert by deleting the guard** if you want two
instances.

### `queue-operation: "remove"` — a third operation the research did not name

§6.2 says "enqueue seen with no matching dequeue → queued". A census over all 290 real
transcripts found a third value: `enqueue` 997, `dequeue` 775, **`remove` 218** — a queued
prompt the user withdrew. Counting only enqueue/dequeue left real sessions pinned to
`queued` permanently, and `queued` is deliberately invisible to the tray colour, the badge
and the toasts, so a finished session would never announce itself.

`hasPendingQueueEntry` therefore reduces to a single question: **is the newest
`queue-operation` in the tail window an `enqueue`?** Anything else — `dequeue`, `remove`, or
a value this version has never seen — clears. A false `queued` silences the app; a missed one
costs a single toast, so the rule is deliberately biased towards "not queued".

The known cost: `enqueue A, enqueue B, dequeue A` reports "not queued" although B is still
pending. At that moment A has just started, so the session derives as `working` and `queued`
would have been suppressed anyway. Regression fixtures:
`test/fixtures/samples/.../queue-remove.jsonl` and five rows in `test/unit/machine.test.ts`,
including the `enqueue, enqueue, remove` shape that a counting-only rule gets wrong.

### Status derivation details the concept did not spell out

- **Parallel tool calls in one assistant record.** §6.2 assumes one pending call. When a
  record issues several (`Read` + `Bash` together), the machine uses the *most permissive*
  per-tool threshold of the unpaired set, so a fast tool running next to a slow one cannot
  produce a false overdue verdict — and the tool that set that threshold also decides the
  speed class, since it is the call the session is really blocked on.
- **A partially answered turn.** If the newest semantic record is a tool result but an
  earlier call of the same record is still unanswered, the session stays `working` — that is
  the literal §6.2 rule (`R.type == user → working`). Those calls are kept as
  `stalledTools` and drive the "current tool" display, but never escalate to an overdue
  state.
- **`queued` priority.** §6.2 lists `queued` without an ordering. It is applied after the
  base state and only when the session is not `working`/`waiting`/`stale`, so an enqueued
  prompt never masks a turn that is actually running — and an overdue turn is still a
  running one.
- **Nothing decays with age.** The `T_idle` rule that turned every state into `idle` is gone
  (§6.1): elapsed time produces at most one transition, `working` → `waiting` or
  `working` → `stale`, and the session stays there. Whether an old session is still worth
  showing is decided by `isTrayWorthy`, not by the state machine.
- **Speed class = budget.** `isSlowTool` is `workThresholdFor(tool) > tWorkMs` rather than a
  second hard-coded list, so the two can never disagree and the Settings sliders are the
  single knob. `Agent` (20 min) and `Workflow` (45 min) are the reason a long-running
  subagent reads `working`, and `stale` rather than `waiting` when it does go over.
- **`stop_sequence`** (36 records in the sample) is treated as output, not as a handover —
  only `end_turn` means `done`.

### Tray icon rendering

The tiles are shipped art in `assets/icons/`, assembled by `npm run icons`
(`scripts/build-icons.py`, needs Python + Pillow) from the generated art in
`output/imagegen/claude-monitor`. Beyond the ring colour, each state keeps a distinct ring:
`working` blue, `waiting` amber, `stale` the same ring desaturated and dimmed, `done` green,
`mixed` split blue/green, `none` no ring at all — so the states are distinguishable without
relying on colour alone.

Three things about the layout are deliberate:

- **One tile per physical size** (`tray/16|20|24|32|40|48/`). Windows hands the tray a fixed
  pixel box — 16 px per 100 % of display scaling — and resamples whatever it is given. The
  ring is a thin stroke and does not survive that, so `trayPixelSize` picks the tile that
  needs no resampling, and the tray is rebuilt when display scaling changes.
- **`stale` is derived, not generated.** The art set has five states, the tray has six icons.
  Deriving `stale` from `waiting` gives the two overdue states the same shape in different
  intensities, which is the relationship they have everywhere else (§6.3).
- **The badge is still drawn in code** (`src/main/tray-icons.ts`: a 3×5 pixel font composited
  onto Electron's premultiplied BGRA bitmap). It is a function of a live count, so shipping it
  would mean 6 states × 11 counts × 6 sizes of near-identical art. The same file draws a plain
  fallback tile, used only if an asset cannot be read, so a missing file degrades the tray
  instead of blanking it.

The art also supplies the window icon (`app.ico`, `app.png`) and one toast logo per notifying
status (`app-waiting.png`, `app-done.png`), so a toast is readable as "finished" or "needs you"
from its logo alone.

### Window focus: one VS Code process, many windows

Measured while building: one VS Code process (`pid` in every `ide/*.lock`) owns **one window
per open workspace**. §7 says "focus that lock's `pid`", which is ambiguous with three
windows under one pid. `findWindowForPid` therefore takes the matched workspace folder's name
as a title hint and picks the window whose title contains it. Verified against three
concurrently open workspaces.

`koffi` is loaded lazily inside a `try`/`catch`; if it cannot load, focus falls back to
`WScript.Shell.AppActivate` via PowerShell, and the Settings → Diagnostics pane names the
backend in use. When Windows refuses foreground activation, `FlashWindowEx` flashes the
taskbar button and the UI says so rather than claiming success.

### Session labels

`aiTitle` is used as the label when present (§8). The fallback is the newest prompt, but raw
prompts contain machinery the user never typed — slash-command wrappers
(`<command-name>/goal</command-name>`), system reminders, IDE selection blocks, and Claude
Code's fixed "Caveat: …" preamble for local-command output. `cleanPromptText` strips those.

### History table wording

`finalStatus` is the state a transcript ended in, evaluated at the moment of its last record.
`working` for a session that is over means "cut off mid-turn", so the history table says
exactly that (`HISTORY_FINAL_LABEL` in `src/shared/presentation.ts`). The underlying status
vocabulary is unchanged.

### Four deviations from the §9 adapter interface

Two added methods:

- `readHistoryEntry(path)` — indexing one transcript, used when a session ends so it appears
  in history without re-walking the tree.
- `listIdeWindows()` — the window mapping is agent-specific data (`~/.claude/ide/*.lock`), so
  it belongs behind the adapter rather than in `main/`.

Two changed signatures:

- `watchRoots(): WatchRoot[]` instead of `string[]` — the watcher needs the kind of each root
  (registry / transcripts / ide) to route the event, and a depth, because
  `projects/<slug>/<id>.jsonl` is one level deeper than the other two roots.
- `readDetail(id, transcriptPath?)` — the caller usually already knows the path from the live
  session or the history entry, and passing it avoids re-scanning every project directory.

### Efficiency detail not in the concept

On every 5 s tick the engine `stat`s each live transcript and re-reads it only when size or
mtime changed; otherwise it re-derives the status from the cached facts. Elapsed-time
transitions (`working` → `waiting`, `working` → `stale`) therefore cost no file reads, which
is what keeps an all-day tray app close to idle.

### Debounce ceiling

§5.3 specifies a 250 ms trailing debounce. A pure trailing debounce can be starved: appends
arriving less than 250 ms apart keep resetting the timer, so a long active turn could delay
detection past N4's 2 s. `FileWatcher` therefore also carries a max-wait (default 1 s) — the
buffer flushes at the debounce *or* one second after the first pending event, whichever comes
first. Covered by the burst test in `test/unit/pipeline.test.ts`.

---

## 3. Requirements coverage

| # | Where |
|---|---|
| F1 live list | `ControlEngine.getSnapshot` (Sessions view) and `traySessions` (popover, tray menu) |
| F2 working / waiting / done | `core/state/machine.ts`; the two overdue cases split into `waiting` ("needs you?") and `stale` (§6.3) |
| F3 tray icon = most urgent | `trayStateFor`; `trayIconFor` adds the `done` + `working` tile; art loaded by `icon-assets.ts` |
| F4 overlay badge | `paintBadge` onto the tile in `icon-assets.ts`; empty at zero |
| F5 toast on done/waiting | `Notifier` + `NotificationGate` |
| F6 click focuses the window | `WindowFocuser`; toast click, popover row click, row double-click, detail button |
| F7 history | `indexHistory` + `InMemorySessionStore.listHistory` + History view |
| F8 project filter | `HistoryQuery.projectKey`, plus a project filter on the live list |
| F9 context pressure | `ContextWindowEstimator`, `ContextGauge` |
| F10 group by project / branch | `groupSessions`, Sessions view |
| F11 subagent tree | `buildSubagentTree`, `SubagentTree` |
| N1 local only | no network code; renderer CSP `default-src 'none'`; no `publish` target |
| N2 read-only | files opened `'r'` only; asserted by the fingerprint test in `test/unit/pipeline.test.ts` |
| N3 portable EXE | `electron-builder.yml` (`portable`, `requestExecutionLevel: user`), no autostart |
| N4 < ~2 s latency | 250 ms debounce + tail read; asserted by the latency test |
| N5 < ~2 s cold start | live tier only (~6 × 64 KB); asserted against a ~250 MB tree; measured 285 ms against the real `~/.claude` |
| N6 English | code, comments, UI |
| N7 explicit adapter boundary | `core/adapters/types.ts`, one implementation, no plugin loader |

---

## 4. Known limitations carried forward

- `waiting` remains a heuristic (§6.3), now narrowed to overdue *fast* tools so the slow-tool
  false positives land in the silent `stale` state instead. Hooks are still the designated
  upgrade path to an exact signal.
- Subagent *inner* timelines are still unavailable (`isSidechain` false everywhere), so
  `SubagentNode.children` exists but stays empty.
- The context window is still an estimate; auto-widening only ever widens.
- History lives and dies with `~/.claude/projects/` (§5.4); the repository seam is where
  SQLite would go.
- The project-slug rule is derived from observation (`[\\/:.]` → `-`). If it is ever wrong,
  transcript resolution falls back to scanning project directories for the session id, so a
  wrong slug degrades performance, not correctness.
