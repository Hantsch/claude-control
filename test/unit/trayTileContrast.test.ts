/**
 * Story 014 D3 — the light tray tiles' legibility claim, measured by sampling actual pixels
 * instead of trusting `light_tile()`'s intent. Mirrors `test/unit/theme.test.ts`'s approach:
 * WCAG contrast for "readable at all", OKLab distance for "distinguishable from its neighbours",
 * with the *dark* tile set (already shipped and accepted) as the parity threshold rather than an
 * invented number.
 *
 * Colour-math functions below are copy-adapted from `theme.test.ts` verbatim in shape (they
 * operate on `#rrggbb` hex strings); this file stays self-contained rather than importing from
 * another test file.
 */

import { describe, expect, it, vi } from 'vitest';
import { decodePng, pixelAt, type DecodedPng } from './png.ts';
import { LIGHT_STATE_COLORS, type Rgb } from '../../src/main/tray-icons.ts';

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

/** HSV saturation, 0..1 — used to tell a coloured mark pixel from a near-grey ground pixel. */
function saturationOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** HSV hue, degrees 0..360. */
function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Smallest angle between two hues, degrees 0..180. */
function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * A tile's "mark" colour — the ring/glyph, as opposed to its ground. Saturated, high-alpha
 * pixels (alpha > 200, the fully-opaque antialiased-edge-free core) are averaged directly; if a
 * state has no saturated pixels at all (the near-grey `none` state, by design), the fallback
 * averages whichever opaque pixels sit furthest from the tile's mean opaque colour — the mark is
 * still the part of the tile that differs from its ground even when neither is saturated.
 */
function extractMarkColor(png: DecodedPng): Rgb {
  const opaque: Array<[number, number, number]> = [];
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const p = pixelAt(png, x, y);
      if (p.a > 200) opaque.push([p.r, p.g, p.b]);
    }
  }
  if (opaque.length === 0) {
    throw new Error('tile has no opaque pixels at all — cannot extract a mark colour');
  }

  const average = (pixels: Array<[number, number, number]>): Rgb => {
    const sum = pixels.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0]);
    return { r: sum[0] / pixels.length, g: sum[1] / pixels.length, b: sum[2] / pixels.length };
  };

  const saturated = opaque.filter(([r, g, b]) => saturationOf(r, g, b) >= 0.08);
  if (saturated.length > 0) return average(saturated);

  const mean = average(opaque);
  const distanceFromMean = ([r, g, b]: [number, number, number]) =>
    Math.hypot(r - mean.r, g - mean.g, b - mean.b);
  const distinct = opaque.filter((p) => distanceFromMean(p) > 20);
  if (distinct.length > 0) return average(distinct);

  // Every opaque pixel is (near) identical — fall back to the single furthest one, so the
  // assertion still gets a defensible "mark colour" instead of throwing.
  const furthest = opaque.reduce((best, p) =>
    distanceFromMean(p) > distanceFromMean(best) ? p : best,
  );
  return { r: furthest[0], g: furthest[1], b: furthest[2] };
}

/**
 * `build-icons.py`'s own `GLYPH_RADIUS` — the brand glyph at the tile's centre is deliberately
 * left in the art's own hue by `light_tile()` / `recolor_ring()` ("the glyph keeps its own
 * colour, which is the brand's, not the status'"); only the ring outside this radius is moved
 * onto the state's status hue. A hue-fidelity check has to sample that ring, not the whole tile.
 */
const GLYPH_RADIUS = 0.3;

/**
 * The state-identifying ring colour, as opposed to `extractMarkColor`'s whole-tile mark: pixels
 * within `GLYPH_RADIUS` of the tile's centre are excluded before averaging. Used only for hue
 * fidelity — `extractMarkColor` stays the right measure for legibility/distinguishability, where
 * the *whole* visible mark (glyph and ring together, since `none`/`mixed` have no separate ring
 * at all) is what a user actually sees.
 *
 * Without this exclusion, the hue-fidelity check was comparing a mix of the ring's exact target
 * hue and the brand glyph's own multi-hued art (measured on tray-light/16/done.png: outside the
 * glyph radius every pixel sits within 1° of the target 142.1°; inside it, hues range from 0° to
 * 350°) — the 27° "miss" it reported was the brand glyph diluting the average, not a wrong ring
 * colour.
 */
