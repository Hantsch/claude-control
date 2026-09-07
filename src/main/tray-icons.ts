/**
 * The tray tile and its overlay badge (F3, F4, §6.5).
 *
 * Both are drawn in code, at the exact physical size Windows asks for. The tile used to be
 * shipped art — a rounded near-black plate carrying a glowing ring, generated per state and
 * per size — and at the size the tray actually shows it (16 px at 100 % scaling) that plate
 * ate the box and the state went with it. What replaces it is the mark the rest of the app
 * already uses for a status: the status dot from `renderer/styles.css`, scaled up to fill the
 * tray box, in the same `--status-*` colours. One vocabulary, one place to change it.
 *
 * Everything works on Electron's own bitmap format — premultiplied BGRA — so the tile and the
 * badge composited onto it are the same kind of thing and go through the same code.
 */

import { nativeTheme } from 'electron';
import type { TrayIcon, TrayState } from '../core/model/status.ts';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Icon colour per state, for a dark taskbar. Order of urgency is defined in
 * `core/model/status.ts`; the hues are the dark scheme's `--status-*` tokens from
 * `renderer/styles.css`, so the tray dot and the dot in the window are the same mark.
 */
export const STATE_COLORS: Record<TrayState, Rgb> = {
  waiting: { r: 255, g: 159, b: 10 }, // amber — probably blocked on you
  done: { r: 48, g: 209, b: 88 }, // green — turn finished
  stale: { r: 172, g: 142, b: 104 }, // muted amber — running long, probably fine
  working: { r: 10, g: 132, b: 255 }, // blue — busy
  none: { r: 112, g: 112, b: 118 }, // dim outline — nothing running
};

/**
 * Light-theme mirror of `STATE_COLORS` (§014 D4) — same hues `styles.css`'s
 * `prefers-color-scheme: light` block uses for `--status-*`, darkened enough to read on a light
 * taskbar instead of the dark one these were tuned for. `none` has no `--status-*` light token
 * (it's a neutral/dim state), so this picks a grey dim enough to still read as "quiet" against
 * `#f3f3f3` — checked for contrast by `test/unit/trayTileContrast.test.ts`.
 */
export const LIGHT_STATE_COLORS: Record<TrayState, Rgb> = {
  waiting: { r: 160, g: 76, b: 0 },
  done: { r: 21, g: 127, b: 60 },
  stale: { r: 143, g: 124, b: 95 },
  working: { r: 27, g: 95, b: 201 },
  none: { r: 90, g: 90, b: 96 },
};

const BADGE_COLOR: Rgb = { r: 255, g: 59, b: 48 };
const BADGE_TEXT: Rgb = { r: 255, g: 255, b: 255 };
/** Near-black rim: on a dark taskbar it separates the badge from the state ring beneath it. */
const BADGE_RIM_COLOR_DARK: Rgb = { r: 18, g: 18, b: 20 };
/** Near-white rim: the dark one disappears into a light taskbar, so light theme gets the mirror. */
const BADGE_RIM_COLOR_LIGHT: Rgb = { r: 240, g: 240, b: 240 };

/** Rim colour for the current OS theme (§007 D4) — dark taskbar keeps the near-black rim. */
export function badgeRimColor(dark: boolean = nativeTheme.shouldUseDarkColors): Rgb {
  return dark ? BADGE_RIM_COLOR_DARK : BADGE_RIM_COLOR_LIGHT;
}
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

/** Ring with the same supersampled edges. `alpha` is what makes the `waiting` halo a halo. */
function ring(
  bitmap: Bitmap,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  color: Rgb,
  alpha = 1,
): void {
  const inner = Math.max(0, radius - thickness);
  forEachPixelNear(bitmap, cx, cy, radius, (x, y) => {
    const outside = coverage(x, y, cx, cy, radius);
    const hole = coverage(x, y, cx, cy, inner);
    blend(bitmap, x, y, color, Math.max(0, outside - hole) * alpha);
  });
}

/**
 * Punch a circle back out of what has been drawn — the `waiting` notch. Erasing rather than
 * painting a dark disc is what makes the notch work on both taskbars: it is the taskbar
 * showing through, so it cannot be the wrong colour against the tile behind it.
 */
