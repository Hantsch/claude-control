/**
 * Overlay badge and the code-drawn fallback tile (F3, F4, §6.5).
 *
 * The tray tiles themselves are shipped art — `assets/icons/tray/<px>/<state>.png`, assembled
 * by `scripts/build-icons.py`. This file does the two things an image file cannot: stamp the
 * live session count onto a tile, and draw something recognisable if the art cannot be read,
 * so a missing file degrades the tray instead of blanking it.
 *
 * Everything works on Electron's own bitmap format — premultiplied BGRA — so a tile loaded
 * from disk and a tile drawn here are the same kind of thing and go through the same
 * compositing code.
 */

import type { TrayIcon, TrayState } from '../core/model/status.ts';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Icon colour per state. Order of urgency is defined in `core/model/status.ts`. The shipped
 * art is drawn in these colours; the fallback tile uses them directly.
 */
export const STATE_COLORS: Record<TrayState, Rgb> = {
  waiting: { r: 255, g: 159, b: 10 }, // amber — probably blocked on you
  done: { r: 48, g: 209, b: 88 }, // green — turn finished
  stale: { r: 172, g: 142, b: 104 }, // muted amber — running long, probably fine
  working: { r: 10, g: 132, b: 255 }, // blue — busy
  none: { r: 99, g: 99, b: 104 }, // dim outline — nothing running
};

const BADGE_COLOR: Rgb = { r: 255, g: 59, b: 48 };
const BADGE_TEXT: Rgb = { r: 255, g: 255, b: 255 };
/** Near-black rim: the badge sits on top of the state ring and has to separate from it. */
const BADGE_RIM_COLOR: Rgb = { r: 18, g: 18, b: 20 };
/** Badge radius and rim width, relative to the tile. */
const BADGE_RADIUS = 0.24;
const BADGE_RIM = 0.045;
/**
 * Digit height as a fraction of the badge diameter, floored to whole font pixels — a 3×5
 * font scaled by anything but an integer is mush at tray sizes. Flooring is what keeps the
 * digit off the rim: rounding lands on 2× at 24 px, where a 10 px digit fills a 11.5 px disc.
 */
const BADGE_GLYPH = 0.68;

/** 3×5 pixel font — enough for a badge count and the `+` overflow marker. */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '010'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

/** A premultiplied BGRA image — what `nativeImage.createFromBitmap` and `toBitmap` speak. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

/** Alpha-composite a colour onto one pixel. Premultiplied `over`: out = src·a + dst·(1−a). */
function blend(bitmap: Bitmap, x: number, y: number, color: Rgb, alpha: number): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
  const a = Math.max(0, Math.min(1, alpha));
  if (a === 0) return;
  const i = (y * bitmap.width + x) * 4;
  const keep = 1 - a;
  const { data } = bitmap;
  data[i] = Math.round(color.b * a + data[i]! * keep);
  data[i + 1] = Math.round(color.g * a + data[i + 1]! * keep);
  data[i + 2] = Math.round(color.r * a + data[i + 2]! * keep);
  data[i + 3] = Math.round(255 * a + data[i + 3]! * keep);
}

/** Filled circle with 3×3 supersampled edges. */
function circle(bitmap: Bitmap, cx: number, cy: number, radius: number, color: Rgb): void {
  forEachPixelNear(bitmap, cx, cy, radius, (x, y) => {
    blend(bitmap, x, y, color, coverage(x, y, cx, cy, radius));
  });
}

function ring(
  bitmap: Bitmap,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  color: Rgb,
): void {
  const inner = Math.max(0, radius - thickness);
  forEachPixelNear(bitmap, cx, cy, radius, (x, y) => {
    const outside = coverage(x, y, cx, cy, radius);
    const hole = coverage(x, y, cx, cy, inner);
    blend(bitmap, x, y, color, Math.max(0, outside - hole));
  });
}

function glyph(
  bitmap: Bitmap,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgb,
): void {
  let cursor = x;
  for (const char of text) {
    const rows = GLYPHS[char];
    if (!rows) continue;
    rows.forEach((row, ry) => {
      [...row].forEach((cell, rx) => {
        if (cell !== '1') return;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            blend(bitmap, cursor + rx * scale + dx, y + ry * scale + dy, color, 1);
          }
        }
      });
    });
    cursor += (3 + 1) * scale;
  }
}