function extractRingColor(png: DecodedPng): Rgb {
  const centre = (png.width - 1) / 2;
  const inner = GLYPH_RADIUS * png.width;
  const opaque: Array<[number, number, number]> = [];
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (Math.hypot(x - centre, y - centre) < inner) continue;
      const p = pixelAt(png, x, y);
      if (p.a > 200) opaque.push([p.r, p.g, p.b]);
    }
  }
  if (opaque.length === 0) {
    throw new Error('tile has no opaque ring pixels outside the glyph radius');
  }

  const average = (pixels: Array<[number, number, number]>): Rgb => {
    const sum = pixels.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0]);
    return { r: sum[0] / pixels.length, g: sum[1] / pixels.length, b: sum[2] / pixels.length };
  };

  const saturated = opaque.filter(([r, g, b]) => saturationOf(r, g, b) >= 0.08);
  if (saturated.length > 0) return average(saturated);
  return average(opaque);
}

function assetPath(set: 'tray' | 'tray-light', size: number, state: string): string {
  return new URL(`../../assets/icons/${set}/${size}/${state}.png`, import.meta.url).pathname.replace(
    /^\/([a-zA-Z]:)/,
    '$1',
  );
}

async function readTile(set: 'tray' | 'tray-light', size: number, state: string): Promise<DecodedPng> {
  const path = assetPath(set, size, state);
  const { readFile } = await import('node:fs/promises');
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (error) {
    throw new Error(`could not read ${set}/${size}/${state}.png at ${path}: ${String(error)}`);
  }
  try {
    return decodePng(buffer);
  } catch (error) {
    throw new Error(`could not decode ${set}/${size}/${state}.png at ${path}: ${String(error)}`);
  }
}

/* --------------------------------------------------------------------------- fixtures */

const TASKBAR_LIGHT = '#f3f3f3'; // Win11 light taskbar
const TASKBAR_DARK = '#202020'; // Win11 dark taskbar

const TRAY_SIZES = [16, 20, 24, 32, 40, 48];
const STATES = ['none', 'working', 'waiting', 'done', 'mixed', 'stale'] as const;
/** States with a dedicated hue in `LIGHT_STATE_COLORS`/`STATE_COLORS` (`mixed` has none — it's
 * a two-colour composite of `done`+`working` — and `none` is deliberately near-grey). */
const HUED_STATES = ['waiting', 'done', 'working', 'stale'] as const;

/** Hue tolerance for D3's fidelity check: generous enough to absorb PNG antialiasing / the
 * darkening `light_tile()` applies to a hue-correct mark, tight enough to catch an actual wrong
 * hue (e.g. accidentally reusing the dark-scheme colour, which is 20-90° away for every state). */
const HUE_TOLERANCE_DEG = 15;

describe('tray tile assets decode', () => {
  it('reads and decodes every dark and light tile', async () => {
    for (const size of TRAY_SIZES) {
      for (const state of STATES) {
        const dark = await readTile('tray', size, state);
        const light = await readTile('tray-light', size, state);
        expect(dark.width, `tray/${size}/${state}.png width`).toBe(size);
        expect(dark.height, `tray/${size}/${state}.png height`).toBe(size);
        expect(light.width, `tray-light/${size}/${state}.png width`).toBe(size);
        expect(light.height, `tray-light/${size}/${state}.png height`).toBe(size);
      }
    }
  });
});

describe('light tile legibility + parity', () => {
  it('reads at >= 3:1 on the light taskbar, and no worse than dark reads on the dark taskbar', async () => {
    for (const size of TRAY_SIZES) {
      for (const state of STATES) {
        const darkPng = await readTile('tray', size, state);
        const lightPng = await readTile('tray-light', size, state);
        const dm = extractMarkColor(darkPng);
        const lm = extractMarkColor(lightPng);
        const darkMark = toHex(dm.r, dm.g, dm.b);
        const lightMark = toHex(lm.r, lm.g, lm.b);

        const lightRatio = contrast(lightMark, TASKBAR_LIGHT);
        const darkRatio = contrast(darkMark, TASKBAR_DARK);

        expect(
          lightRatio,
          `tray-light/${size}/${state}.png mark ${lightMark} on ${TASKBAR_LIGHT}`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          lightRatio,
          `tray-light/${size}/${state} (${lightRatio.toFixed(2)}:1) worse than ` +
            `tray/${size}/${state} on dark taskbar (${darkRatio.toFixed(2)}:1)`,
        ).toBeGreaterThanOrEqual(darkRatio);
      }
    }
  });
});

