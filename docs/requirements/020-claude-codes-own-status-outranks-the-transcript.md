---
id: 020
title: Claude Code's own status outranks the transcript
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The app works out every session's status by reading the tail of its transcript, because when
it was designed Claude Code published nothing better ([RESEARCH.md §1](../RESEARCH.md)).
That is no longer true. Since at least `2.1.312` every registry file carries `status`
(`busy` / `idle` / `waiting`), `waitingFor`, `updatedAt` and `statusUpdatedAt`, computed
inside Claude Code from the same state its own UI renders — and `busy` explicitly includes
background agents that are still running ([RESEARCH.md §6](../RESEARCH.md)).

The app reads the field and throws most of it away: `deriveStatus` acts on a reported
`waiting` only, and carries everything else "never acted on"
([machine.ts:89](../../src/core/state/machine.ts)). So on 2026-10-30, with two sprints
running, Claude Code said `busy` for both while the app said `done` for both — and then hid
them, because the app had just been restarted (see [018](018-a-hidden-session-says-it-is-hidden.md)).
Three of twelve live sessions were on screen. That is the "running stories are sometimes not
recognised" the user reported.

This is the same truth the user's `scrum-cockpit` mod works from — it sits inside Claude
Code and gets `agent.spawn` and turn events directly. The registry status is the closest the
app can get to that from outside, and it is the agent's own word, not an inference.

[CONCEPT.md](../CONCEPT.md) already decided what should happen when this day came: "If
Claude Code later exposes an authoritative upstream status field, it would supersede the
§6.2 derivation for the states it covers." This story does that.

What the user should get: a session that Claude Code considers busy is never shown as
finished, and a session Claude Code considers idle is never shown as working — on every
surface, the moment the registry file changes, not on the next poll.

## Acceptance Criteria

- [ ] **AC1** — A live session whose registry says `busy` is never shown as `done`,
      `interrupted` or `starting`, whatever its transcript's last record is — including a
      session whose last record is `end_turn` after an async `Agent` launch
- [ ] **AC2** — A live session whose registry says `idle` is never shown as `working` or
      `queued` — e.g. a turn that died mid-tool and left a tool result as the last record
- [ ] **AC3** — A registry `waiting` keeps today's behaviour, and its `waitingFor` text is
      what the row, the toast and the detail pane say the session is waiting for
- [ ] **AC4** — Transcript-only distinctions survive where the registry has no word for them:
      `idle` still resolves to `done` vs `interrupted` vs `starting` from the transcript, and
      `busy` still shows the current tool and the `working` / `stale` split
- [ ] **AC5** — Every status says where it came from: the reason line (detail pane, CLI `-v`)
      distinguishes "Claude Code reports busy" from an inference
- [ ] **AC6** — A registry file without a `status` field (older Claude Code, another
      entrypoint) behaves exactly as today — every existing machine test stays green unchanged
- [ ] **AC7** — A change to the registry file alone (status flips, transcript untouched)
      reaches the live surfaces within the watcher debounce, not on the next 5 s tick
- [ ] **AC8** — No `done` toast fires while the registry says `busy`; the `done` toast for a
      delegating session fires once, when the registry goes `idle`

## Open Questions

- **How much does `busy` override?** The cheapest version only lifts `done` / `interrupted`
  to `working`. The full one makes the registry the primary input and uses the transcript only
  for the sub-state (tool, overdue, done-vs-interrupted). The second is what CONCEPT §6.2's
  note implies; the first is what fixes the reported bug. Both satisfy AC1–AC8 if AC4 is kept.
- **Stale registry status.** `statusUpdatedAt` is stamped on change only, so an old `busy` is
  normal for a long sprint (observed: busy for 2 h 40 min, correctly). Is there any age after
  which `busy` is distrusted, or does liveness + `procStart` already cover the only failure
  (a dead process)? Recommendation: no age cut-off — the PID check is the guard.
- **`stale` under `busy`.** A session that is `busy` only because of `delegatedActive`, whose
  subagent files have not been written for 30 min — `working` because Claude Code says so, or
  `stale` because nothing moves? This is where 016's subagent-mtime evidence comes back in.
- **CONCEPT update.** §6.2 and the "Reported status field" row in the open-risks table both
  describe the field as absent; they need rewording as part of this story, not after it.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
