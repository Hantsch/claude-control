# Claude Control — Concept

Version 1 (2026-08-05). Author: Roland Ebner. Status: **approved scope, not yet implemented.**

---

## 1. Purpose

When several Claude Code sessions run in parallel across projects, the expensive thing is
not the work — it is the *attention switching*. A session that finished five minutes ago
and is silently waiting for you is wasted wall-clock time. A session blocked on a
permission prompt behind a minimized VS Code window is worse.

Claude Control is a Windows tray application that answers one question without you having
to look for it: **is any session waiting for me right now?** Secondarily it answers *what
have my sessions been doing* over time.

It is a read-only observer. It never writes to Claude Code's state, never sends input to a
session, and never touches the network.

---

## 2. Requirements (as agreed)

### Functional

| # | Requirement |
|---|-------------|
| F1 | List all currently running Claude Code sessions with a live status |
| F2 | Distinguish *working* from *waiting for me* from *done* |
| F3 | Tray icon reflects the most urgent status across all sessions |
| F4 | Overlay badge on the tray icon counts sessions needing attention |
| F5 | Windows toast notification when a session becomes *done* or *waiting* |
| F6 | Clicking a session (or its toast) focuses the window that session runs in |
| F7 | Historical list of past sessions |
| F8 | Filter by project |
| F9 | Context-pressure indicator per session |
| F10 | Group by git project / branch / worktree |
| F11 | Show the subagent tree under a session |

### Non-functional

| # | Requirement |
|---|-------------|
| N1 | Local machine only. No listening socket, no outbound requests, no telemetry |
| N2 | Read-only with respect to all Claude Code data |
| N3 | Portable EXE, started manually. No installer, no autostart in v1 |
| N4 | Detection latency for a status change: under ~2 s |
| N5 | Cold start to a populated session list: under ~2 s despite ~250 MB of transcripts |
| N6 | Code, documentation and UI in English |
| N7 | Claude Code is the only supported agent, but the adapter boundary is explicit |

### Explicit non-goals for v1

- Cost / USD tracking (deliberately dropped)
- Sending prompts, approving permissions, starting or killing sessions
- Any web dashboard, LAN access, or cloud sync
- Adapters for Codex / Gemini CLI / other agents
- Persistent database (see §5.4 — this is a known trade-off, revisited in §12)

---

## 3. Architecture

Single Electron process tree, no separate service to install or supervise.

```
┌─────────────────────────────────────────────────────────────────┐
│ Electron main process                                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────┐          │
│  │ core (pure TypeScript, no Electron imports)         │          │
│  │                                                     │          │
│  │  RegistryWatcher ──┐                                │          │
│  │  (sessions/*.json) │                                │          │
│  │                    ├─▶ SessionStore ──▶ StateMachine│          │
│  │  TranscriptWatcher ┘      (in-memory)      │        │          │
│  │  (projects/**/*.jsonl)                     │        │          │
│  │                                            ▼        │          │
│  │  ClaudeAdapter                        StatusEvents  │          │
│  │  (the only agent-specific code)            │        │          │
│  └────────────────────────────────────────────┼────────┘          │
│                                               │                   │
│         ┌─────────────────┬───────────────────┴──────┐            │
│         ▼                 ▼                          ▼            │
│    TrayPresenter    Notifier              WindowFocuser           │
│    (icon + badge)   (toast, debounced)    (win32 / ide locks)     │
│         │                                                         │
│         └──── IPC ────▶ Renderer (React) — session list, history  │
└─────────────────────────────────────────────────────────────────┘
```

Rules that keep this maintainable:

- **`core/` never imports Electron.** It is testable with plain Node and fixture files.
  This is what makes the state machine unit-testable, which matters because the state
  machine is where all the subtlety lives.
- **`ClaudeAdapter` is the only place that knows Claude Code's file layout and JSONL
  schema.** It emits a normalized `AgentEvent` stream. A future Codex adapter implements
  the same interface. No abstraction beyond that — no plugin loader, no registry.