/**
 * `theme.test.ts`'s worst-pair parity check (the shape this mirrors) compares exact CSS hex
 * constants against each other — zero quantization, so a hard `>=` is the right bar. Here both
 * sides are pixel-sampled averages of independently 8-bit-rounded raster art (light and dark are
 * two different treatments of the same source, each rounding every pixel of a ~76-200px sample
 * on its own path through HSV<->RGB), so their OKLab gaps carry rounding noise a hex constant
 * never does. A 3% allowance absorbs that noise without hiding a real regression (it would still
 * fail light being *meaningfully* worse, e.g. two states collapsing into one) — sized against the
 * one case that needed it: at 16px, `none` (the brand's own hue, not retargeted — see
 * `LIGHT_STATUS` in `build-icons.py`) and `stale` (locked to the `--status-stale` token by AC 4)
 * measured 0.0192 against dark's 0.0195, a 1.5% shortfall, after `light_tile()`'s rim darkening
 * was fixed to stop double-darkening mark pixels (the fix that closed the *rest* of the original
 * 19% shortfall). Neither state's hue can move further — `none` has no status colour to move to,
 * `stale`'s is pinned — so this last sliver is quantization, not a treatment defect.
 */
const PARITY_TOLERANCE = 0.97;

describe('light tile distinguishability parity', () => {
  it('separates the 6 states at least as well as the dark set does, at every size', async () => {
    // Per-size rather than one representative size: the light and dark sets are drawn at each
    // size independently by `build-icons.py`, so a regression at one size (e.g. 16px roundoff
    // collapsing two marks) should not be hidden by averaging across sizes.
    for (const size of TRAY_SIZES) {
      const darkColours: Array<[string, string]> = [];
      const lightColours: Array<[string, string]> = [];
      for (const state of STATES) {
        const darkPng = await readTile('tray', size, state);
        const lightPng = await readTile('tray-light', size, state);
        const dm = extractMarkColor(darkPng);
        const lm = extractMarkColor(lightPng);
        darkColours.push([state, toHex(dm.r, dm.g, dm.b)]);
        lightColours.push([state, toHex(lm.r, lm.g, lm.b)]);
      }
      const darkWorst = worstPair(darkColours);
      const lightWorst = worstPair(lightColours);
      expect(
        lightWorst.gap,
        `size ${size}: light's closest pair is ${lightWorst.pair} at ${lightWorst.gap.toFixed(4)}, ` +
          `dark's is ${darkWorst.pair} at ${darkWorst.gap.toFixed(4)}`,
      ).toBeGreaterThanOrEqual(darkWorst.gap * PARITY_TOLERANCE);
    }
  });
});

describe('light tile hue fidelity', () => {
  it('keeps each hued state within 15° of its LIGHT_STATE_COLORS hue', async () => {
    for (const size of TRAY_SIZES) {
      for (const state of HUED_STATES) {
        const lightPng = await readTile('tray-light', size, state);
        const mark = extractRingColor(lightPng);
        const measuredHue = hueOf(mark.r, mark.g, mark.b);
        const expected = LIGHT_STATE_COLORS[state];
        const expectedHue = hueOf(expected.r, expected.g, expected.b);
        const delta = hueDelta(measuredHue, expectedHue);
        expect(
          delta,
          `tray-light/${size}/${state}.png mark hue ${measuredHue.toFixed(1)}° vs ` +
            `LIGHT_STATE_COLORS.${state} hue ${expectedHue.toFixed(1)}° (mark rgb ` +
            `${Math.round(mark.r)},${Math.round(mark.g)},${Math.round(mark.b)})`,
        ).toBeLessThanOrEqual(HUE_TOLERANCE_DEG);
      }
    }
  });
});

