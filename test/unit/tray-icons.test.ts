/**
 * D4 of story 007: the badge rim has to separate from the tile in both OS themes — near-black
 * on a dark taskbar, near-white on a light one. `nativeTheme.shouldUseDarkColors` is the only
 * signal `paintBadge` has for that, so this pins the one behaviour that must survive a theme
 * flip: the rim colour it draws with actually changes.
 */

import { describe, expect, it, vi } from 'vitest';

const shouldUseDarkColors = { value: true };

vi.mock('electron', () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return shouldUseDarkColors.value;
    },
  },
}));

const { badgeRimColor, createBitmap, paintBadge, renderTrayTile, LIGHT_STATE_COLORS } =
  await import('../../src/main/tray-icons.ts');

describe('badgeRimColor', () => {
  it('is near-black for the dark theme and near-white for the light theme', () => {
    const dark = badgeRimColor(true);
    const light = badgeRimColor(false);
    expect(dark).not.toEqual(light);
    expect(dark.r + dark.g + dark.b).toBeLessThan(100);
    expect(light.r + light.g + light.b).toBeGreaterThan(600);
  });

  it('follows nativeTheme.shouldUseDarkColors when no override is passed', () => {
    shouldUseDarkColors.value = true;
    expect(badgeRimColor()).toEqual(badgeRimColor(true));
    shouldUseDarkColors.value = false;
    expect(badgeRimColor()).toEqual(badgeRimColor(false));
  });
});

describe('paintBadge', () => {
  it('paints a rim pixel that differs between the dark and light theme', () => {
    const size = 32;

    shouldUseDarkColors.value = true;
    const darkBitmap = createBitmap(size, size);
    paintBadge(darkBitmap, '1');

    shouldUseDarkColors.value = false;
    const lightBitmap = createBitmap(size, size);
    paintBadge(lightBitmap, '1');

    // A point just outside the badge fill but inside its rim ring, mirroring the geometry
    // `paintBadge` itself uses (BADGE_RADIUS/BADGE_RIM of the tile, bottom-right corner).
    const radius = size * 0.24;
    const rim = Math.max(1, size * 0.045);
    const cx = size - radius - rim;
    const cy = size - radius - rim;
    const x = Math.round(cx + radius + rim / 2);
    const y = Math.round(cy);
    const i = (y * size + x) * 4;
    const darkR = darkBitmap.data[i] ?? 0;
    const darkG = darkBitmap.data[i + 1] ?? 0;
    const darkB = darkBitmap.data[i + 2] ?? 0;
    const lightR = lightBitmap.data[i] ?? 0;
    const lightG = lightBitmap.data[i + 1] ?? 0;
    const lightB = lightBitmap.data[i + 2] ?? 0;

    expect([darkR, darkG, darkB]).not.toEqual([lightR, lightG, lightB]);
    // Dark rim pixel is near-black, light rim pixel is near-white.
    expect(darkR + darkG + darkB).toBeLessThan(150);
    expect(lightR + lightG + lightB).toBeGreaterThan(500);
  });
});

describe('renderTrayTile', () => {
  it('uses LIGHT_STATE_COLORS for the light theme (§014 D4)', () => {
    const size = 32;
    const cx = size / 2;
    const cy = size / 2;
    const i = (Math.round(cy) * size + Math.round(cx)) * 4;

    const lightBitmap = renderTrayTile('done', size, false);
    // Bitmap data is premultiplied BGRA (see `blend` above), not RGBA.
    const b = lightBitmap.data[i] ?? 0;
    const g = lightBitmap.data[i + 1] ?? 0;
    const r = lightBitmap.data[i + 2] ?? 0;

    expect([r, g, b]).toEqual([
      LIGHT_STATE_COLORS.done.r,
      LIGHT_STATE_COLORS.done.g,
      LIGHT_STATE_COLORS.done.b,
    ]);
  });
});
