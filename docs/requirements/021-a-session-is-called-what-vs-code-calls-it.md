---
id: 021
title: A session is called what VS Code calls it
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

A row is only useful if the user can match it to the Claude Code tab in front of them. The
label rule is `aiTitle ?? lastPromptText ?? registry name`
([engine.ts:583](../../src/core/engine.ts), [presentation.ts:142](../../src/shared/presentation.ts)),
and on 2026-10-30 it produced, for live sessions on the user's machine
([RESEARCH.md §6](../RESEARCH.md)):

- `Another Claude session sent a message: <` — a running `/sprint S37`, named after the
  hand-back of one of its own background agents;
- `The user opened the file c:\development\` — an IDE notice that rides in front of a prompt;
- `commit` twice, in two projects — real prompts, but not what VS Code shows for either.

Three causes, all measured:

1. **Only `ai-title` is read.** VS Code's session list takes a `custom-title` record (written
   by `/rename`, sticky) over `ai-title`. A session the user renamed is shown here under the
   name they replaced.
2. **Half the sessions have no `ai-title`.** 6 of 12 live transcripts had none — short or
   slash-command-first sessions do not get one. They fall through to `lastPromptText`.
3. **`lastPromptText` is not the last prompt.** `isPromptRecord`
   ([records.ts:124](../../src/core/adapters/claude/records.ts)) accepts every `user` record
   that is not a tool result or an interrupt. User records now say where they came from
   (`promptSource`, `turnOrigin`, `origin.kind`, `isMeta`), and over the newest 150
   transcripts the human ones were a minority: 413 peer hand-backs, 219 meta records and 200
   task notifications against 255 human prompts. The same predicate sets the run start, so
   every background hand-back also resets "running for …".

Claude Code already keeps the answer the fallback is trying to reconstruct: a `last-prompt`
record with the human prompt in `lastPrompt`, present in all 12 live transcripts.

What the user should get: the name on a row is the name on the VS Code tab; where VS Code
has no title yet, the row shows what the user last typed — never something a machine
injected.

## Acceptance Criteria

- [ ] **AC1** — A session with a `custom-title` record is labelled with it, on every surface
      (popover, main window, tray menu, toasts, CLI, history), even when a newer `ai-title`
      exists — matching VS Code's precedence
- [ ] **AC2** — Without a `custom-title`, the newest `ai-title` is used, as today
- [ ] **AC3** — Without either, the label is the user's last human prompt, cleaned — never
      the text of a peer message, task notification, meta record, skill body, IDE notice or
      command wrapper
- [ ] **AC4** — The run start ("running for …") is the start of the last *human* or
      machine-started turn the session is actually in — a background hand-back that wakes the
      session does not reset it to zero mid-sprint (refine decides which of the two it is;
      either way it is stated, not accidental)
- [ ] **AC5** — A title or rename written while the app is running reaches the row without a
      restart, and a long session whose title record sits far outside the tail window still
      shows it (the existing `resolveAiTitle` scan budget applies to `custom-title` too)
- [ ] **AC6** — History uses the same precedence, so a session keeps its name when it moves
      from the live list into history
- [ ] **AC7** — Transcripts without origin fields (older Claude Code) keep today's labels —
      the classifier only excludes records it can positively identify as non-human

## Open Questions

<!-- S06: the product questions below were answered by the user — see Decisions (Sprint) -->

- **Registry `name` with `nameSource: user`.** The binary knows `user`, `hook`, `peer`,
  `auto` and `collision` besides `derived`; only `derived` was on disk. If `/rename` also
  writes the registry with `nameSource: user`, is that a cheaper source than the
  `custom-title` record — and which wins when they disagree? Verify with a real `/rename` in
  refine.
- **What VS Code shows with neither title.** The extension's fallback below `ai-title` was not
  traced; the first human prompt and the last one are both plausible. Pick the one VS Code
  uses, so AC3 matches the tab rather than a guess.
- **Does a peer hand-back count as a turn start?** It wakes the session and starts a real
  turn, so for the *status* it is one; for the *label* it is not. AC4 needs that decided.
- **Does 017 change?** 017 puts `project · branch` on the row. With labels that can now be
  long user-chosen names, check the line-1 budget once, in whichever story is built second.

## Decisions (Sprint)

- **(User)** Registry `name` vs transcript `custom-title`: match what VS Code shows; refine verifies with a real `/rename`, the registry is a fallback source.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
