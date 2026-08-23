/**
 * The tray tile's legibility claim, measured on the pixels it actually draws rather than trusted
 * from the constants it draws with. Mirrors `test/unit/theme.test.ts`'s approach: WCAG contrast
 * for "readable at all", OKLab distance for "distinguishable from its neighbours".
 *
 * This file was written for story 014, when the tiles were shipped art and the question was
 * whether the derived light set held up next to the accepted dark one. The art is gone — the
 * tiles are rendered by `renderTrayTile` now — so the parity bar it used (light no worse than
 * dark) went with it: both sets come out of the same geometry and differ only in palette, and
 * there is no longer an "already accepted" side to measure the other against. What replaced it
 * is an absolute floor per theme, sized in the comment on `MIN_SEPARATION`.
 *
 * Colour-math functions below are copy-adapted from `theme.test.ts` verbatim in shape (they
 * operate on `#rrggbb` hex strings); this file stays self-contained rather than importing from
 * another test file.
 */

import { describe, expect, it, vi } from 'vitest';
// Type-only, so it is erased before `vi.mock` matters — the module itself is imported below.
import type { Bitmap } from '../../src/main/tray-icons.ts';

const shouldUseDarkColors = { value: true };
vi.mock('electron', () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return shouldUseDarkColors.value;
    },
  },
}));

const { paintBadge, renderTrayTile, LIGHT_STATE_COLORS } = await import(
  '../../src/main/tray-icons.ts'
);

/* ------------------------------------------------------------------ colour math (pure) */

/** `#rrggbb` → the three 0..1 sRGB components. */
function channels(hex: string): [number, number, number] {
  const body = hex.trim().replace('#', '');
  expect(body, `${hex} is not a six-digit hex colour`).toMatch(/^[0-9a-fA-F]{6}$/);
  return [0, 2, 4].map((i) => Number.parseInt(body.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** sRGB transfer function, undone (WCAG 2.x / IEC 61966-2-1). */
function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `#rrggbb` → OKLab (Björn Ottosson's matrices, via linear sRGB and the LMS cube roots). */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance: plain Euclidean in OKLab, which is what that space is for. */
function distance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** The closest pair in a set — the number that decides whether a palette collapses. */
function worstPair(colours: Array<[string, string]>): { gap: number; pair: string } {
  let gap = Number.POSITIVE_INFINITY;
  let pair = '';
  for (let i = 0; i < colours.length; i += 1) {
    for (let j = i + 1; j < colours.length; j += 1) {
      const left = colours[i];
      const right = colours[j];
      if (!left || !right) continue;
      const d = distance(left[1], right[1]);
      if (d < gap) {
        gap = d;
        pair = `${left[0]} / ${right[0]}`;
      }
    }
  }
  return { gap, pair };
}

/* --------------------------------------------------------------- pixel-sampling helpers */

function toHex(r: number, g: number, b: number): string {
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** One pixel of a `Bitmap`, un-premultiplied back to straight RGBA. */
function pixel(bitmap: Bitmap, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const i = (y * bitmap.width + x) * 4;
  const a = bitmap.data[i + 3] ?? 0;
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const scale = 255 / a;
  return {
    r: (bitmap.data[i + 2] ?? 0) * scale,
    g: (bitmap.data[i + 1] ?? 0) * scale,
    b: (bitmap.data[i] ?? 0) * scale,
    a,
  };
}

/**
 * A tile's "mark" colour: the average of its solid pixels. The tile is transparent outside the
 * mark — there is no ground to separate it from any more, which is what the old art needed all
 * the saturation/hue heuristics for — so "solid" is the whole definition. The threshold sits
 * above the antialiased edge and above the `waiting` halo, which is a deliberate 50 % wash and
 * would otherwise pull that state's average toward the taskbar.
 */
function markColor(bitmap: Bitmap): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const p = pixel(bitmap, x, y);
      if (p.a <= 200) continue;
      r += p.r;
      g += p.g;
      b += p.b;
      n += 1;
    }
  }
  expect(n, 'tile has no solid pixels at all — nothing was drawn').toBeGreaterThan(0);
  return { r: r / n, g: g / n, b: b / n };
}

/** How much of the tile the mark covers, 0..1 — the shape signal, independent of hue. */
function coverage(bitmap: Bitmap): number {
  let covered = 0;
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) covered += (bitmap.data[(y * bitmap.width + x) * 4 + 3] ?? 0) / 255;
  }
  return covered / (bitmap.width * bitmap.height);
}