- **The renderer is a pure view.** All derivation happens in main; the renderer receives
  finished view models over IPC. No filesystem access from the renderer
  (`contextIsolation: true`, `nodeIntegration: false`).

### Proposed layout

```
claude-control/
├─ docs/
│  ├─ CONCEPT.md          ← this file
│  └─ RESEARCH.md         ← measured facts the design depends on
├─ src/
│  ├─ core/
│  │  ├─ adapters/claude/ ← paths, jsonl parser, tail reader
│  │  ├─ registry/        ← sessions/*.json + PID liveness
│  │  ├─ state/           ← state machine, context pressure, subagent tree
│  │  └─ model/           ← Session, SessionStatus, ProjectRef types
│  ├─ main/               ← Electron main, tray, toasts, window focus, IPC
│  ├─ renderer/           ← React UI
│  └─ shared/             ← IPC contract types
├─ test/
│  ├─ fixtures/           ← anonymized .jsonl + sessions/*.json samples
│  └─ unit/
└─ assets/icons/          ← tray icon states
```

### Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22 + TypeScript (strict) | Same language across daemon logic and UI |
| Shell | Electron | Tray, native toast, window focus, packaging all in one |
| UI | React + Vite | Fast iteration; the UI is a list and a detail pane, nothing exotic |
| File watching | `chokidar` | Handles Windows quirks (`fs.watch` misses and duplicates) better than raw APIs |
| win32 interop | `koffi` (FFI) | For `SetForegroundWindow` etc. without a native build step |
| Packaging | `electron-builder`, portable target | N3 |
| Tests | `vitest` | Runs `core/` against fixtures with no Electron |

**Accepted cost of Electron:** ~150 MB RSS versus ~5 MB for the native macOS reference.
This was chosen knowingly for development speed and one-language consistency.

---

## 4. Data sources

All read-only. Full detail and verification in [RESEARCH.md](RESEARCH.md).

| Source | Role |
|---|---|
| `~/.claude/sessions/<pid>.json` | **Authoritative liveness.** Which sessions exist right now, their `sessionId`, `cwd`, `entrypoint`, derived `name`, `startedAt`, `procStart` |
| `~/.claude/projects/<slug>/<sessionId>.jsonl` | **Activity and status.** Timeline, `stop_reason`, `usage`, `gitBranch`, tool calls |
| `~/.claude/ide/<port>.lock` | **Window mapping.** `workspaceFolders` → VS Code `pid`, for F6 |

Using the session registry for liveness is the main departure from Irrlicht, which infers
liveness from transcript activity alone. The registry lets us say "this session is alive
but has produced nothing for 20 minutes" — which is exactly the *stale* case worth
surfacing — and distinguish it from "this session was killed".

**Privacy constraint:** `ide/*.lock` contains an `authToken`. The parser must extract only
`pid`, `workspaceFolders`, `ideName` and discard the rest without logging it. Prompt and
response *text* is read (it is needed for titles and the timeline) but never leaves the
process.

---

## 5. Reading strategy

This is where N5 is won or lost. Measured reality: 290 files, ~247 MB, ~55 000 lines.
Parsing all of it at startup is out of the question.

### 5.1 Three tiers

| Tier | What is read | When |
|---|---|---|
| **Live** | Last ~64 KB of the transcripts belonging to registry sessions (≈6 files) | On startup, then on every change event |
| **History index** | Per file: path, `mtime`, size, plus the tail of the first and last chunk to get title, start/end time, model, branch | Lazily, in the background, after the live tier is on screen |
| **Detail** | Full parse of one transcript | Only when the user opens that session |

The live tier is the only thing on the critical path: ~6 files × 64 KB ≈ 400 KB.

### 5.2 Tail reading

Open the file, seek to `max(0, size - 64 KiB)`, read forward, discard the first partial
line, parse the rest, then scan **backwards** for the newest record whose `type` is `user`
or `assistant`. If none is found in the window, double the window (bounded at 1 MiB) and
retry; if still none, mark the session `unknown` rather than guessing.

