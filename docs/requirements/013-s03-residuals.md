---
id: 013
title: S03 residuals — report what was registered, rank what is unseen
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-21
---

## Requirement

Four points that S01–S03 left open in their reviews. None of them is a new capability; each is a
place where the app currently says something that is not quite true. Bundled deliberately, the
way story [012](done/012-s02-residuals.md) bundled S02's residuals — separately they would each
be too small to schedule and would keep being carried forward.

**A — the Diagnostics field that can lie.** Settings → Diagnostics exists so a user can check
which executable Windows will start when they press a toast button. It does not report that: it
*recomputes* the target at IPC-handler time
([ipc.ts:131](../../src/main/ipc.ts#L131)) instead of reporting what
`registerToastProtocol()` ([index.ts:254](../../src/main/index.ts#L254)) actually wrote, and that
registration's `catch {}` swallows a failed registry write. So the panel can print a path that was
never registered, in the very field added so the user could verify it. On a packaged
non-portable install it prints the placeholder `<installed exe>`
([ipc.ts:132](../../src/main/ipc.ts#L132)) rather than a path at all. Found while building 012,
left in scope there because 012's own acceptance criterion was satisfied.

**B — a group can outrank the group the tray badge is about.** The badge counts *unacknowledged*
sessions in `waiting` or `done` ([aggregate.ts:43](../../src/core/state/aggregate.ts#L43)), but the
group order ranks on raw status ([popover.tsx:601](../../src/renderer/popover.tsx#L601), via
`STATUS_SORT_RANK`) with no special case for a session you have already seen. So a group whose
waiting session you have already looked at can sit above the group that is actually colouring the
badge — the one you opened the popover for. Open since S01; not taken in 010 because it turned out
to be shared with the tray badge rather than local to the group rollup.

**C — two contrast edges below target.** Found and deliberately not fixed in 007, to keep the
colour diff honest: `--text-faint` on `--bg-active` (2.75:1 light, 2.81:1 dark) and `.muted` body
text at `--muted-opacity: 0.6` (~4.47:1, just under 4.5:1). Both are effect tokens
([styles.css](../../src/renderer/styles.css)), both fail the target the rest of the palette is
held to by `test/unit/theme.test.ts`.

**D — one ARIA slip.** In 010's subagent list the "flat hierarchy" note sits inside a
`role="list"` without being a `listitem`, so a screen reader announces a list item count that does
not match what it then reads out.

Background: [S03 review](../sprints/done/S03/review.md) ("Carried into the next planning"),
[S01 review](../sprints/done/S01/review.md) for B.

## Acceptance Criteria

- [ ] Settings → Diagnostics shows the protocol target that was actually registered at startup,
      not one recomputed on request — if the two could differ, the panel shows the registered one
- [ ] A registration that fails is visible as a failure instead of being silently reported as a
      path
- [ ] On a packaged non-portable install the field shows a real path or an explicit, truthful
      wording — not the `<installed exe>` placeholder
- [ ] With one already-seen waiting session and one unseen one in different projects, the group
      the tray badge is counting is the one at the top of the popover
- [ ] Ranking still ends up identical to today when nothing has been seen yet, and is covered by a
      test that fails on the old behaviour
- [ ] `--text-faint` on `--bg-active` and `.muted` body text both meet the contrast target the
      theme test enforces for the rest of the palette, in both schemes
- [ ] The subagent list announces the same number of items to a screen reader as it renders

## Open Questions

- **Does a failed protocol registration need to be visible outside Diagnostics** — a warning row
  in Settings, or is the Diagnostics field enough? (Toast buttons are the only thing affected, and
  the app is otherwise fully usable.)
- **Where does the seen/unseen ranking belong?** Only in the popover's *group* order (narrow, the
  observed symptom), or in `compareSessions` itself — which every surface sorts by, including the
  main window's session list, and which would therefore also reorder rows inside a group?
- **Is "seen" the same thing the badge means?** The badge counts unacknowledged `waiting`/`done`.
  Should the ranking use exactly that acknowledgement flag, or the popover's own "seen" notion if
  those differ?
- **Contrast fix scope:** raise `--text-faint` / `--muted-opacity` in *both* schemes — which
  changes the dark theme that was already accepted twice — or only in the light branch, leaving
  dark's 2.81:1 as is?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
