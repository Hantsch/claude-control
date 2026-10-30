import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hiddenIndicator } from '../../src/renderer/lib/hiddenSessions.ts';

const path = (rel: string): string =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');
const APP = path('../../src/renderer/App.tsx');
const POPOVER = path('../../src/renderer/popover.tsx');

describe('hiddenIndicator', () => {
  it('nothing hidden renders nothing', () => {
    expect(hiddenIndicator({ count: 0, causes: [] })).toBeNull();
  });

  it('the tooltip names every responsible filter by its Settings label', () => {
    const one = hiddenIndicator({ count: 1, causes: ['unused'] })!;
    expect(one.text).toBe('1 hidden');
    expect(one.title).toContain('Hide unused sessions');
    expect(one.title).not.toContain('Hide abandoned sessions');
    expect(one.title).toContain('Settings › Session list');

    const all = hiddenIndicator({ count: 3, causes: ['unused', 'doneOnStart', 'orphan'] })!;
    expect(all.text).toBe('3 hidden');
    expect(all.title).toContain('Hide unused sessions');
    expect(all.title).toContain('Hide sessions already done at start');
    expect(all.title).toContain('Hide abandoned sessions');
  });

  it('the hidden tooltip names filters, never tray recency', () => {
    const { title } = hiddenIndicator({ count: 2, causes: ['doneOnStart', 'orphan'] })!;
    expect(title).not.toMatch(/settled/i);
  });
});

describe('hidden count wiring', () => {
  it('the main window and the popover render the hidden count through hiddenIndicator', () => {
    for (const file of [APP, POPOVER]) {
      const source = readFileSync(file, 'utf8');
      expect(source).toMatch(/import\s*\{[^}]*hiddenIndicator[^}]*\}\s*from\s*'\.\/lib\/hiddenSessions\.ts'/);
      expect(source).toMatch(/hiddenIndicator\(\s*state\.hidden\s*\)/);
      expect(source).toMatch(/title=\{hiddenBadge\.title\}/);
    }
  });

  it('the popover keeps the settled count and adds the hidden count beside it', () => {
    const source = readFileSync(POPOVER, 'utf8');
    expect(source).toMatch(/\$\{hidden\} settled/);
    const settled = source.indexOf('} settled');
    const badge = source.indexOf('hiddenBadge.title');
    expect(settled).toBeGreaterThan(-1);
    expect(badge).toBeGreaterThan(settled);
  });
});