Two failure modes to handle explicitly, both observed as realistic:
- **Torn write.** The last line may be incomplete while Claude is writing. A line that
  fails `JSON.parse` at the very end of the file is skipped silently, not treated as
  corruption.
- **Bookkeeping tail.** 237 of 290 files end in a non-semantic record. Filtering these is
  mandatory, not an optimization.

### 5.3 Change detection

`chokidar` watches two roots: `~/.claude/sessions/` and `~/.claude/projects/`. Events are
coalesced per file with a **250 ms trailing debounce**, so a burst of appends during an
active turn causes one re-read, not fifty. Target latency (N4) is debounce + tail read,
comfortably under 2 s.

A **5 s low-frequency timer** handles what file events cannot express: PID liveness
re-checks, and elapsed-time-based transitions (`working` → `waiting`, `working` → `stale`).
Those transitions happen *because nothing happened*, so no event can carry them.

### 5.4 No persistent store — and what that costs

Per the agreed scope there is no SQLite index; everything is derived live and held in
memory. The consequences, stated plainly:

- History is exactly as complete as `~/.claude/projects/` is. If Claude Code rotates or
  deletes a transcript, or you clean the directory, that history is gone.
- The history index must be rebuilt on every start (backgrounded, so it does not violate
  N5, but it is repeated work).
- Aggregates over long ranges are recomputed rather than queried.

The design keeps this reversible: `SessionStore` is written behind a repository interface
so a persistence layer can be added later without touching the state machine or the UI.
That is a deliberate seam, not speculative generality — see §12.

---

## 6. Status model

### 6.1 States

| State | Meaning | Notification |
|---|---|---|
| `working` | Model is producing output, or a tool or subagent is executing | no |
| `waiting` | A tool that is normally fast is overdue — very likely a permission prompt or a question | **yes** |
| `stale` | A tool that is slow by nature is running well past its budget — probably still fine, maybe worth a look | no |
| `done` | Turn finished, control handed back to the human | **yes** |
| `queued` | Prompt enqueued but not yet started | no |
| `starting` | Session is open but has not exchanged a single message yet | no |
| `ended` | Process no longer alive; moves to history | no |
| `unknown` | Could not derive a state (parse failure, truncated file) | no |

**A status says *what*, never *how long ago*.** The original model had an `idle` state that
overrode everything past `T_idle`, so after 15 minutes of silence *every* session — including
one that had cleanly finished its turn — read as `idle`. That conflated two unrelated things:
a finished session and a forgotten one. It also made the tray a wall of grey dots, and the
information it added was already in the age column next to every row. `idle` is gone; how long
ago something happened is a *list* question, answered in §6.5.

**`waiting` and `stale` split what used to be one state.** Both mean "a tool call is overdue",
but the two cases deserve very different reactions. An overdue `Read` (normally under a second)
is almost certainly a permission prompt or a question — that is worth a toast. An overdue
`Agent` or `Bash` is usually a subagent or a build doing its job for longer than usual — that
is worth a visible marker and nothing more. Calling both "probably waiting" trained the user
to ignore the one that mattered.

`starting` was added after M2: a freshly opened Claude Code window is registered before it
writes a transcript, so without it every new window showed up as `unknown` — which reads
like a defect of this app rather than a fact about the session. `unknown` now means only
what the table says: the transcript could not be read, or its tail window held no answer.

By default a `starting` session reaches **no live surface at all** (list, popover, tray,
CLI) — the app watches sessions, and a window that has never exchanged a message is not yet
one. It would otherwise inflate every count with rows that can never need attention. This is
a presentation filter in `getSnapshot`, not a hole in the state machine: the store keeps the
session, the first prompt moves it out of `starting`, and `Settings → Hide unused sessions`
turns the filter off for anyone who wants to see open windows too.

