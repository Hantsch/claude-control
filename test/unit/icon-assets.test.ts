/**
 * The tray tile is drawn, not loaded. `trayImage` used to pick between two shipped art folders
 * (`tray/` on a dark taskbar, `tray-light/` on a light one, §014 D2); the art is gone and the
 * tile is rendered per state and per physical size instead. Two things about that have to hold,
 * and both used to be somebody else's job:
 *
 *  - the tile still follows the OS taskbar theme, now by picking the colour set rather than the
 *    folder (§014 D4), and the per-theme cache key still keeps the two apart;
 *  - nothing reads a tray asset off disk any more, so a packaging mistake cannot blank the tray.
 *
 * Mirrors the mocking style of `test/unit/tray-icons.test.ts`: `fs` is faked so any stray read
 * is visible, and `nativeImage` hands back the bitmap it was given so the pixels can be checked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const shouldUseDarkColors = { value: true };
/** Every `assets/icons` path the module asked `fs` for. */
const reads: string[] = [];

vi.mock('electron', () => ({
  app: { getAppPath: () => 'C:/app' },
  nativeTheme: {
    get shouldUseDarkColors() {
      return shouldUseDarkColors.value;
    },
  },
  nativeImage: {
    createFromBuffer: (buffer: Buffer) => ({
      isEmpty: () => false,
      getSize: () => ({ width: 16, height: 16 }),
      toBitmap: () => buffer,
      data: buffer,
    }),
    createFromBitmap: (data: Buffer, size: { width: number; height: number }) => ({
      isEmpty: () => false,
      data,
      size,
    }),
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    reads.push(path.replace(/\\/g, '/'));
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  },
  existsSync: () => false,
}));

const { trayImage, trayPixelSize } = await import('../../src/main/icon-assets.ts');
const { STATE_COLORS, LIGHT_STATE_COLORS } = await import('../../src/main/tray-icons.ts');

/** Centre pixel of a rendered tile, un-premultiplied — for `done` that is the disc's own colour. */
function centre(image: unknown, size: number): [number, number, number] {
  const { data } = image as { data: Buffer };
  const i = ((size / 2) * size + size / 2) * 4;
  return [data[i + 2] ?? 0, data[i + 1] ?? 0, data[i] ?? 0];
}

describe('trayImage', () => {
  beforeEach(() => {
    reads.length = 0;
  });

  it('draws the tile instead of reading one off disk', () => {
    shouldUseDarkColors.value = true;
    const image = trayImage('working', 0, 16) as unknown as { size: { width: number } };
    expect(reads, 'a tray asset was read from disk').toEqual([]);
    expect(image.size.width).toBe(16);
  });

  it('uses the dark state colours on a dark taskbar and the light ones on a light taskbar', () => {
    // Same icon and size for both cases on purpose: the theme is the only thing that differs,
    // so a cache key that forgot it would serve the dark tile to the light taskbar and this
    // would catch it.
    shouldUseDarkColors.value = true;
    expect(centre(trayImage('done', 0, 32), 32)).toEqual([
      STATE_COLORS.done.r,
      STATE_COLORS.done.g,
      STATE_COLORS.done.b,
    ]);

    shouldUseDarkColors.value = false;
    expect(centre(trayImage('done', 0, 32), 32)).toEqual([
      LIGHT_STATE_COLORS.done.r,
      LIGHT_STATE_COLORS.done.g,
      LIGHT_STATE_COLORS.done.b,
    ]);
  });
});

describe('trayPixelSize', () => {
  it('is the physical box the display gives the tray, not a shipped size', () => {
    // 16 DIP × scaling. Nothing snaps to a set of on-disk sizes any more, so 125 % scaling gets
    // its own 20 px tile and 150 % a 24 px one instead of the nearest file.
    expect(trayPixelSize(1)).toBe(16);
    expect(trayPixelSize(1.25)).toBe(20);
    expect(trayPixelSize(1.5)).toBe(24);
    expect(trayPixelSize(2)).toBe(32);
    expect(trayPixelSize(1.75)).toBe(28);
  });

  it('falls back to the base size for a nonsense scale factor', () => {
    expect(trayPixelSize(0)).toBe(16);
    expect(trayPixelSize(-1)).toBe(16);
  });
});