function erase(bitmap: Bitmap, cx: number, cy: number, radius: number): void {
  forEachPixelNear(bitmap, cx, cy, radius, (x, y) => {
    if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
    const keep = 1 - coverage(x, y, cx, cy, radius);
    const i = (y * bitmap.width + x) * 4;
    const { data } = bitmap;
    // Premultiplied, so scaling all four channels is the whole operation.
    for (let c = 0; c < 4; c += 1) data[i + c] = Math.round(data[i + c]! * keep);
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
export function paintBadge(
  bitmap: Bitmap,
  label: string,
  dark: boolean = nativeTheme.shouldUseDarkColors,
): void {
  const size = Math.min(bitmap.width, bitmap.height);
  const radius = size * BADGE_RADIUS;
  const rim = Math.max(1, size * BADGE_RIM);
  const cx = bitmap.width - radius - rim;
  const cy = bitmap.height - radius - rim;

  circle(bitmap, cx, cy, radius + rim, badgeRimColor(dark));
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
 * Tile geometry, all as a fraction of the tile's edge so every physical size draws the same
 * picture. The mark is deliberately large: at 16 px, `MARK_RADIUS` is a 12.8 px dot in a
 * 16 px box, which is the whole reason this replaced the shipped art — that art spent the box
 * on a plate and a glow and had nothing left for the state.
 */
const MARK_RADIUS = 0.4;
/** Stroke of the two hollow marks. One physical pixel at 16 px would disappear; this is ~1.8. */
const RING_STROKE = 0.115;
/** `none` is drawn smaller and thinner than the rest — "nothing here" should not shout. */
const NONE_RADIUS = 0.33;
const NONE_STROKE = 0.085;
/**
 * `waiting` is the one state that has to survive being read wrong: it is the state that means
 * "you are blocked", and amber against `done`'s green is exactly the pair colour vision drops
 * first. So it gets a shape as well — a notch bitten out of the disc, the shape the code-drawn
 * tile has always used for it — plus the halo `.dot.halo` draws around the same dot in the
 * window. The disc pulls in from `MARK_RADIUS` to leave the halo room outside it.
 */
const WAITING_DISC = 0.3;
const WAITING_NOTCH = 0.19;
/** Notch centre, right of the disc's, so the bite is off-centre and reads as a bite. */
const WAITING_NOTCH_OFFSET = 0.17;
const HALO_STROKE = 0.085;
/** Roughly `--halo-strength` (35 %), nudged up because the halo has no text beside it here. */
const HALO_ALPHA = 0.5;
/** `working`'s core, and `mixed`'s inner disc. */
const CORE_RADIUS = 0.16;
const MIXED_CORE = 0.2;
const CORE_COLOR: Rgb = { r: 255, g: 255, b: 255 };

/**
 * The tray tile for one state, drawn at a physical pixel size (F3, §6.5).
 *
 * The vocabulary is the app's own status dot: a filled disc in the state's `--status-*` colour,
 * which is exactly what the sessions list and the popover show for the same state. On top of
 * that, each state gets a shape as well as a hue, so the tray still says something when the
 * colours are hard to tell apart — a filled disc for the states that assert something
 * (`done`), a notched disc plus its halo for the one that demands attention (`waiting`), a disc
 * with a core for `working`, hollow rings for the two quiet ones
 * (`none` small and thin, `stale` full size — same shape, different weight, the relationship
 * those two states have everywhere else), and `mixed` as a finished disc inside a working ring.
 */
export function renderTrayTile(
  icon: TrayIcon,
  size: number,
  dark: boolean = nativeTheme.shouldUseDarkColors,
): Bitmap {
  const bitmap = createBitmap(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const colors = dark ? STATE_COLORS : LIGHT_STATE_COLORS;
  const radius = size * MARK_RADIUS;
  const stroke = Math.max(1.5, size * RING_STROKE);

  switch (icon) {
    case 'none':
      ring(bitmap, cx, cy, size * NONE_RADIUS, Math.max(1, size * NONE_STROKE), colors.none);
      break;
    case 'stale':
      // Hollow like `none`, full size like the states that assert something: `stale` is a hint
      // that something may be worth a look, not a demand and not silence (§6.3).
      ring(bitmap, cx, cy, radius, stroke, colors.stale);
      break;
    case 'waiting':
      ring(bitmap, cx, cy, radius, Math.max(1, size * HALO_STROKE), colors.waiting, HALO_ALPHA);
      circle(bitmap, cx, cy, size * WAITING_DISC, colors.waiting);
      erase(bitmap, cx + size * WAITING_NOTCH_OFFSET, cy, size * WAITING_NOTCH);
      break;
    case 'working':
      circle(bitmap, cx, cy, radius, colors.working);
      // The dot in the window pulses to say "busy"; a tray tile cannot animate, so the core
      // carries that difference instead. Its contrast is against the blue disc under it, not
      // the taskbar, so it stays white in both themes.
      circle(bitmap, cx, cy, size * CORE_RADIUS, CORE_COLOR);
      break;
    case 'done':
      circle(bitmap, cx, cy, radius, colors.done);
      break;
    case 'mixed':
      // Finished, with something still running around it.
      ring(bitmap, cx, cy, radius, stroke, colors.working);
      circle(bitmap, cx, cy, size * MIXED_CORE, colors.done);
      break;
  }

  return bitmap;
}
