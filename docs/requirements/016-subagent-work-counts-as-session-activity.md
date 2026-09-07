---
id: 016
title: A session working through a subagent is not `done`
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-23
---

## Requirement

A session that has handed its work to a subagent looks finished. The parent transcript's last
record is `assistant / stop_reason=end_turn`, so the state machine says `done` — while the
subagent writes to its own file for another forty minutes. The user sees a settled green row,
gets a "done" toast for a turn that is not over, and the row then drops off the tray entirely
because `trayRecentMs` retires settled sessions. Two sprints running in parallel, one visible.

Reproduced on 2026-08-23, session `d59011db-…` (project `q2-launcher`, PID 30084):

```
<slug>/d59011db-….jsonl                          last write 17:24:01, last record end_turn
<slug>/d59011db-…/subagents/agent-a3df3673….jsonl  1.7 MB, still growing at 18:05:46
<slug>/d59011db-…/subagents/agent-ad4cc039….jsonl  its child, growing at 18:01:22
```

The app is not wrong about the file it reads — it reads the wrong file. The evidence it would
need is already on disk and already understood by
[subagentFiles.ts](../../src/core/adapters/claude/subagentFiles.ts), which story 011 added for
exactly this class of problem. It is just wired to one narrow case: `subagentActivityAt` is only
collected for subagent nodes whose status is `running`
([adapter.ts:252](../../src/core/adapters/claude/adapter.ts)) — i.e. an `Agent` call with no
paired result yet — and the state machine only consults it inside the `pendingTool` branch
([machine.ts:158](../../src/core/state/machine.ts)). The `end_turn` branch
([machine.ts:140](../../src/core/state/machine.ts)) is unconditional.

There are at least two shapes where a subagent is demonstrably working and the parent transcript
has no open call to hang that on:

- **A background launch.** Its result says "launched", the node's status is `launched`, and
  `runningSubagentCount` deliberately does not count it
  ([subagents.ts:124–136](../../src/core/state/subagents.ts)) because nothing in the transcript
  ever reports its end. Nothing in the *transcript*, that is — its file says plenty.
- **A re-tasked agent, which is the case observed above.** The `Agent` call returned
  `status: "completed"` at 17:17, and the parent then kept the same agent working by sending it
  two messages (`SendMessage` at 17:17 and 17:23, both paired). The node reads `completed`, there
  is no pending call at all, and the session ended its turn while the agent it is waiting on ran
  on for another 48 minutes.

So the rule cannot be "rescue an overdue pending call" — that is what exists. It has to be
"subagent files under this session are being written, therefore this session is working",
independent of what the parent transcript's node statuses say.

Note what stays true: the status the transcript reports is not *wrong* as a statement about the
transcript, and §4's read-only/metadata-only promise must not be spent on this — the existing
reader only stats files and opens no subagent transcript, and that has to survive.

## Acceptance Criteria

- [ ] A session whose only current activity is a subagent writing under
      `projects/<slug>/<sessionId>/subagents/` is not shown as settled on any live surface —
      not in the main window, not in the popover, not in the tray badge, not in the CLI
- [ ] This holds for a subagent that was launched in the background, and for one whose `Agent`
      call already returned and that is being kept working by `SendMessage`
- [ ] The row's "last activity" reflects the newest subagent write, not the parent's last record
      — no more "26m ago" next to a file that was written four seconds ago
- [ ] No `done` notification fires while subagent work is demonstrably still going on
- [ ] When the subagent work really stops, the session settles within a bounded, stated time and
      stays settled — no flapping between working and done
- [ ] The status reason names the evidence, the way the `pendingTool` branch already does
      ("its subagent wrote 4s ago")
- [ ] The added disk work stays inside the tick budget (N4) and still opens no subagent
      transcript — metadata only, per CONCEPT §4
- [ ] A session with no `subagents/` directory, and an agent version that writes none, behaves
      exactly as it does today

## Open Questions

- **Own status, or `working` with a different reason?** A session whose turn has ended but whose
  delegate is running is not the same thing as a session mid-turn: it is not going to answer the
  user, and a permission prompt cannot be pending in it. A distinct state would say that
  honestly, but it costs a tray colour, a badge rule, a notification rule and a CLI label. The
  cheaper reading — `working`, reason "subagent still writing" — spends none of those. This is
  the product question of the story.
- **What counts as "still working"?** Newest write under `subagents/` more recent than T. Which
  T? The `Agent` per-tool budget (20 min, `DEFAULT_THRESHOLDS`) is the existing number, but it
  is a budget for *overdueness*, not a liveness window — a subagent between two tool calls can
  easily be quiet for a minute, and one that died leaves a file that is quiet forever.
- **How wide is the scan?** Newest mtime across the whole `subagents/` directory is the simplest
  rule and needs no link to the node tree at all; restricting it to files linked to a node is
  cheaper to justify but is exactly the link that failed in the re-tasked case. Cost matters:
  this runs per live session per 5 s tick, and `SubagentActivityReader`'s cache is keyed on the
  directory mtime, which does not change when an existing file grows.
- **Does the "· Agent ●● 1/2" chip change too?** `runningSubagentCount` skips `launched` runs by
  design. If the session is now called working *because* of such a run, a chip that says zero
  subagents is the next contradiction.
- **History.** `deriveHistoricalStatus` asks "how did this session end", evaluated at its last
  record. Presumably untouched — but say so, rather than leaving it to be discovered.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