### 6.2 Derivation

Given the last *semantic* record `R` of a live session and `now`:

```
R.type == "assistant" && stop_reason == "end_turn"        → done
R.type == "assistant" && stop_reason == "tool_use"
        && no paired tool result yet
        && age(R) <  T_work(tool)                         → working
        && age(R) >= T_work(tool) && tool is fast         → waiting
        && age(R) >= T_work(tool) && tool is slow         → stale
R.type == "user"  (a real prompt, or a tool result)       → working
enqueue seen with no matching dequeue                     → queued
```

Tool-result pairing uses `sourceToolAssistantUUID` on the `user` record, which points at
the issuing `assistant` record — no content-array id matching needed.

With several tool calls open at once, the most permissive budget wins, and *that* tool also
decides the speed class: the session is blocked on the slowest call, so a `Read` running next
to a `Bash` cannot make the pair read as a permission prompt.

A tool's **speed class is the budget itself**: anything budgeted above the default `T_work` is
"slow by nature". No second list to keep in sync, and raising a tool's budget in Settings also
stops it from claiming to be a permission prompt. A tool with no entry (an MCP server,
anything new) lands on the default and therefore in the `waiting` class — the louder of the
two, which is the right default when a tool's normal duration is unknown.

Default `T_work = 25 s`, configurable, with per-tool overrides. `Agent` gets 20 min and
`Workflow` 45 min: a fan-out that runs for a quarter of an hour is a subagent doing its job,
and the session it belongs to should read `working` the whole time.

### 6.3 The honest limitation

Transcript watching **cannot see a permission prompt.** The prompt is rendered in the
terminal; nothing is written to the transcript while it waits. So `waiting` is a heuristic:
*a tool call was issued and no result has arrived for longer than any tool normally takes.*

It will produce false positives on genuinely slow tools — a long `npm install` under
`Bash`, a large `Grep`, a subagent that runs for minutes. Three mitigations:

1. **Per-tool thresholds.** `Bash` and `PowerShell` get 120 s, `Agent` 20 min and `Workflow`
   45 min, against 10 s for `Read`, `Edit` or `Grep`, since the measured tool mix is
   dominated by `Bash`/`Read`/`Edit`.
2. **A separate state for the slow ones.** The remaining false positives all live in one
   place — slow tools running longer than usual — and that case gets `stale`: shown, but no
   toast and no badge. The alarm channel stays for the case the data actually supports.
3. **Distinct presentation.** `waiting` is shown as *"needs you?"* and `stale` as *"stale"* —
   both hedged, neither overclaiming what transcript watching can know.

If false positives remain annoying in practice, the fix is Claude Code hooks
(`Notification`, `PreToolUse`, `Stop`) posting to a local IPC endpoint, which turns the
heuristic into an exact signal. That was consciously deferred out of v1 and remains the
designated upgrade path.

### 6.4 Context pressure

Estimated prompt size from the newest `assistant` record:

