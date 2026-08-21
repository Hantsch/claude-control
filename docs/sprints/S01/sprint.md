---
sprint: S01
status: done # planned | in-progress | done
branch: sprint/S01
milestone: M1 — Popover at a glance
---

# Sprint S01 — Popover at a glance

## Goal

The popover answers "which session needs me, and what for" without a click: grouping, model,
waiting reason, current tool, waiting count and a reachable notification switch are all visible
at a glance. The registry status field correction lands first as the (cheap) bookkeeping basis
for the popover's status read.

## Stories (in build order)

- [x] 001 — Registry status field — record its absence, use it if it returns
- [x] 002 — Popover at a glance

## Notes

First sprint of Phase 2 — M1 is deliberately engine-free (renderer + shared presentation only)
so it can be built in one sitting. 002's open decision (waiting count vs. `attention`) was
resolved in the clarification round — see review.md. Live acceptance (testplan.md) completed by
the user on 2026-08-21; M1 is accepted.