function forEachPixelNear(
  bitmap: Bitmap,
  cx: number,
  cy: number,
  radius: number,
  visit: (x: number, y: number) => void,
): void {
  const xMin = Math.max(0, Math.floor(cx - radius - 1));
  const xMax = Math.min(bitmap.width - 1, Math.ceil(cx + radius + 1));
  const yMin = Math.max(0, Math.floor(cy - radius - 1));
  const yMax = Math.min(bitmap.height - 1, Math.ceil(cy + radius + 1));
  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) visit(x, y);
  }
}

function coverage(x: number, y: number, cx: number, cy: number, radius: number): number {
  if (radius <= 0) return 0;
  const samples = 3;
  let hits = 0;
  for (let sy = 0; sy < samples; sy += 1) {
    for (let sx = 0; sx < samples; sx += 1) {
      const px = x + (sx + 0.5) / samples;
      const py = y + (sy + 0.5) / samples;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= radius * radius) hits += 1;
    }
  }
  return hits / (samples * samples);
}

/** Badge label for a count: 1–9 as a digit, more as `+`. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count <= 9 ? String(count) : '+';
}

/**
 * Stamp the badge into the bottom-right corner of a tile (F4).
 *
 * At 16 px the digit is barely more than a mark — which is why the exact number is also in
 * the tooltip and the popover. It still beats no badge: the mark alone says "something is
 * waiting for you", and that is the part that has to survive at tray size.
 */
export function paintBadge(bitmap: Bitmap, label: string): void {
  const size = Math.min(bitmap.width, bitmap.height);
  const radius = size * BADGE_RADIUS;
  const rim = Math.max(1, size * BADGE_RIM);
  const cx = bitmap.width - radius - rim;
  const cy = bitmap.height - radius - rim;

  circle(bitmap, cx, cy, radius + rim, BADGE_RIM_COLOR);
  circle(bitmap, cx, cy, radius, BADGE_COLOR);

  const scale = Math.max(1, Math.floor((2 * radius * BADGE_GLYPH) / 5));
  glyph(
    bitmap,
    label,
    Math.round(cx - (3 * scale) / 2),
    Math.round(cy - (5 * scale) / 2),
    scale,
    BADGE_TEXT,
  );
}

/**
 * Tile drawn in code, used only when the shipped art cannot be read.
 *
 * Deliberately plain — a disc for the states that assert something, a hollow ring for the two
 * quiet ones, and the working colour around a finished disc for `mixed`. It exists so a
 * missing asset cannot leave the tray blank, not to imitate the art.
 */
export function renderFallbackTile(icon: TrayIcon, size: number): Bitmap {
  const bitmap = createBitmap(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.34;
  const outline = Math.max(1.5, size * 0.09);

  switch (icon) {
    case 'none':
    case 'stale':
      // An outline rather than a disc: present, but not asserting itself. For `none` that
      // means "quiet"; for `stale` it means "running long, probably fine" — the muted colour
      // carries the difference, the hollow shape keeps it from reading as an alarm.
      ring(bitmap, cx, cy, radius, outline, STATE_COLORS[icon]);
      break;
    case 'waiting':
      circle(bitmap, cx, cy, radius, STATE_COLORS.waiting);
      // A notch distinguishes "needs you?" from "done" without relying on colour.
      circle(bitmap, cx + radius * 0.15, cy, radius * 0.42, { r: 28, g: 28, b: 30 });
      break;
    case 'working':
      circle(bitmap, cx, cy, radius, STATE_COLORS.working);
      ring(bitmap, cx, cy, radius * 0.55, Math.max(1, size * 0.06), { r: 255, g: 255, b: 255 });
      break;
    case 'done':
      circle(bitmap, cx, cy, radius, STATE_COLORS.done);
      break;
    case 'mixed':
      // Finished, with something still running around it.
      circle(bitmap, cx, cy, radius * 0.6, STATE_COLORS.done);
      ring(bitmap, cx, cy, radius, outline, STATE_COLORS.working);
      break;
  }

  return bitmap;
}
