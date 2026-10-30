import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HIDDEN_CAUSE_LABELS, hiddenIndicator } from '../../src/renderer/lib/hiddenSessions.ts';

const path = (rel: string): string =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');
const APP = path('../../src/renderer/App.tsx');
const POPOVER = path('../../src/renderer/popover.tsx');

describe('hiddenIndicator', () => {
  it('nothing hidden renders nothing', () => {
    expect(hiddenIndicator({ count: 0, causes: [] })).toBeNull();
  });

  it('the tooltip names exactly the Settings toggles that hid the sessions', () => {
    const causes = Object.keys(HIDDEN_CAUSE_LABELS) as (keyof typeof HIDDEN_CAUSE_LABELS)[];
    for (const given of [['unused'], ['unused', 'doneOnStart', 'orphan']] as (typeof causes)[]) {
      const shown = hiddenIndicator({ count: given.length, causes: given })!;
      expect(shown.text).toContain(String(given.length));
      for (const cause of causes) {
        const label = HIDDEN_CAUSE_LABELS[cause];
        if (given.includes(cause)) expect(shown.title).toContain(label);
        else expect(shown.title).not.toContain(label);
      }
    }
  });
});

describe('hidden count wiring', () => {
  it('the main window and the popover render the hidden count through hiddenIndicator', () => {
    for (const file of [APP, POPOVER]) {
      const source = readFileSync(file, 'utf8');
      expect(source).toMatch(/import\s*\{[^}]*hiddenIndicator[^}]*\}\s*from\s*'\.\/lib\/hiddenSessions\.ts'/);
    }
  });
});