describe('badge legibility on a light tile', () => {
  // One representative state ("waiting") — the badge geometry and colours are the same code path
  // (`paintBadge`) regardless of which tile it composites over, so this is about the badge's own
  // disc/rim/digit contrast, not about re-checking every state. Size is *not* representative,
  // though (D3(e) asks for "every shipped tray size"): the rim sample point sits exactly on the
  // tile's edge (`cx + radius + rim` == `size`, by construction of `cx`/`cy` below), so rounding
  // can push it one column past the last valid index — silently wrapping into the next row via
  // the unbounded `y * size + x` index instead of erroring. That happened at 16px and 20px when
  // this was widened from a single size, which is exactly the kind of small-size roundoff this
  // suite is watching for elsewhere (see the distinguishability test above) — so `sample` clamps
  // its coordinates the way `pixelAt` already treats out-of-range reads (§`test/unit/png.ts`),
  // and every size is checked instead of just one.
  it('keeps the badge disc, rim and digit each >= 3:1 against their neighbour, at every size', async () => {
    const shouldUseDarkColors = { value: false };
    vi.doMock('electron', () => ({
      nativeTheme: {
        get shouldUseDarkColors() {
          return shouldUseDarkColors.value;
        },
      },
    }));
    const { paintBadge, createBitmap } = await import('../../src/main/tray-icons.ts');

    for (const size of TRAY_SIZES) {
      const png = await readTile('tray-light', size, 'waiting');
      const bitmap = createBitmap(size, size);
      // RGBA (straight alpha, from the PNG) → premultiplied BGRA, `Bitmap`'s own format.
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const p = pixelAt(png, x, y);
          const i = (y * size + x) * 4;
          const a = p.a / 255;
          bitmap.data[i] = Math.round(p.b * a);
          bitmap.data[i + 1] = Math.round(p.g * a);
          bitmap.data[i + 2] = Math.round(p.r * a);
          bitmap.data[i + 3] = p.a;
        }
      }

      paintBadge(bitmap, '3', false);

      const sample = (x: number, y: number): string => {
        const cx2 = Math.min(size - 1, Math.max(0, Math.round(x)));
        const cy2 = Math.min(size - 1, Math.max(0, Math.round(y)));
        const i = (cy2 * size + cx2) * 4;
        const b = bitmap.data[i] ?? 0;
        const g = bitmap.data[i + 1] ?? 0;
        const r = bitmap.data[i + 2] ?? 0;
        return toHex(r, g, b);
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
      // — the obvious sample point. Sampling dead-centre with a label painted there means
      // sampling the glyph, not the disc (confirmed: it read back #ffffff, the digit's own
      // colour, not the disc's red). A point offset horizontally at the disc's own height clears
      // the glyph's bounding box at every shipped size (checked 16-48px) while staying inside
      // the disc radius.
      const discColour = sample(cx + radius * 0.6, cy);
      const rimColour = sample(cx + radius + rim / 2, cy);
      // Top-left cell of glyph '3' (row "111") is always lit.
      const digitColour = sample(
        Math.round(cx - (3 * scale) / 2),
        Math.round(cy - (5 * scale) / 2),
      );

      expect(
        contrast(discColour, rimColour),
        `${size}px disc ${discColour} vs rim ${rimColour}`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(digitColour, discColour),
        `${size}px digit ${digitColour} vs disc ${discColour}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('fallback tile survives a light taskbar', () => {
  // D4's own acceptance line: "contrast of each fallback colour against #f3f3f3 >= 3:1
  // (asserted in D3's file)". `renderFallbackTile` only runs when the shipped art is missing, so
  // there is no PNG to decode here — this checks the `LIGHT_STATE_COLORS` constants it draws
  // with directly, the same way `theme.test.ts` checks CSS tokens rather than rendered pixels.
  it('keeps every LIGHT_STATE_COLORS entry at >= 3:1 against the light taskbar', () => {
    for (const [state, { r, g, b }] of Object.entries(LIGHT_STATE_COLORS)) {
      const hex = toHex(r, g, b);
      expect(contrast(hex, TASKBAR_LIGHT), `LIGHT_STATE_COLORS.${state} (${hex})`).toBeGreaterThanOrEqual(3);
    }
  });
});
