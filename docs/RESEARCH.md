# Research: Claude Code's on-disk state

Everything in this document was **measured on the development machine** (Windows 11,
Claude Code `2.1.222`) on 2026-08-05, not inferred from documentation. Numbers are from
that snapshot; treat them as orders of magnitude, not constants.

The point of this document is that the design in [CONCEPT.md](CONCEPT.md) must rest on
verified facts. Where something is unverified, it says so explicitly.

---

## 1. Live session registry — `~/.claude/sessions/<pid>.json`

**This is the most important finding.** Claude Code maintains one small JSON file per
*running* session, named after its process ID:

```json
{
  "pid": 17152,
  "sessionId": "69cb5be8-3950-4b5e-b77c-5119289cb26e",
  "cwd": "c:\\development\\Hantsch\\claude-control",
  "startedAt": 1785920941525,
  "procStart": "134303945409015547",
  "version": "2.1.222",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "claude-vscode",
  "name": "claude-control-d5",
  "nameSource": "derived"
}
```

Verification: 6 files were present, and all 6 PIDs resolved to live `claude.exe` processes
via `Get-Process`. No stale entries in that sample — but the design must not assume that.

Why it matters: Irrlicht infers liveness from transcript file activity, which cannot
distinguish "session is thinking" from "session was killed mid-turn". This registry gives
**authoritative liveness** directly. `procStart` (a Windows process creation timestamp)
guards against PID reuse: a PID that is alive but whose creation time differs means the
registry entry is stale.

`name` / `nameSource: "derived"` gives a human-readable label for free.

**Unverified:** whether the file is removed reliably on crash or hard kill. The design
therefore treats the registry as a *candidate list* and always cross-checks the PID.

**No `status`, `waitingFor`, or `updatedAt` field exists in the registry file.** These
three fields were specifically looked for as a possible authoritative source for session
state (see §6.2 of [CONCEPT.md](CONCEPT.md)), and their absence was confirmed.

Verification: all 10 live session files present on the machine on 2026-08-13 (Claude Code
`2.1.228` and `2.1.229`) were inspected; none contained `status`, `waitingFor`, or
`updatedAt`, or any field resembling them.

**Unverified:** all 10 sampled files had `entrypoint: "claude-vscode"`. Whether a
`status`/`waitingFor`/`updatedAt` field exists for other entrypoints (e.g. plain CLI,
non-VS Code) was not checked, so this negative finding is scoped to `claude-vscode`
sessions.

---

## 2. Transcripts — `~/.claude/projects/<slug>/<sessionId>.jsonl`

The directory slug is the working directory with separators replaced by `-`
(`c:\development\Hantsch\claude-control` → `c--development-Hantsch-claude-control`).
Note that slugs are **case-inconsistent** across the sample (`C--development-...` and
`c--development-...` both occur for what is effectively the same drive) — path matching
must be case-insensitive and normalized.

Scale measured across the whole history: **290 transcript files, 23 project directories,
~247 MB, ~55 000 lines.**

### Record types

Both semantic content and bookkeeping share the same file. Observed `type` values:

| `type`                  | Semantic? | Notes |
|-------------------------|-----------|-------|
| `user`                  | yes       | Human prompt **or** a tool result (see below) |
| `assistant`             | yes       | Model turn, carries `message.usage`, `message.model`, `stop_reason` |
| `queue-operation`       | no        | `enqueue` / `dequeue` of queued prompts |
| `ai-title`              | no        | Generated session title, rewritten repeatedly |
| `last-prompt`           | no        | Bookkeeping pointer (`leafUuid`) |
| `file-history-snapshot` | no        | Edit-undo snapshot |
| `attachment`            | no        | e.g. `deferred_tools_delta` |
| `mode`, `system`        | no        | Seen only as final lines in some files |

**Critical consequence:** "the last line decides the state" is wrong as stated. The last
line per file was `last-prompt` in **237 of 290 files** — bookkeeping, not content. State
derivation must scan backwards to the last record whose `type` is `user` or `assistant`
and ignore everything else.

### Useful fields on semantic records

Present on `user`, `assistant` and `attachment` records:
`sessionId`, `uuid`, `parentUuid`, `timestamp`, `cwd`, `gitBranch`, `version`,
`entrypoint`, `isSidechain`, `userType`.

`gitBranch` means the git context is available per record with **no git process invocation
at all** — branch changes mid-session are visible in the timeline.

`entrypoint` distribution across the sample: `claude-vscode` 42 544, `cli` 366,
`sdk-py` 60, `claude-desktop` 38. In practice this user is almost entirely in VS Code,
which sets the priority for the window-focus feature.

