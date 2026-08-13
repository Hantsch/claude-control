# Reference tool comparison — what we take, what we deliberately refuse

Timeless what/why. Status and scheduling live only in [ROADMAP.md](../ROADMAP.md); the work
itself lives as stories in [requirements/](../requirements/).

Derived on 2026-08-13 from a feature-and-usability comparison of

- **[Irrlicht](https://github.com/ingo-eichhorst/Irrlicht)** — the macOS menu-bar app this
  project was modelled on,
- **ClaudeSessionTray** (`C:\development\AIDU\Utilities\ClaudeSessionTray`) — an earlier,
  smaller Windows tray tool in C#/WinForms solving the same problem,
- and this codebase as of commit `f05267d`.

## Where the three tools stand

| | claude-control | ClaudeSessionTray | Irrlicht |
|---|---|---|---|
| Status source | transcript heuristic + registry liveness | `status` field in `sessions/<pid>.json` — **no longer exists**, see story 001 | transcript inference |
| States | 8 (incl. `queued`, `starting`, `unknown`) | 3 | 3 |
| Context gauge | yes, window **estimated** (lookup + `widened` flag) | yes, window **exact** via LiteLLM | yes, LiteLLM |
| Cost | explicit non-goal | computed, deliberately not displayed | live USD + history + projection |
| Model in the list | detail pane only, raw id string | every row, "Opus 5" | yes |
| Grouping | main window yes, **popover no** | no | yes (project / branch / worktree) |
| Notification quick-switch | no — Settings tab only | **yes, in the flyout header** | not documented |
| History | yes, with filters | no | yes + web dashboard |
| Subagent tree | yes | no | yes |
| Jump to session | IDE lock-file match → process chain → flash fallback | process chain only | — |
| Orphan filter | "never used" only | window-based | — |
| Autostart / global hotkey | no / no | manual `shell:startup` / no | — / — |
| Multi-agent | adapter seam prepared, unused | no | 11 agents |
| CLI | `npm run cli [--watch]` | no | `irrlicht-ls -w` |

The gap is not in the engine — it is almost entirely in the **popover**, which is the surface
that gets looked at fifty times a day. That is why the popover is the first milestone.

## Deliberately not taken

### Cost display — rejected for v1

Non-goal per [CONCEPT.md](../CONCEPT.md) §2. ClaudeSessionTray computes the figure and still
refuses to show it, for the reason documented in its README: it is neither what a subscription
bills nor the plan-quota percentage `/usage` reports, and it reads as both.

If cost is ever reconsidered, these corrections are what it took there to get within a few
percent of `/usage` — all measured rather than assumed. Recorded here so the groundwork is not
redone:

- **Dedupe per `requestId`.** Claude Code writes one transcript line per content block and
  repeats the *identical* `usage` object on each; counting per line inflated cost several-fold
  (one response spanned four lines).
- **Price every turn with its own model.** Mid-session `/model` switches are routine, so a
  single session-wide rate misprices everything before the switch.
- **Split 1-hour from 5-minute cache writes** — they bill differently, and the
  `cache_creation` breakdown carries the split.
- **Subagents cost money but do not define context.** Sidechain turns are billed and must be
  counted; they must be excluded from the context figure, because a subagent runs its own
  window.
- **Scope to the process run, not the transcript.** A transcript grows across every resume
  (one spanned 10 days) while `/usage`'s "Session" block counts from process start.
- **There is a floor.** Auxiliary calls (`ai-title`, away summaries, stop-hook summaries) bill
  but are never written as `assistant` turns, so no transcript-derived figure can match
  `/usage` exactly — measured at $5.24 against $5.53. Irrlicht has the same floor.
- **It is notional.** List-rate cost, not what a Pro/Max subscription is charged, and *not* the
  plan-quota percentages `/usage` also reports. That ambiguity is the reason it stayed hidden
  there, and it is the thing to solve in the presentation before showing a number.

### Web dashboard — rejected

Irrlicht serves one on `127.0.0.1:7837`. It contradicts the "no HTTP server, nothing on the
network" property stated in README.md and Settings → Diagnostics, which is a deliberate part of
what makes this tool safe to leave running. `npm run cli -- --watch` covers the scriptable case.

Note that story 005 (exact context windows) touches the same promise from the other side — an
outbound fetch, not a listening socket — and is explicitly gated on resolving that first.
