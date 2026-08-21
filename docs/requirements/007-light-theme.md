---
id: 007
title: Light theme
status: ready # draft -> ready -> in-progress -> done
created: 2026-08-13
---

## Requirement

[styles.css](../../src/renderer/styles.css) defines a single `:root` with no
`prefers-color-scheme` branch. On a light Windows desktop, a dark popover hanging off the tray is
the one element on screen that does not belong.

The custom properties already are the whole theme surface, so the work is not the switch — it is
checking that the status colours and the four context bands, all chosen against a dark surface,
still carry their meaning on a light one. A theme that renders but whose "waiting" and "working"
become hard to tell apart has made the app worse, not more native.

Background: [concepts/reference-tool-comparison.md](../concepts/reference-tool-comparison.md).

## Acceptance Criteria

- [ ] Both schemes are legible and follow the OS preference
- [ ] All statuses remain distinguishable from each other in both schemes
- [ ] All four context bands remain distinguishable in both schemes
- [ ] The tray tiles ([assets/icons/tray/](../../assets/icons/tray/), built by
      [build-icons.py](../../scripts/build-icons.py)) are checked against a light taskbar,
      including the badge ([tray-icons.ts](../../src/main/tray-icons.ts))

## Open Questions

*(none — everything below was decided in the sprint round.)*

## Decisions (Sprint)

- **Mechanism: one `@media (prefers-color-scheme: light)` block over `:root`, no toggle and no
  persisted preference** — AC 1 asks for the OS preference to be followed, and a setting would be
  a second source of truth for a scheme nobody chose by hand.
- **Dark stays the baseline in `:root`; light is override-only** — so the shipping scheme keeps an
  empty diff and the review question reduces to "did any dark value change?".
- **The four rules whose effect assumes a dark backdrop become tokens** (`.session-row.muted` /
  `.popover-row.muted` opacity `0.7`, the `pulse` keyframe's `0.4` minimum, `.dot.halo`'s
  `color-mix(… 35%, transparent)`, `button:disabled` opacity) — otherwise "the custom properties
  are the whole theme surface" stops being true the moment the light branch needs a different
  dimming factor.
