# Sprint S03 — Review

## Overview

**Goal.** The popover stops being a row of ellipses. Two lines per session instead of eight
columns, the waiting reason across the full width, collapsible groups and one click that opens
what the session last said plus one row per subagent with its own model and context. Afterwards
the same surface is checked in the light Windows scheme, and the four points S02 left open are
closed.

**Reached.** All four stories built, reviewed and committed. None is live-accepted: this run was
headless (see "Built, live acceptance pending" below), so every user-facing story is handed over
for manual acceptance rather than presented as done.

| Story | Status | Commit |
| --- | --- | --- |
| 010 — Popover drill-down | built, live acceptance pending | `010: popover drill-down — two-line rows, collapsible groups, subagent detail` |
| 011 — Subagent detail | built, live acceptance pending | `011: subagent final message and declared model in popover + main window` |
| 007 — Light theme | built, live acceptance pending | `007: light theme — OS-following scheme, contrast-tested, theme-aware tray badge` |
| 012 — S02 residuals | built, live acceptance pending | `012: S02 residuals — unknown probe result, stable protocol path, focus guard` |

Branch: `sprint/S03`, cut from `dev`. Verification at the end of the sprint: `npm run typecheck`,
`npm test` (293 tests, 16 files) and `npm run build` all green. Test count went 249 → 260 → 277 →
293 across the four stories.

## Implemented stories

**010 — Popover drill-down.** The eight-column grid is gone, replaced by the prototype's two-line
row: identity and numbers on line 1 (chevron, status glyph, index, branch, absolute token count,
model, mute toggle), the prose on line 2 — where a waiting session's reason finally gets the full
popover width instead of being cut off after four words. Group headers collapse with a status
rollup; session rows expand to show the session title, what it last said, and one row per
subagent with its own agent type, model, context and duration. The testable logic moved into two
new pure modules (`popoverModel.ts`, `subagentParts.ts`), the latter lifted out of
`SubagentTree.tsx` so the popover and the main window cannot describe the same run differently.
`core/` unchanged, as the story required.

**011 — Subagent detail.** Two facts the drill-down wanted and the adapter did not extract. A
finished subagent's final message is now read from the `Agent` tool result, clipped to 120
characters at the adapter boundary, and rendered in both the popover and the main window's
subagent tree; a model declared in the `Agent` call is extracted and shown while the run is still
going. The privacy line held: the subagent's `prompt` is still not read, and the test fixture's
marker was split so the test can assert both directions rather than a blanket match.

**007 — Light theme.** One `prefers-color-scheme: light` block over the existing custom
properties, plus the four dark-assuming effect rules and two stray hex literals turned into
tokens. The contrast pass is enforced by a new unit test that parses both `:root` blocks and
asserts WCAG ratios plus OKLab pairwise distinguishability — with the *dark* scheme's worst pair
as the threshold, so no number was invented. The main process now follows `nativeTheme` for the
window background (otherwise every popover open flashes dark on a light desktop) and the tray
badge rim is theme-aware. No new tray art.

**012 — S02 residuals.** All four points closed. The batched window probe emits an explicit
`|FALSE` line when it genuinely walks a chain to its end, so an unanswered pid stays uncached and
gets re-probed instead of being remembered as "no window"; where that keeps a session on screen,
the popover marks it. The portable EXE registers its stable `PORTABLE_EXECUTABLE_FILE` path
instead of the per-run temp dir. The popover's initial-focus decision moved into a pure helper
that refuses to take focus off Pin or Close. `ShortcutStatus` is declared once.

## Findings & decisions

**Direction decisions taken by the user in the clarification round.** Two went against the
story's own recommendation and are worth remembering, because both widen rather than narrow the
surface:

- *Popover height:* accept the scroll — `POPOVER_MAX_HEIGHT` stays at 560, expansion is not an
  accordion, and several sessions may be open at once. The story recommended an accordion for
  predictable height.
- *Window-unknown state:* mark it, don't stay silent. The story recommended silent (fail-safe,
  and consistent with 004's noise reduction); the user chose a visible badge for a state that can
  last a single probe pass.
- *No inherited-model derivation* (011): a subagent with no declared model shows no model at all
  rather than a `≈`-marked guess. This removed a whole source and its provenance marker, which in
  turn dropped that deliverable's risk tier.

**What the reviews caught.** Three of the four stories needed a fix cycle, and in two cases the
review caught a real bug rather than a nit:

- 010: D7's first version broke story 003's "focus the most urgent row when the popover opens" —
  `focusTopRow()` had been widened to all nav keys instead of session rows only. A regression on
  a feature from the previous sprint that had not had its live acceptance yet.
- 011: the popover suppressed the "no interim state" hint for `launched` subagents — the common
  case, at 163 of 351 sampled real results — and suppressed model and report on failed runs while
  the main window's tree did not. Two surfaces describing the same run differently is exactly what
  `subagentParts.ts` was extracted to prevent.
- 007: `POPOVER_BG.light` was set to `--bg`'s light value while the popover body actually paints
  `--bg-raised`, which would have produced the light-mode flash the deliverable existed to remove.
- 012: the probe still pre-filled every requested pid with `false` and only upgraded to `true`,
  which made the new "unknown" guard unreachable and the story's first acceptance criterion a
  genuine FAIL. Fixed with the explicit `|FALSE` negative marker.

**Adjustments made against the spec, not the plan.** `--band-yellow` deviated from the anchor
value the story suggested (`#b58900` → `#9c7600`): band fills paint against `--bg-active`, where
the suggested value only reached 2.44:1. The story's stated 3:1 target won over its own suggested
hex — the right precedence, and worth noting as the pattern for the remaining colour work.

**Carried into the next planning:**

- *Settings → Diagnostics recomputes rather than reports* (012). The protocol target is re-derived
  at IPC-handler time instead of reporting what `setAsDefaultProtocolClient` actually wrote, and
  that registration's `catch {}` swallows a failed registry write — so the panel can print a path
  that was never registered, in the very field added so a user could check it. Acceptance criterion
  6 is satisfied (the row exists, README states the limit), so this was left in scope rather than
  widened. Fix: thread `{ target, registered }` out of `registerToastProtocol()`. Also: the
  packaged non-portable case renders the `<installed exe>` placeholder instead of a path.
- *Two pre-existing contrast edges* (007), left as documented findings rather than scope creep:
  `--text-faint` on `--bg-active` (2.75:1 light vs 2.81:1 dark — same order in both schemes, so
  not a regression) and `.muted` body text at `--muted-opacity: 0.6` (~4.47:1, just under 4.5:1).
- *The M1 group-sort ranking* the sprint notes flagged as possibly a two-line fix while 010's D3
  was open: **not taken**. It turned out to be shared with the tray badge rather than local to the
  rollup, so taking it would have widened the story — which the note explicitly forbade.
- *A minor ARIA nit* in 010 (the flat-list note is not itself a `listitem` under `role="list"`),
  and an edge case that is unreachable today where a `launched` subagent carrying stray metrics
  could skip the "no interim state" line.

## Built, live acceptance pending

**All four stories.** `live-smoke-required: true` and `ui-acceptance-required: true` are set in
the project profile, and this run could not satisfy either: `npm run dev` builds and starts
cleanly, but no Electron GUI process was reachable from this session to observe, so the entire
end-to-end path ran on unit level only. Nothing here is claimed as accepted.

What specifically still needs a human at the keyboard, per
[testplan.md](testplan.md):

- 010 — the two-line row and the collapsible/expandable behaviour seen on real sessions; the
  waiting reason at full width; keyboard-only navigation including focus surviving expand and
  collapse; and the popover's self-measured height across expand/collapse cycles, which was
  code-verified but never live-measured.
- 011 — a subagent's final message and declared model actually appearing, and the popover and the
  main window agreeing on the same run.
- 007 — the light scheme on a real light desktop, including the live scheme switch without a
  restart, and the tray badge's legibility across the six tiles.
- 012 — the window-unknown badge on a row, the Diagnostics value and README paragraph in place,
  and the portable protocol path exercised from a packaged build (a toast button pressed after the
  app has exited — the case the whole of part B exists for, and the one no unit test can stand in
  for).

Cases that are not reproducible on demand and can only be checked opportunistically: a failed
subagent's error text, and the partial-probe-failure timing that raises the window-unknown badge.

## Blocked / open

No story is blocked. No question is waiting on a user decision.

One process note rather than a story finding: the profile's `branch-base` read `main`, but `main`
was seven commits behind `dev` and missing all of S02, so cutting `sprint/S03` from it as
configured would have silently dropped that work. The user chose `dev` as the base; the profile
has since been updated (`branch-base: dev`, `protected-branches: dev, main`), which is why that
file shows an uncommitted diff that belongs to no story in this sprint.

Merging `sprint/S03` into `dev` is the user's decision after live acceptance.
