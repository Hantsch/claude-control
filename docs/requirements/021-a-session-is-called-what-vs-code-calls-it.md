---
id: 021
title: A session is called what VS Code calls it
status: ready # draft -> ready -> in-progress -> done
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

<!-- S06: all four resolved — the first by the user, the rest in refine; see Decisions (Sprint). Kept for the record. -->

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

- **Rename sources, verified in the binary instead of a live `/rename`.** `claude.exe` /
  `extension.js` `2.1.312`: `/rename` (`saveCustomTitle`) appends
  `{type:"custom-title",customTitle}` to the transcript, writes the sidecar
  `projects/<slug>/<sessionId>/custom-title.json` (`{customTitle}`; deleted when the title is
  cleared) and updates the registry `name` with `nameSource: "user"` (possibly
  collision-suffixed). VS Code reads none of the registry: its session list is
  `customTitle` (tail) › sidecar › `customTitle` (head) › `aiTitle` (tail, head) ›
  `lastPrompt` (newest `last-prompt` record) › `summary` › first prompt; its loader keeps the
  newest non-empty `customTitle` and ignores `aiTitle` once one was seen. A real `/rename` was
  not run — this agent cannot reach the user, and renaming a live session would write to it.
- Transcript `custom-title` is the primary rename source, the sidecar its cheap complement for
  a long session; the registry `name` stays where it is today — the last fallback in
  `sessionLabel` — because VS Code never shows it and it can carry a collision suffix.
- Label below the titles is Claude Code's own `last-prompt.lastPrompt` (newest record that
  carries a value), then the newest human prompt record, cleaned — the order VS Code uses;
  the first-prompt fallback is history-only (head read), as in VS Code's list.
- An empty `customTitle` / `aiTitle` is skipped, never a reset, because VS Code's loader does
  the same.
- A user record is non-human when it positively says so: `isMeta: true`, `origin.kind` of
  `peer` or `task-notification`, `promptSource: "system"` or `turnOrigin` of `peer` /
  `task_notification` — because those fields are explicit, while a record with none of them
  (older Claude Code) keeps counting as a prompt (AC7).
- `isMeta: true` counts as a positive marker even on old transcripts, because it is an explicit
  field and the caveat/system-reminder text it marks was never a label anyone wanted.
- A slash command started by a plugin (`origin.kind: "plugin"`, not meta — e.g. the
  `scrum-cockpit` mod typing `/sprint S06`) is a human prompt, because Claude Code's own
  `lastPrompt` for it is `/sprint S06` and the user asked for that run.
- AC4 is stated as: the run start is the newest *human* prompt (incl. plugin-started
  commands); peer hand-backs, task notifications and meta records never move it, because every
  hand-back arrives while Claude Code is `busy` through `delegatedActive` — it continues the run
  the user started rather than beginning one.
- Peer hand-back for *status*: unchanged — `semanticKind` keeps calling any non-tool-result,
  non-interrupt user record a `prompt`, because it does start a turn and 020 makes the registry
  status primary anyway; only the label and the run start ignore it.
- `isPromptRecord` itself is narrowed (rather than adding a second predicate), because its only
  callers are the label and the run-start scan; `semanticKind` does not call it and must not
  start to.
- IDE notices (`<ide_opened_file>…</ide_opened_file>` and any `<ide_*>` block) are stripped
  with their content by `cleanPromptText`, because the tag-only strip left the notice text as
  the label.
- 017's line-1 budget: 021 changes no renderer width — every surface already clamps or
  ellipsises `sessionLabel` — so the budget check stays with 017, built second.
- History reads the sidecar only when neither its head nor its tail chunk carries a
  `custom-title` and the file is larger than both windows together, because the index is the
  N5 hot path and a short file has nothing unread.
- A long live session's `last-prompt` record is resolved with the same cached-scan contract as
  the titles, because a single subagent-heavy turn pushes it out of the tail window just as it
  does the run-start prompt.
- The two existing cached-scan resolvers (`resolveRunStart`, `resolveAiTitle`) are extracted
  into one helper before two more fields use it, because a third and fourth copy is a refine
  error by the project's own rule.
- Review stays default: every wrong shape we can name (recency instead of precedence, cache not
  refreshed from the tail, classifier by text) is pinned by a named test below.

## Plan

Data first, then live resolution, then history — each D leaves the suite green.

1. **D1 — classify and pick (core, no I/O).** `records.ts`: narrow `isPromptRecord` to human
   prompts (origin markers), add `isCustomTitleRecord`/`customTitleOf` and
   `isLastPromptRecord`/`lastPromptOf`. `summarize.ts`: facts gain `customTitle`;
   `lastPromptText` prefers the newest `last-prompt` value; `runStartedAt` from the newest human
   prompt; `cleanPromptText` drops `<ide_*>` blocks. One precedence function
   `sessionTitleOf(facts)` in `src/core/model/sessionTitle.ts`, used by `engine.toView`.
