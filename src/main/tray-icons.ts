/**
 * Tray icon states and the overlay badge (F3, F4, §6.5).
 *
 * The icons are drawn in code rather than shipped as art: there are 5 states × 11 badge
 * variants, they must stay pixel-crisp at 16/32 px, and a tiny PNG encoder is less
 * machinery than a build step plus an image library. No native dependency, works headless,
 * and `scripts/generate-icons.ts` reuses exactly this code to emit `assets/icons/`.
 */

import { deflateSync } from 'node:zlib';
import type { TrayState } from '../core/model/status.ts';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Icon colour per state. Order of urgency is defined in `core/model/status.ts`. */
export const STATE_COLORS: Record<TrayState, Rgb> = {
  waiting: { r: 255, g: 159, b: 10 }, // amber — probably blocked on you
  done: { r: 48, g: 209, b: 88 }, // green — turn finished
  working: { r: 10, g: 132, b: 255 }, // blue — busy
  idle: { r: 142, g: 142, b: 147 }, // grey — alive but quiet
  none: { r: 99, g: 99, b: 104 }, // dim outline — nothing running
};

const BADGE_COLOR: Rgb = { r: 255, g: 59, b: 48 };
const BADGE_TEXT: Rgb = { r: 255, g: 255, b: 255 };

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

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  /** Alpha-composite a colour onto a pixel. */
  blend(x: number, y: number, color: Rgb, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const a = Math.max(0, Math.min(1, alpha));
    if (a === 0) return;
    const i = (y * this.width + x) * 4;
    const srcA = this.data[i + 3]! / 255;
    const outA = a + srcA * (1 - a);
    if (outA <= 0) return;
    for (let c = 0; c < 3; c += 1) {
      const src = this.data[i + c]! / 255;
      const dst = [color.r, color.g, color.b][c]! / 255;
      this.data[i + c] = Math.round(((dst * a + src * srcA * (1 - a)) / outA) * 255);
    }
    this.data[i + 3] = Math.round(outA * 255);
  }

  /** Filled circle with 3×3 supersampled edges. */
  circle(cx: number, cy: number, radius: number, color: Rgb): void {
    const min = Math.max(0, Math.floor(cx - radius - 1));
    const max = Math.min(this.width - 1, Math.ceil(cx + radius + 1));
    const yMin = Math.max(0, Math.floor(cy - radius - 1));
    const yMax = Math.min(this.height - 1, Math.ceil(cy + radius + 1));
    for (let y = yMin; y <= yMax; y += 1) {
      for (let x = min; x <= max; x += 1) {
        this.blend(x, y, color, coverage(x, y, cx, cy, radius));
      }
    }
  }

  ring(cx: number, cy: number, radius: number, thickness: number, color: Rgb): void {
    const inner = Math.max(0, radius - thickness);
    const min = Math.max(0, Math.floor(cx - radius - 1));
    const max = Math.min(this.width - 1, Math.ceil(cx + radius + 1));
    const yMin = Math.max(0, Math.floor(cy - radius - 1));
    const yMax = Math.min(this.height - 1, Math.ceil(cy + radius + 1));
    for (let y = yMin; y <= yMax; y += 1) {
      for (let x = min; x <= max; x += 1) {
        const outside = coverage(x, y, cx, cy, radius);
        const hole = coverage(x, y, cx, cy, inner);
        this.blend(x, y, color, Math.max(0, outside - hole));
      }
    }
  }

  glyph(text: string, x: number, y: number, scale: number, color: Rgb): void {
    let cursor = x;
    for (const char of text) {
      const rows = GLYPHS[char];
      if (!rows) continue;
      rows.forEach((row, ry) => {
        [...row].forEach((cell, rx) => {
          if (cell !== '1') return;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              this.blend(cursor + rx * scale + dx, y + ry * scale + dy, color, 1);
            }
          }
        });
      });
      cursor += (3 + 1) * scale;
    }
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.data);
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
 * One tray icon. `size` 32 covers 100–200 % Windows scaling; Electron downsamples for the
 * 16 px slot.
 */
export function renderTrayIcon(state: TrayState, badgeCount = 0, size = 32): Buffer {
  const canvas = new Canvas(size, size);
  const color = STATE_COLORS[state];
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.34;

  if (state === 'none') {
    // Nothing running: an outline, so the tray is visibly present but quiet.
    canvas.ring(cx, cy, radius, Math.max(1.5, size * 0.09), color);
  } else {
    canvas.circle(cx, cy, radius, color);
    if (state === 'waiting') {
      // A notch distinguishes "probably waiting" from "done" without relying on colour.
      canvas.circle(cx + radius * 0.15, cy, radius * 0.42, { r: 28, g: 28, b: 30 });
    }
    if (state === 'working') {
      canvas.ring(cx, cy, radius * 0.55, Math.max(1, size * 0.06), { r: 255, g: 255, b: 255 });
    }
  }

  const label = badgeLabel(badgeCount);
  if (label) {
    const br = size * 0.28;
    const bx = size - br - 1;
    const by = size - br - 1;
    canvas.circle(bx, by, br, BADGE_COLOR);
    const scale = Math.max(1, Math.round(size / 16));
    const glyphW = 3 * scale;
    const glyphH = 5 * scale;
    canvas.glyph(label, Math.round(bx - glyphW / 2), Math.round(by - glyphH / 2), scale, BADGE_TEXT);
  }

  return canvas.toPng();
}

/** Application icon: the `done` dot on a rounded dark tile. */
export function renderAppIcon(size = 256): Buffer {
  const canvas = new Canvas(size, size);
  const tile: Rgb = { r: 24, g: 24, b: 27 };
  const radius = size * 0.22;
  // Rounded square: a filled rect plus corner circles.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inX = x >= radius && x <= size - radius;
      const inY = y >= radius && y <= size - radius;
      if (inX || inY) canvas.blend(x, y, tile, 1);
    }
  }
  for (const [cx, cy] of [
    [radius, radius],
    [size - radius, radius],
    [radius, size - radius],
    [size - radius, size - radius],
  ] as const) {
    canvas.circle(cx, cy, radius, tile);
  }
  canvas.circle(size / 2, size / 2, size * 0.26, STATE_COLORS.done);
  canvas.ring(size / 2, size / 2, size * 0.36, size * 0.035, { r: 90, g: 90, b: 96 });
  return canvas.toPng();
}

// ---------------------------------------------------------------- PNG / ICO

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type: none
    Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * ICO container with PNG payloads — supported since Windows Vista and what
 * electron-builder needs for the portable EXE (N3).
 */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const directory = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((image, index) => {
    const at = index * 16;
    directory[at] = image.size >= 256 ? 0 : image.size;
    directory[at + 1] = image.size >= 256 ? 0 : image.size;
    directory[at + 2] = 0; // palette
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}