- **The two stray literals get tokenised** (`#5a2a2a` at
  [styles.css:565](../../src/renderer/styles.css#L565), `#1c1c20` at
  [styles.css:606](../../src/renderer/styles.css#L606)) — a hex that only works on near-black is
  exactly the leak this story exists to close.
- **Contrast targets are named, not eyeballed:** body text ≥ 4.5:1 against its own surface,
  `--text-dim` / `--text-faint` and all non-text colour (dots, band fills, focus ring, borders)
  ≥ 3:1 — the standard WCAG split, so "legible" has a number.
- **Pairwise distinguishability is measured in OKLab, with the *dark* scheme as the threshold** —
  the light scheme's worst status pair and worst band pair must be no closer than the dark
  scheme's worst pair is today. The dark scheme ships and is accepted, so it is the honest
  baseline; any absolute number would be invented.
- **Both of the above are enforced by a unit test that parses `styles.css`** (D3), not by looking
  at screenshots — ACs 2 and 3 are the two criteria that silently rot, and a colour regression
  should fail `npm test`, not a future glance.
- **The main process learns the theme** (`nativeTheme.shouldUseDarkColors` +
  `nativeTheme.on('updated')`) — `backgroundColor: '#111113'` / `'#17171a'`
  ([windows.ts:83,190](../../src/main/windows.ts#L83)) is painted before the renderer does
  anything, so on a light desktop every popover open would flash dark first.
- **Switching the Windows scheme under a running app must take effect without a restart** — the
  renderer gets that for free from the media query; the tray badge and the window background need
  the `nativeTheme` listener, which is why they are in scope at all.
- **No new tray art in this story.** The tiles come from a generated art tree
  ([build-icons.py:44-50](../../scripts/build-icons.py#L44-L50)) with no colour parameter, so a
  light variant is a new art set — out of scope. Only the badge's near-black rim
  (`BADGE_RIM_COLOR = #121214`, [tray-icons.ts:37](../../src/main/tray-icons.ts#L37)) becomes
  theme-aware, since it is code and is the one part predicted to fail on a light taskbar.
- **AC 4's "checked" is discharged by a rendered artifact plus a finding**, not by a promise: D4
  composites each state tile with and without badge over a light and a dark taskbar swatch into
  `output/`, and the outcome per tile is written into `## Done`. If a *tile* (not the badge) fails,
  that becomes a follow-up story — widening 007 into art regeneration would bury the colour diff
  this sprint deliberately kept separate.
- **Starting values are the Windows 11 light palette** (surface `#f7f7f9`, raised `#ffffff`,
  accent `#4f5bd5`, `--band-yellow` `#b58900`) — a native-looking anchor beats a hand-mixed one,
  and D3's test decides whether they survive.
- **007 touches no popover markup.** It lands after 010 and 011, so D1 first greps the renderer
  for colour literals and tokens those stories introduced and folds them into both branches — the
  contrast pass runs on the layout that ships.

## Plan

Light scheme as a variable override, with the contrast claim made testable, then the one
main-process and one tray leak that CSS cannot reach.

1. **Sweep first (D1).** After 010/011 have landed, grep `src/renderer` for hex/`rgb(`/`rgba(`
   outside `:root` and for tokens the new popover added. Anything found is either tokenised or
   listed in `## Done` as deliberate.
2. **Neutral surfaces (D1).** Add `@media (prefers-color-scheme: light) { :root { … } }` directly
   below `:root` in [styles.css](../../src/renderer/styles.css): `--bg`/`--bg-raised`/`--bg-hover`/
   `--bg-active`/`--border`/`--text`/`--text-dim`/`--text-faint`/`--accent` +
   `color-scheme: light`. The same block absorbs the new effect tokens (`--muted-opacity`,
   `--pulse-min`, `--halo-strength`) and the two tokenised literals.
3. **Chrome before content (D2).** Thread the theme into [windows.ts](../../src/main/windows.ts) —
   initial `backgroundColor` from `nativeTheme.shouldUseDarkColors`, `setBackgroundColor` on
   `nativeTheme.on('updated')` for both live windows. The two colour constants live in one place so
   CSS and main cannot drift.
4. **Semantic colour (D3).** Retune `--status-*` (8) and `--band-*` (4) in the light branch, with
   `test/unit/theme.test.ts` parsing both branches out of `styles.css` and asserting the targets
   above. Consumers to keep in view: `.dot` fills
   ([StatusDot.tsx](../../src/renderer/components/StatusDot.tsx)), band fills in
   [ContextBar.tsx](../../src/renderer/components/ContextBar.tsx) /
   [ContextGauge.tsx](../../src/renderer/components/ContextGauge.tsx), the same hues used as *text*
   (waiting reason, `.meta.error`), the `--accent` focus ring on `--bg-hover`, and the popover
   scrollbar (`--bg-active` on `--bg`).
5. **Tray (D4).** `paintBadge` takes the rim colour from the theme;
   [icon-assets.ts](../../src/main/icon-assets.ts) puts it in the cache key,
   [tray.ts](../../src/main/tray.ts) invalidates `lastKey` on `nativeTheme.on('updated')` the way
   `rescale()` already does for DPI. Then render the check artifact and record the finding.
6. **Verify:** `npm run build`, `npm test`, `npm run typecheck`, then the manual pass below with
   the Windows scheme flipped both ways under a running app.

Order matters: D1 → D3 (the test needs the light branch to exist); D2 and D4 are independent.

## Deliverables

- [ ] D1 — **Light branch for surfaces, and the theme surface made honest.**
      [styles.css](../../src/renderer/styles.css) only: literal sweep across `src/renderer`,
      `@media (prefers-color-scheme: light)` block with the neutral tokens + `color-scheme: light`,
      the two hardcoded literals ([styles.css:565](../../src/renderer/styles.css#L565),
      [:606](../../src/renderer/styles.css#L606)) replaced by vars, and `--muted-opacity` /
      `--pulse-min` / `--halo-strength` introduced and consumed at
      [styles.css:286,364,373,859](../../src/renderer/styles.css#L286).
      *Accepted when:* the app renders light end to end (main window + popover) on a light OS,
      dark is unchanged apart from the new token declarations, and no colour literal is left
      outside the two `:root` blocks.
- [ ] D2 — **Window chrome follows the OS scheme.** [windows.ts](../../src/main/windows.ts) (plus a
      small shared constants spot if one is warranted): initial `backgroundColor` per
      `nativeTheme.shouldUseDarkColors` for the main window (:83) and the popover (:190), and
      `setBackgroundColor` on `nativeTheme.on('updated')` for whichever windows are alive, with the
      listener removed on teardown.
      *Accepted when:* opening the popover on a light desktop shows no dark flash, and flipping the
      Windows scheme under a running app updates both windows without a restart.
- [ ] D3 — **Contrast pass over the semantic colours, enforced by a test.** Light-branch values for
      `--status-waiting|done|working|stale|queued|starting|ended|unknown` and
      `--band-green|yellow|red|critical` in [styles.css](../../src/renderer/styles.css), plus a new
      `test/unit/theme.test.ts` (mirror the style of
      [test/unit/presentation.test.ts](../../test/unit/presentation.test.ts)) that parses the two
      `:root` blocks and asserts: text ratios ≥ 4.5:1, dim/faint and non-text ≥ 3:1, and worst
      pairwise OKLab distance among statuses and among bands in light ≥ the dark scheme's worst.
      *Accepted when:* `npm test` is green, the test fails if any light status or band value is
      reverted to its dark counterpart, and the four bands read as four steps on a light surface.
- [ ] D4 — **Tray badge follows the taskbar, tiles checked and the result recorded.**
      [tray-icons.ts](../../src/main/tray-icons.ts) (theme-aware rim in `paintBadge`),
      [icon-assets.ts](../../src/main/icon-assets.ts) (theme in the `trayImage` cache key),
      [tray.ts](../../src/main/tray.ts) (`nativeTheme.on('updated')` → invalidate `lastKey`,
      mirroring `rescale()` at [tray.ts:78-84](../../src/main/tray.ts#L78-L84)), a unit test that
      the rim colour flips with the flag (`tray-icons.ts` and `icon-assets.ts` have no tests today),
      and a composite artifact under `output/` showing all six states × badge/no-badge over a light
      and a dark taskbar swatch.
      *Accepted when:* the badge is legible on a light taskbar, the icon rebuilds on a live scheme
      change, and `## Done` names the verdict for each of the six tiles (follow-up story if a tile
      itself fails).

## Model Hints

- D3 → `deliverable-hard` — it defines the metric the whole story is judged by and retunes twelve
  semantic hues that are consumed simultaneously as fills, as text and as borders, where a value
  that passes the text check can still collapse two dots into one.
- D1, D2, D4 → default tier.
- Review: → default — the diff is a variable block, one `nativeTheme` wiring and a colour constant;
  the one thing the reviewer must actually check is that no dark-scheme value moved, and that is
  visible in the diff.

## Test Plan (manual acceptance)

The Windows scheme is switched under Settings → Personalization → Colors → "Choose your mode" →
*Light* / *Dark*. Run `npm run dev` (unset `ELECTRON_RUN_AS_NODE` when launching from VS Code).

1. **Light, cold start.** Set Windows to Light, then start the app. Open the popover from the tray
   and the main window from the tray menu: both are light, no dark frame or flash on open, text is
   comfortably readable, and the popover's scrollbar and focus ring are visible (arrow onto a row
   to see the ring).
2. **Statuses side by side.** With sessions in different states live (working, waiting, done,
   stale), confirm each status dot is identifiable without reading the label — including the
   pulsing *working* dot at its dimmest point and the *waiting* halo, which must still register.
3. **The four bands.** In the main window, compare context bars and gauges across sessions at
   different fill levels (or watch one session climb): green, yellow, red and critical must read as
   four distinct steps, not two plus two.
4. **Live switch.** With the app running and the popover open, flip Windows to Dark and back. Both
   windows follow without a restart, the tray icon is rebuilt, and nothing is left half-themed.
5. **Tray badge, both taskbars.** With at least one unseen waiting/done session (badge showing),
   look at the tray icon on a light taskbar and on a dark one, at 100% and at 150% scaling. The
   badge must be separable from the tile and from the taskbar in every combination. Note the
   verdict for each of the six tiles in `## Done`.
6. **Dark regression.** Back in Dark mode, walk the popover and both main-window tabs and confirm
   nothing changed from before the story.

## Done

<!-- filled by /build -->