2. **D2 — live resolution (adapter).** Extract the tail-refreshed, null-caching backward scan
   into `src/core/adapters/claude/newestRecord.ts`; run start, `ai-title`, `custom-title`
   (+ sidecar) and `last-prompt` all go through it; `forgetSession` clears all four.
3. **D3 — history and detail.** `readHistoryEntry` and `readDetail` use the same precedence
   (`sessionTitleOf`), `custom-title` from head/tail (+ sidecar when the middle is unread),
   first-prompt fallback through the human classifier. CONCEPT.md label paragraph and a
   CHANGELOG line.

Files: `src/core/adapters/claude/{records,summarize,adapter}.ts`,
`src/core/model/{types,sessionTitle}.ts`, `src/core/engine.ts`, new
`src/core/adapters/claude/newestRecord.ts`, `test/fixtures/builders.ts`,
`test/unit/{reading,derivations,pipeline}.test.ts`, `docs/CONCEPT.md`, `CHANGELOG.md`.
No renderer, main or CLI file changes: every surface already reads `view.title` /
`entry.title` through `sessionLabel`.

## Deliverables

- **D1 — Who typed it, and which name wins (core, pure).**
  Touches `src/core/adapters/claude/records.ts`, `src/core/adapters/claude/summarize.ts`,
  `src/core/model/types.ts`, new `src/core/model/sessionTitle.ts`, `src/core/engine.ts`
  (line ~583 only), `src/core/adapters/claude/adapter.ts` (`emptyFacts` only),
  `test/fixtures/builders.ts`, tests in `test/unit/reading.test.ts` and
  `test/unit/derivations.test.ts`.
  - `isPromptRecord` additionally returns false when the record positively says it is not
    human: `isMeta === true`, `origin.kind` ∈ {`peer`, `task-notification`},
    `promptSource === 'system'`, `turnOrigin` ∈ {`peer`, `task_notification`}. A record with
    none of these fields behaves exactly as today. `origin.kind: 'plugin'` (non-meta) and
    `'human'` stay prompts. Do **not** touch `semanticKind` — a peer hand-back as the last
    record must still be kind `prompt` (status is not this story's).
  - `customTitleOf(record)` reads `customTitle` (trimmed, empty ⇒ null);
    `isCustomTitleRecord` = `type === 'custom-title'` with a non-null value. Same pair for
    `last-prompt` / `lastPrompt` (`isLastPromptRecord`, `lastPromptOf`).
  - `cleanPromptText` removes `<ide_[a-z_]+>…</ide_…>` blocks *with* their content, before the
    generic tag strip.
  - `TranscriptTailFacts` gains `customTitle: string | null` (doc: `/rename`, sticky, wins over
    `aiTitle`); `emptyFacts` sets it null. `summarizeRecords`: `customTitle` = newest
    custom-title in the window; `lastPromptText` = clipped newest `lastPromptOf` value, else the
    cleaned newest `isPromptRecord` text; `runStartedAt` = time of newest `isPromptRecord`.
  - New `sessionTitleOf(facts: Pick<TranscriptTailFacts,'customTitle'|'aiTitle'|'lastPromptText'>): string | null`
    = `customTitle ?? aiTitle ?? lastPromptText ?? null`. `engine.toView` uses it for `title`.
  - Builders: `lastPrompt(leafUuid, text?)` adds `lastPrompt` when given; new
    `customTitle(title, at?)`, `peerHandBack(uuid, at, text?)`, `taskNotification(uuid, at)`,
    `metaRecord(uuid, at, text)`, `pluginCommand(uuid, at, command, args)` and
    `ideNoticePrompt(uuid, at, file, text)` in the real shapes (see the table in
    RESEARCH.md §6: `promptSource`/`turnOrigin`/`isMeta`/`origin.kind`).
  - Acceptance: the tests listed for AC2, AC3, AC4 (unit), AC7.
- **D2 — Live sessions find every name, however far back (adapter).**
  Touches `src/core/adapters/claude/adapter.ts`, new
  `src/core/adapters/claude/newestRecord.ts`, tests in `test/unit/pipeline.test.ts`.
  - Extract the shape `resolveRunStart` and `resolveAiTitle` share into one helper (e.g.
    `class NewestRecordCache<T>` with `resolve(sessionId, path, fromTail)`): tail value wins and
    refreshes the cache; else cached value (including cached `null`); else one
    `scanRecordsFromEnd` with the field's predicate and the existing 4 MB / 256 KB budget, plus
    an optional complement when the scan stops short of the file start (the `ai-title` head read
    today). Keep both existing behaviours and their tests (`pipeline.test.ts` "finds the
    generated title even when it sits outside the tail window", "still finds the run start when
    the prompt is far outside the tail window") green unchanged.
  - Four instances: run start (`isPromptRecord`, now human-only), `ai-title` (head complement as
    today), `custom-title` (complement = the sidecar
    `join(dirname(transcript), sessionId, 'custom-title.json')`, `{customTitle}` JSON, read
    before the scan since it is one tiny file; missing/invalid ⇒ ignored), `last-prompt`
    (`isLastPromptRecord`, no complement). `readStatus` fills `facts.customTitle` and
    `facts.lastPromptText` from them (resolved `last-prompt` value wins over the tail's
    record-text fallback). `forgetSession` deletes all four.
  - Acceptance: the tests listed for AC1, AC4 (scan), AC5.
- **D3 — History and detail keep the name (adapter + docs).**
  Touches `src/core/adapters/claude/adapter.ts` (`readHistoryEntry`, `headTitle`,
  `readDetail`), `docs/CONCEPT.md` (label paragraph ~line 466 and the History bullet ~480),
  `CHANGELOG.md`, test in `test/unit/pipeline.test.ts`.
  - `readHistoryEntry`: build `{customTitle, aiTitle, lastPromptText}` from tail, then head
    (custom-title tail › sidecar — only if neither chunk has one and
    `fileSize > HISTORY_HEAD_BYTES + HISTORY_TAIL_BYTES` — › head; ai-title tail › head;
    `lastPromptText` from the tail facts), pick with `sessionTitleOf`, and only then fall back
    to the first *human* prompt in the head (`isPromptRecord` + `cleanPromptText`).
  - `readDetail`: newest custom-title wins over newest ai-title for `title`.
  - CONCEPT: the label is `custom-title › ai-title › last prompt › registry name`, matching VS
    Code. CHANGELOG `# Fixes`: one short line — renamed sessions keep their name, and a session
    is no longer named after a robot's message.
  - Acceptance: the test listed for AC6.

## Model Hints

- D2 → deliverable-hard — extracting the shared cached-scan helper rewires the run start and the
  `ai-title` lookup that every live row already depends on; a subtly different cache rule
  (e.g. not refreshing from the tail, or not caching `null`) silently freezes a renamed title or
  re-scans 4 MB per tick, and only the two existing pipeline tests guard the old contract.
- Review: → default — the plausible wrong shapes (recency instead of precedence, a cache that
  never refreshes, a classifier keyed on message text) each have a named test below.

## Acceptance Tests

`e2e: none` — no UI harness exists. The labels are *displayed*, not acted on; every surface
(popover, main window, detail pane, tray, toasts, CLI, history) renders `sessionLabel(view)` /
`entry.title`, so the criteria are proven one level down at the engine snapshot and the history
entry. Gap named for the sprint review: no test drives a real surface.

- AC1 → unit `test/unit/pipeline.test.ts` › "a renamed session is labelled with its custom title even when a newer ai-title exists"
- AC2 → unit `test/unit/derivations.test.ts` › "a custom title beats an ai title, which beats the last prompt"
  (+ existing `pipeline.test.ts` › "finds the generated title even when it sits outside the tail window")
- AC3 → unit `test/unit/reading.test.ts` › "peer hand-backs, task notifications and meta records never name a session"
  · unit `test/unit/derivations.test.ts` › "drops an IDE notice that rides in front of a prompt"
  · unit `test/unit/reading.test.ts` › "Claude Code's own last-prompt record names a session before any user record"
- AC4 → unit `test/unit/reading.test.ts` › "a background hand-back does not restart the run, a plugin-started command does"
  · unit `test/unit/pipeline.test.ts` › "the run start skips hand-backs far outside the tail window"
- AC5 → unit `test/unit/pipeline.test.ts` › "a rename written while the app is watching reaches the next read"
  · unit `test/unit/pipeline.test.ts` › "finds the custom title far outside the tail window, and from the sidecar beyond the scan budget"
- AC6 → unit `test/unit/pipeline.test.ts` › "history labels a session with the name the live list gave it"
- AC7 → unit `test/unit/reading.test.ts` › "user records without origin fields still count as prompts"
  (+ every existing reading/pipeline/machine test green unchanged)

Coverage: AC1 D1+D2 · AC2 D1 · AC3 D1 · AC4 D1+D2 · AC5 D2 · AC6 D3 · AC7 D1.

## Done