function markHex(icon: TrayIcon, size: number, dark: boolean): string {
  const { r, g, b } = markColor(renderTrayTile(icon, size, dark));
  return toHex(r, g, b);
}

/* --------------------------------------------------------------------------- fixtures */

const TASKBAR_LIGHT = '#f3f3f3'; // Win11 light taskbar
const TASKBAR_DARK = '#202020'; // Win11 dark taskbar

/**
 * 16 px per 100 % display scaling, up to 300 % — plus 28, which no shipped tile ever existed at.
 * The tiles are drawn at whatever physical size the display asks for now (`trayPixelSize`), so
 * the suite has to cover a size that is not a multiple of anything.
 */
const TRAY_SIZES = [16, 20, 24, 28, 32, 40, 48];
const STATES = ['none', 'working', 'waiting', 'done', 'mixed', 'stale'] as const;
type TrayIcon = (typeof STATES)[number];

/**
 * Floor for the closest pair of marks in OKLab, per theme and per size.
 *
 * Measured, not invented. The tightest pair is `working`/`mixed` on the dark taskbar (0.091 at
 * 24 px) and `none`/`mixed` on the light one (0.099) — both cases where this metric is at its
 * least informative, because it averages a composite mark down to one colour: `mixed` is a blue
 * ring around a green core, and averaging it lands near the blue `working` disc even though the
 * two look nothing alike. What actually keeps those two apart is shape, which the next test
 * measures. So this floor is set just under the measured minimum: it is a guard against a
 * palette change collapsing two states, not the whole distinguishability argument.
 *
 * For scale, the shipped art this replaced measured 0.019 for its own worst pair at 16 px — an
 * order of magnitude closer, because there most of every tile was the same near-black plate.
 */
const MIN_SEPARATION = 0.085;

