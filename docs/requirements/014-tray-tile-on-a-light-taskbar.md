---
id: 014
title: Tray tile on a light taskbar
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

The tray tile is the app's only permanently visible surface — everything else is opened on
demand. Story [007](done/007-light-theme.md) made the app itself light-theme-correct and stopped
at the tray: only the badge *rim* became theme-aware (`badgeRimColor()` in
[tray-icons.ts](../../src/main/tray-icons.ts)), because the tile itself is generated art, not a
token. That leaves the one element a light-desktop user cannot avoid looking at as the one
element still drawn for a dark taskbar. 007's own note calls it a follow-up rather than a fix.

The art set is generated: `scripts/build-icons.py` maps image-gen masters onto the app's six tray
icon states and writes one tile per state per physical tray size
([icon-assets.ts](../../src/main/icon-assets.ts)). So this is not a hand-retouching job — either
the pipeline gains a second output set, or the existing one gains a treatment. The runtime is
already prepared for whichever it is: `trayImage()`'s cache key carries the theme, and
[tray.ts](../../src/main/tray.ts) already invalidates on `nativeTheme.on('updated')` for the
rim's sake.

What the user should get: on a light taskbar, the tile is as readable as it is on a dark one, the
six states stay as distinguishable from each other, and flipping the Windows theme while the app
runs changes the tile without a restart.

## Acceptance Criteria

- [ ] On a light Windows taskbar, each of the six tray icon states is legible against the
      taskbar and distinguishable from the other five
- [ ] On a dark taskbar nothing changes — the tile that ships today is what a dark-taskbar user
      keeps seeing
- [ ] Flipping the Windows theme while the app runs swaps the tile without a restart
- [ ] The state → colour relationship stays the one the rest of the app uses (§6.3) — no state
      gets a different colour on a light taskbar than it has in the popover
- [ ] The badge and its count stay legible on top of the light tile, at every shipped tray size
- [ ] `npm run icons` reproduces both sets from checked-in inputs — no PNG is hand-edited into
      `assets/icons/`, and the derived `stale` tile keeps being derived
- [ ] The code-drawn fallback tile (`renderFallbackTile`, used when the art is missing) is
      readable on a light taskbar too, or is explicitly documented as dark-only

## Open Questions

- **A second art set, or a treatment of the existing one?** A full light-taskbar master set is
  the better-looking answer and the more expensive one (it needs image-gen art the user has to
  approve); a programmatic treatment of the shipped tiles (outline, darkened rim, inverted
  ground) is cheap, reproducible and probably good enough. Which is wanted — and if art, is
  generating it part of this story or a hand-off?
- **Which signal decides "light taskbar"?** Windows has two independent theme settings: app mode
  and Windows (taskbar) mode. `nativeTheme.shouldUseDarkColors` reflects the *app* mode, so a
  user with light apps and a dark taskbar would get the light tile on a dark bar — exactly
  backwards. Do we accept that (it is what the badge rim already does), or read the taskbar's
  own setting (`SystemUsesLightTheme` in the registry) and accept a Windows-specific read?
- **Is the toast logo and window icon in scope?** `assets/icons/app-<status>.png` and `app.png`
  are drawn from the same masters and appear on light surfaces too. Tray only, or the whole set?
- **How is this accepted?** Contrast on a generated PNG cannot be asserted the way
  `test/unit/theme.test.ts` asserts CSS tokens against WCAG — or can it (sample the tile's
  pixels against the two known taskbar greys)? A test that measures beats a screenshot someone
  once looked at.