```
used ≈ input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

Displayed as a fraction of the context window with thresholds 🟢 <60 % · 🟡 60–80 % ·
🔴 80–92 % · ⚠️ >92 %.

**Known gap:** `message.usage` gives the tokens, but `message.model` reports
`claude-opus-5` *without* the `[1m]` suffix that marks the 1M-context variant, so the
denominator is not directly knowable. Resolution for v1: a model → window lookup table
with a conservative 200 000 default, plus **auto-widening** — if observed usage ever
exceeds the assumed window for a session, that session is reclassified to the 1M tier
rather than pinned at a nonsensical 400 %. The gauge is labelled an estimate.

### 6.5 Tray aggregation

Icon colour = most urgent state present, in the order
`waiting` > `done` > `stale` > `working` > none.
Badge count = number of sessions in `waiting` or `done`. Empty badge when zero.
`stale` sits below `done` because a finished turn is a certainty and `stale` is a suspicion,
and it is drawn as a hollow ring rather than a disc — present, not asserting itself.

**Which sessions reach the tray.** The popover and the tray menu are the *glance* surface:
they answer "what needs me right now". Everything live is not that answer — a session whose
turn ended two hours ago and which has already been acknowledged says nothing, and a list of
eight of them buries the two rows that matter. Three ways in, `isTrayWorthy`:

1. **Something is in flight** — `working`, `waiting`, `stale`, `queued`. Age is irrelevant
   here: a subagent that has been running for two hours is the most interesting row there is.
2. **It wants attention and has not been acknowledged** — an unseen `done` is news however
   long it has been sitting there, and dropping it would silently lose the result.
3. **It did something recently** — default 30 min, configurable. The session you were just in
   stays reachable for a while even after you have clicked it away.

Everything else is *settled*: still live, still in the main window and in the CLI, just not
worth a glance. The popover shows a "· N settled" hint so the count is never a lie. The icon
and the badge are computed from the same filtered list, so what the tray claims is always
something the popover can show.

**Acknowledgement.** A badge you cannot answer is a badge you learn to ignore, so `waiting`
and `done` stop counting once the user has *seen* them: clicking the row, jumping to the
session, activating its toast, or "Mark all as seen" in the tray menu and the window header.
An acknowledged session drops out of both the badge and the icon colour while staying in the
list — the state is still true, it is just no longer news.

What re-arms it is a **news stamp**, `max(statusSince, lastActivityAt)`, recorded at the
moment of acknowledgement and compared on every derivation. A state change lifts it, and so
does any new record in the transcript — which matters because a short turn can start and
finish between two polls and would otherwise read as one uninterrupted `done`. A
re-derivation of the same state with nothing new behind it does not lift it, which is what
keeps the 5 s tick from resurrecting a dismissed badge.

### 6.6 Notification discipline

A toast fires **only on a state transition into** `waiting` or `done`, never on a
re-derivation of the same state. Rules:

- Per-session cooldown (default 60 s) so flapping cannot spam.
- A session that transitions `done` → `working` → `done` within the cooldown notifies once.
- On startup, existing states are seeded **silently** — no burst of six toasts because the
  app just launched.
- Toast body: session `name`, project, branch, and either the last assistant sentence
  (for `done`) or the pending tool name (for `waiting`). Activating the toast triggers F6.

The agreed notification set is toast + tray colour + badge. No sound, and no
suppression-when-focused rule, in v1.

---

## 7. Jump to session (F6)

Three environments are in use, in this order of importance (measured: `claude-vscode`
dominates by three orders of magnitude):

1. **VS Code** — match the session's `cwd` against `workspaceFolders` in
   `~/.claude/ide/*.lock` (case-insensitive, normalized, longest-prefix wins), then focus
   that lock's `pid`. Best effort: focus the *window*; there is no supported way to select
   a specific integrated-terminal tab.
2. **Windows Terminal / PowerShell** — walk from the session's `pid` up the parent chain
   (`Win32_Process.ParentProcessId`) to the process that owns a top-level window, and
   focus it. Tabs within Windows Terminal are not individually addressable.
3. **Claude Desktop** — focus the process's main window via the same mechanism.

Focus is done with `SetForegroundWindow` + `ShowWindow(SW_RESTORE)` via `koffi`. Windows
restricts foreground activation from background processes; when it is refused, fall back to
flashing the taskbar button (`FlashWindowEx`) rather than silently doing nothing.

If no window can be resolved, the UI says so and offers the `cwd` for copying instead of
pretending the click failed.

---

## 8. UI

Two surfaces, both English.

### Tray menu (left click on the icon)

A compact popover — the fast path, no window management:

```
Claude Control · 4 sessions · 3 settled                  📌  ✕
● Icons nacharbeiten     claude-control · main      done        3m ago
◐ G0 freigegeben        Hantsch-MMO · feature/x    working     now
◑ AI scrum sprint 02    ai-diary · main            needs you?  1m ago
○ Repo-Audit            claude · main              stale       42m ago
─────────────────────────────────────────────────────────
Open Claude Control                    Settings      Quit
```

The rows are the tray-worthy sessions of §6.5, not every live one; the "· 3 settled" hint
names what was left out and the main window shows them.

It is sized to its content and wide enough that every column fits on one line — a
horizontal scrollbar in a menu-sized surface is unusable. The title bar is a drag region, so
the window can be moved; **pinned** it stays open when it loses focus and keeps the position
it was dragged to (persisted in settings, so a parked popover survives a restart). Unpinning
drops that position and the next open snaps back to the tray icon.

### Session label

A session is labelled with its generated title (`aiTitle`, falling back to the last prompt)
on every surface — list, popover, tray menu, toasts, CLI. That is the same string VS Code
puts on its Claude Code panel and history, so a row here can be matched to a window by eye.
The registry slug (`hantsch-mmo-dc`) never appears in the IDE, so it is only a secondary,
dimmed identifier; it becomes the label just for sessions that have no title yet.

### Main window

- **Sessions** — live list, grouped by project → branch/worktree. Every row carries its own
  context-pressure bar (§6.4): how much room a session has left is what decides which one to
  go back to first, and that should not need a click. Expanding a session shows the full
  gauge, model, elapsed time, the current run, the current tool, and the subagent tree. Jump
  to session sits directly under the name, above the facts.
- **History** — past sessions with a project filter, a date range, and free-text search
  over titles. Uses `aiTitle` from the transcript as the session label when present, which
  saves inventing our own summarizer.
- **Settings** — thresholds (`T_work` and the per-tool overrides that double as the speed
  classes), how long settled sessions stay in the tray, notification toggles, and the Claude
  data directory path.

### Run duration

One *run* is a prompt and the turn it triggered: from the newest prompt record to the end of
that turn, still counting while the turn is open. The anchor is the prompt, and a single
agent-heavy turn is easily megabytes, so the prompt is usually **outside** the tail window —
measured against the real directory, 9 of 10 live sessions. The adapter therefore falls back
to a bounded backward scan (256 KB chunks, 4 MB ceiling) that stops at the first prompt, and
caches the answer per session: a *new* prompt always lands in the tail window while the app
is watching, so the scan never repeats. Beyond the ceiling the run reads `—` rather than a
guess.

### Subagent tree

Derived from `Agent` `tool_use` blocks in the parent transcript: label from the tool input,
start time from the record, completion from the paired result. That yields a real tree
(603 `Agent` calls exist in the sample history, so this is worth building).

A *finished* subagent's result carries its own numbers — `resolvedModel`, `totalDurationMs`,
`totalTokens`, `totalToolUseCount`, `usage`, `toolStats` — so each node shows the model, the
tokens the run spent, how full its context got (same estimate as a session's, and
`resolvedModel` spells out the 1M tier), its tool count and the lines it touched. While a
subagent runs, none of that exists yet; the node says so instead of showing zeros.

Two result shapes matter beyond the happy path:

- **`status: "async_launched"`** — a background subagent (`run_in_background`). The call
  returns within seconds while the run continues, so calling it *completed* would report a
  two-second run for an hour of work. It gets its own state, `launched`, with the time since
  launch and no end time, because the parent transcript never reports one.
- **A plain string result** (`"Error: Agent terminated early due to an API error: 529
  Overloaded"`) — a run that died. There are no numbers, so the node shows the reason.

**Caveat carried from research:** `isSidechain` was `true` on zero records, so a
subagent's *internal* transcript is not interleaved into the parent and its location is
unverified. v1 therefore shows the subagent as a node with status, duration and its run
numbers, not its inner timeline. Locating subagent transcripts is a tracked research task —
the `outputFile` on an `async_launched` result is a lead.

---

## 9. Adapter boundary (N7)

```ts
interface AgentAdapter {
  readonly id: string;                                  // "claude-code"
  discoverLiveSessions(): Promise<LiveSessionRef[]>;     // from its own registry
  watchRoots(): string[];                               // dirs to watch
  readStatus(ref: LiveSessionRef): Promise<SessionSnapshot>;
  indexHistory(signal: AbortSignal): AsyncIterable<HistoryEntry>;
  readDetail(id: SessionId): Promise<SessionDetail>;
}
```

Everything Claude-specific — path layout, slug encoding, JSONL record types, `stop_reason`
semantics, usage fields — lives behind this. v1 ships exactly one implementation. There is
no plugin discovery mechanism; adding an agent means adding a class and registering it.

---

## 10. Testing

The state machine is the risky part, so it is tested first and hardest.

- **Fixtures.** Anonymized real `.jsonl` excerpts and `sessions/*.json` samples committed
  under `test/fixtures/`, including the nasty cases found in research: files ending in
  `last-prompt`, `<synthetic>` model records, a torn final line, mixed slug casing,
  a stale registry entry whose PID belongs to an unrelated process.
- **Unit tests** on `core/` with `vitest`: given a transcript tail and a clock, assert the
  derived state. Table-driven, one row per scenario.
- **Latency check.** Append to a fixture transcript and assert a status change is observed
  within 2 s (N4).
- **Cold-start check.** Point the adapter at a synthetic tree of ~300 files / ~250 MB and
  assert the live tier resolves under 2 s (N5).
- **Read-only assertion.** A test that runs the full pipeline against a fixture tree and
  then verifies no file's `mtime`, size or content changed (N2). This is worth automating
  because N2 is the promise that makes the tool safe to leave running.

---

## 11. Milestones

| # | Deliverable | Covers |
|---|---|---|
| **M0** | Repo scaffold, this concept, research fixtures | — |
| **M1** | `core/` reads the registry, tails transcripts, derives status. CLI printout, no UI | F1, F2, N4, N5 |
| **M2** | Electron tray: icon states, badge, popover list | F3, F4 |
| **M3** | Windows toasts with transition + cooldown logic | F5 |
| **M4** | Jump to session — VS Code path first, then process-chain fallback | F6 |
| **M5** | Main window: live session list, git grouping, context gauge, subagent tree | F9, F10, F11 |
| **M6** | History view with project filter and search | F7, F8 |
| **M7** | Portable EXE via electron-builder, settings persistence | N3 |

M1 is deliberately shippable as a CLI. If the state machine is wrong, everything after it
is polish on a broken foundation — so it gets validated against real sessions before any
UI exists.

---

## 12. Open decisions and known risks

| Item | Position |
|---|---|
| **Single-instance lock** | Not selected in scoping. Two instances would both be read-only and harmless but would double every toast. **Recommendation: add it in M2** — Electron provides it in a few lines. Awaiting your call. |
| **`waiting` false positives** | Accepted for v1, mitigated by per-tool thresholds and by routing the slow-tool case to `stale`, which neither toasts nor badges (§6.3). Hooks are the real fix and are the designated next step if it proves noisy. |
| **History durability** | Per §5.4, history lives and dies with `~/.claude/projects/`. The repository seam is in place; if you later lose history you care about, adding SQLite is a contained change. |
| **Context-window detection** | Unresolved upstream (§6.4). Mitigated by lookup table + auto-widening, and labelled an estimate. |
| **Subagent internals** | Unverified where subagent transcripts live (§8). v1 shows nodes without inner timelines. |
| **Registry staleness on crash** | Unverified whether `sessions/<pid>.json` is always cleaned up. Mitigated by PID + `procStart` cross-check on every 5 s tick. |
| **Transcript schema drift** | The JSONL format is internal to Claude Code and can change without notice (observed version: `2.1.222`). The parser must degrade to `unknown` rather than crash, and the version is recorded per record so drift is detectable. |
| **Electron footprint** | ~150 MB RSS, knowingly accepted for a tool that runs all day. Revisit only if it becomes a problem in practice. |