describe('tray tile legibility', () => {
  it('reads at >= 3:1 against the taskbar it is drawn for, at every size', () => {
    for (const size of TRAY_SIZES) {
      for (const state of STATES) {
        const dark = markHex(state, size, true);
        const light = markHex(state, size, false);
        expect(contrast(dark, TASKBAR_DARK), `${size}px ${state} dark mark ${dark} on ${TASKBAR_DARK}`).toBeGreaterThanOrEqual(3);
        expect(contrast(light, TASKBAR_LIGHT), `${size}px ${state} light mark ${light} on ${TASKBAR_LIGHT}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('tray tile distinguishability', () => {
  it('keeps the 6 states apart in both themes, at every size', () => {
    // Per-size rather than one representative size: every size is rasterised on its own, and a
    // regression at 16 px (the size most users see) must not be hidden by averaging.
    for (const size of TRAY_SIZES) {
      for (const dark of [true, false]) {
        const colours = STATES.map((state) => [state, markHex(state, size, dark)] as [string, string]);
        const worst = worstPair(colours);
        expect(
          worst.gap,
          `${size}px ${dark ? 'dark' : 'light'}: closest pair is ${worst.pair} at ${worst.gap.toFixed(4)}`,
        ).toBeGreaterThanOrEqual(MIN_SEPARATION);
      }
    }
  });

  it('separates the states this metric cannot, by shape', () => {
    // Colour alone is not a channel everybody has, and for a composite mark the average above is
    // not even the right question. Three pairs carry a shape difference on purpose:
    // `waiting`/`done` (amber vs green — the pair red-green colour vision drops first, and the
    // two states the badge counts), `none`/`stale` (both muted, both hollow) and `mixed`/`working`
    // (both blue-dominant). Coverage — how much of the tile is painted — is a crude proxy for
    // "different shape", but it is the one that cannot be satisfied by a colour change: a notch
    // bitten out of a disc, a smaller thinner ring, or a ring instead of a disc all move it; a hue
    // does not.
    const PAIRS: Array<[TrayIcon, TrayIcon]> = [
      ['waiting', 'done'],
      ['none', 'stale'],
      ['mixed', 'working'],
    ];
    for (const size of TRAY_SIZES) {
      for (const dark of [true, false]) {
        for (const [lighter, fuller] of PAIRS) {
          const area = (state: TrayIcon) => coverage(renderTrayTile(state, size, dark));
          expect(
            area(lighter),
            `${size}px ${dark ? 'dark' : 'light'}: ${lighter} covers as much as ${fuller}`,
          ).toBeLessThan(area(fuller) * 0.9);
        }
      }
    }
  });
});

describe('badge legibility on a light tile', () => {
  // One representative state ("waiting") — the badge geometry and colours are the same code path
  // (`paintBadge`) regardless of which tile it composites over, so this is about the badge's own
  // disc/rim/digit contrast, not about re-checking every state. Size is *not* representative,
  // though: the rim sample point sits exactly on the tile's edge (`cx + radius + rim` == `size`,
  // by construction of `cx`/`cy` below), so rounding can push it one column past the last valid
  // index — silently wrapping into the next row via the unbounded `y * size + x` index instead of
  // erroring. That happened at 16 px and 20 px when this was widened from a single size, so
  // `sample` clamps its coordinates and every size is checked instead of just one.
  it('keeps the badge disc, rim and digit each >= 3:1 against their neighbour, at every size', () => {
    shouldUseDarkColors.value = false;

    for (const size of TRAY_SIZES) {
      const bitmap = renderTrayTile('waiting', size, false);
      paintBadge(bitmap, '3', false);

      const sample = (x: number, y: number): string => {
        const sx = Math.min(size - 1, Math.max(0, Math.round(x)));
        const sy = Math.min(size - 1, Math.max(0, Math.round(y)));
        const p = pixel(bitmap, sx, sy);
        return toHex(p.r, p.g, p.b);
      };

      // Same geometry `paintBadge` itself uses (BADGE_RADIUS/BADGE_RIM/BADGE_GLYPH of the tile,
      // bottom-right corner) — mirrors `test/unit/tray-icons.test.ts`'s rim-sampling approach.
      const radius = size * 0.24;
      const rim = Math.max(1, size * 0.045);
      const cx = size - radius - rim;
      const cy = size - radius - rim;
      const scale = Math.max(1, Math.floor((2 * radius * 0.68) / 5));

      // The disc sample must dodge the digit: at BADGE_GLYPH=0.68 of the diameter, the '3'
      // glyph's bounding box covers most of the disc's vertical span and is centred on (cx, cy)
      // — the obvious sample point. A point offset horizontally at the disc's own height clears
      // the glyph's bounding box at every size while staying inside the disc radius.
      const discColour = sample(cx + radius * 0.6, cy);
      const rimColour = sample(cx + radius + rim / 2, cy);
      // Top-left cell of glyph '3' (row "111") is always lit.
      const digitColour = sample(Math.round(cx - (3 * scale) / 2), Math.round(cy - (5 * scale) / 2));

      expect(contrast(discColour, rimColour), `${size}px disc ${discColour} vs rim ${rimColour}`).toBeGreaterThanOrEqual(3);
      expect(contrast(digitColour, discColour), `${size}px digit ${digitColour} vs disc ${discColour}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('light state colours', () => {
  // The palette the light tiles are drawn from, checked as constants the way `theme.test.ts`
  // checks CSS tokens — a tile can only read on a light taskbar if the colour it is drawn in does.
  it('keeps every LIGHT_STATE_COLORS entry at >= 3:1 against the light taskbar', () => {
    for (const [state, { r, g, b }] of Object.entries(LIGHT_STATE_COLORS)) {
      const hex = toHex(r, g, b);
      expect(contrast(hex, TASKBAR_LIGHT), `LIGHT_STATE_COLORS.${state} (${hex})`).toBeGreaterThanOrEqual(3);
    }
  });
});