### Assistant records

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-5",
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 2,
      "cache_creation_input_tokens": 10135,
      "cache_read_input_tokens": 22753,
      "output_tokens": 268,
      "service_tier": "standard"
    }
  },
  "requestId": "...", "effort": "..."
}
```

`stop_reason` distribution: `tool_use` 23 502, `end_turn` 1 051, `stop_sequence` 36.
So `end_turn` is the reliable "the model handed control back to the human" marker, and it
is rare enough (~4 % of assistant records) that using it as the "done" trigger will not
spam.

Models observed: `claude-opus-5`, `claude-sonnet-5`, `claude-opus-4-8`, `claude-fable-5`,
`claude-opus-4-7`, plus `<synthetic>` (36 records — must not crash the parser).

**Note on context windows:** `message.model` reports `claude-opus-5`, *without* the
`[1m]` suffix that distinguishes the 1M-context variant from the 200k default. Context
pressure therefore cannot be computed from `message.model` alone — see CONCEPT.md §6.

### Tool-result linkage

Tool results arrive as `type: "user"` records carrying `toolUseResult` and
`sourceToolAssistantUUID`, which points back at the `assistant` record that issued the
call. That gives a direct pairing without having to match `tool_use` ids inside content
arrays.

### Subagents

`Agent` tool calls are common: **603** occurrences (vs. `Bash` 3 238, `Read` 3 189,
`Edit` 2 333, `Write` 827, `Grep` 788, `PowerShell` 463, `TodoWrite` 460). There is no
`Task` tool in this version — the tool is named `Agent`.

**However:** `isSidechain` was `true` on **zero** records across all 290 files. So the
field exists but subagent transcripts are *not* interleaved into the parent file. The
subagent tree is therefore derived from `Agent` `tool_use` blocks in the parent transcript
(label, start time, and completion via the paired result).

#### Where subagent detail lives — resolved (2.1.241)

That open question is answered: each run gets its own transcript next to the session's,

```
projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl
projects/<slug>/<sessionId>/subagents/agent-<agentId>.meta.json
```

with the sidecar naming the link back to the parent call:

```json
{"agentType":"general-purpose","description":"Build story 042","toolUseId":"toolu_013H77…","spawnDepth":1,"model":"sonnet"}
{"agentType":"deliverable-hard","description":"D4: …","toolUseId":"toolu_01DCYJ…","parentAgentId":"a4468e4145a5b6128","spawnDepth":2}
```

Records inside those files *do* carry `isSidechain: true` and an `agentId`; `parentAgentId`
+ `spawnDepth` give the real nesting the parent transcript cannot show.

Two consequences, one taken and one not:

- **Taken:** a run's `mtime` says whether it is still working. Without it a fan-out went
  `stale` after the `Agent` budget (20 min) while every subagent was demonstrably busy —
  the parent transcript gets nothing at all between the call and its result. Only file
  metadata is read; nothing inside a subagent transcript is opened, so §4's rule that
  prompts are never read is untouched.
- **Not taken:** the sidecars would also let `children` be filled in and the flat-list
  disclaimer dropped. That is a UI change, not a correctness one, and is still open.

---

## 3. VS Code window mapping — `~/.claude/ide/<port>.lock`

```json
{
  "pid": 25196,
  "workspaceFolders": ["c:\\development\\Hantsch\\claude"],
  "ideName": "Visual Studio Code",
  "transport": "ws",
  "runningInWindows": true,
  "authToken": "..."
}
```

This maps a workspace folder to an IDE process, which is the missing link for "jump to
session": match a session's `cwd` against `workspaceFolders`, then focus that `pid`'s
window. The file also contains an `authToken` — Claude Control must **never** read, log,
or transmit that field.

**Caveat (2.1.241):** `~/.claude/ide/` is frequently *empty* while `claude-vscode` sessions
are running — the locks are not a dependable index, so the jump has to survive without
them. The fallback then walks the parent chain (§7), and for a VS Code terminal that chain
ends at the **shared** main `Code.exe`: measured, one pid (20400) owned three top-level
windows, one per workspace, while its `MainWindowHandle`/`MainWindowTitle` named just one
of them. The pid is therefore not an answer on its own — the window has to be picked out of
that process's window list by the session's own folder name, which VS Code puts in the
title (`sprint.md - q2-launcher - Visual Studio Code`).

---

## 4. Other directories inspected

| Path                        | Contents | Useful? |
|-----------------------------|----------|---------|
| `~/.claude/daemon.status.json` | `supervisorPid`, `workers: {}` | Not for session status; workers was empty |
| `~/.claude/jobs/<id>/state.json` | background job state | Possibly relevant later, not for v1 |
| `~/.claude/session-env/<sessionId>` | per-session env dirs | Confirms sessionId set, no status |
| `~/.claude/history.jsonl` | prompt history | Not needed |

---

## 5. Consequences for the design

1. **Liveness comes from the session registry**, not from transcript activity. This is a
   real improvement over the reference project.
2. **Never full-parse on startup.** 247 MB is too much. Status needs only the tail of each
   active transcript; history needs only cheap metadata. See CONCEPT.md §5.
3. **Filter bookkeeping record types** before deriving state, or 237 of 290 sessions will
   be misread.
4. **`end_turn` is the "done" signal.** Low frequency, unambiguous meaning.
5. **Path matching must be case-insensitive and normalized** because of the slug casing
   inconsistency.
6. **The parser must tolerate junk**: `<synthetic>` models, missing `stop_reason`,
   truncated final lines while a session is mid-write.
