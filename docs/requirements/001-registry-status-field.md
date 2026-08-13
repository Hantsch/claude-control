---
id: 001
title: Registry status field — record its absence, use it if it returns
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

Status is currently inferred from the transcript. That inference is documented as a heuristic
(CONCEPT.md §6.3) and it is the only thing that works today — but the research record does not
say *why* it is the only thing that works, and it does not say what would replace it.

Two things follow from that, and both are cheap.

**The record is incomplete.** ClaudeSessionTray's entire status model rests on
`~/.claude/sessions/<pid>.json` carrying `status` (`busy` / `waiting` / `idle`), plus
`waitingFor` and `updatedAt` (`ClaudeSessionTray.Core/ClaudeSessionsWatcher.cs:142`). Measured
on this machine on 2026-08-13 against Claude Code `2.1.228`/`2.1.229`: **none of those three
fields is present in any of the 10 live session files**, and a grep for them over the whole
directory returns zero matches. That tool therefore falls into its own `_ => Working` default
and reports every session as working, with `LastActivity` degraded to the file mtime. This is
exactly the kind of version-dependent fact RESEARCH.md exists to pin down — the sample JSON in
§1 happens not to show a `status` field, but nothing there says the absence was checked. Caveat
to record honestly: all 10 observed sessions were `entrypoint: claude-vscode`, so pure terminal
sessions were not sampled.

**The app should take the answer if it is ever offered.** If a future Claude Code version
reintroduces the field, it is the authoritative answer to a question we currently guess at —
and permission prompts are the one case transcript watching cannot see at all. While the field
is absent, nothing changes.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] RESEARCH.md §1 states which fields were looked for, that they were absent, on which
      Claude Code versions, and carries the `claude-vscode`-only entrypoint caveat
- [ ] CONCEPT.md §12 records that an authoritative upstream status field would supersede §6.2
      if it ever appears
- [ ] A session file carrying `status: "waiting", waitingFor: "permission prompt"` derives
      `waiting` from that field, with a reason saying the agent reported it, and with no
      staleness threshold applied
- [ ] Existing fixtures (no such field) produce byte-identical results to today
- [ ] The detail pane can distinguish "reported by Claude Code" from "inferred"

## Open Questions

## Plan

## Deliverables

- [ ] D1 — Negative finding written into `docs/RESEARCH.md` §1 (fields searched, versions,
      entrypoint caveat) plus the superseding-source row in `docs/CONCEPT.md` §12
- [ ] D2 — Optional `status` / `waitingFor` / `updatedAt` parsed in
      [registry.ts](../../src/core/registry/registry.ts), which currently drops unknown keys;
      new highest-priority rule ahead of the transcript rules in
      [machine.ts](../../src/core/state/machine.ts); provenance carried on `SessionView` and
      rendered in the detail pane. Fixture-tested both ways.

## Model Hints

## Test Plan (manual acceptance)

## Done
