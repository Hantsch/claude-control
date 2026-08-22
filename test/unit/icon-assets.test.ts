/**
 * D2 of story 014: the tray tile has to come from the folder matching the OS taskbar theme —
 * `tray/` on dark, `tray-light/` on light — and a missing light tile has to fall back to the
 * dark one rather than the code-drawn fallback (that fallback is reserved for a state missing
 * from both sets). Mirrors the mocking style of `test/unit/tray-icons.test.ts`, faking `fs` so
 * the test can control exactly which files "exist" without touching the real asset tree.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const shouldUseDarkColors = { value: true };
/** Files the fake `readFileSync` will resolve; anything else throws ENOENT. */
const availableFiles = new Set<string>();

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
    createFromBitmap: (data: Buffer) => ({ isEmpty: () => false, data }),
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    const normalized = path.replace(/\\/g, '/');
    for (const file of availableFiles) {
      if (normalized.endsWith(file)) return Buffer.from(file);
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  },
  existsSync: () => false,
}));

const { trayImage } = await import('../../src/main/icon-assets.ts');

describe('trayImage theme selection', () => {
  beforeEach(() => {
    availableFiles.clear();
  });

  it('reads from tray/ on the dark theme', () => {
    shouldUseDarkColors.value = true;
    availableFiles.add('tray/16/working.png');
    const image = trayImage('working', 0, 16) as unknown as { data: Buffer };
    expect(image.data.toString()).toBe('tray/16/working.png');
  });

  it('reads from tray-light/ on the light theme when the light tile is present', () => {
    shouldUseDarkColors.value = false;
    availableFiles.add('tray-light/16/working.png');
    availableFiles.add('tray/16/working.png');
    const image = trayImage('working', 0, 16) as unknown as { data: Buffer };
    expect(image.data.toString()).toBe('tray-light/16/working.png');
  });

  it('falls back to the dark tray/ tile when the light tile is missing', () => {
    // A distinct icon from the previous case, so the module-level image cache (keyed on
    // icon/badge/size/theme) cannot mask a wrong folder lookup with a stale cached image.
    shouldUseDarkColors.value = false;
    availableFiles.add('tray/16/done.png');
    const image = trayImage('done', 0, 16) as unknown as { data: Buffer };
    expect(image.data.toString()).toBe('tray/16/done.png');
  });
});
