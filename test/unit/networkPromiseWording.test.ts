/**
 * 019/D1 rewords the N1 "no outbound requests" promise to name a second opt-in exception (the
 * update check) alongside the first one (story 005's exact-context-window lookup). This pins
 * the wording in the three user-facing spots so a later edit cannot silently drop back to the
 * single-exception (or fully absolute) phrasing.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const OLD_SINGLE_EXCEPTION_PHRASES = [
  'is the one exception, making exactly one outbound request while it is on',
  'is the sole exception, making exactly one outbound request only while it is on',
  'is the\n            only exception, making exactly one outbound request while it is turned on.',
  'the exact-context-window lookup above is the',
  'the one exception is the opt-in exact-context-window lookup, which makes exactly one\noutbound request while turned on and none otherwise.',
];

async function read(path: string): Promise<string> {
  return readFile(join(ROOT, path), 'utf8');
}

describe('N1 network promise wording (019/D1)', () => {
  it('README.md no longer states the single-exception phrase, and names both exceptions', async () => {
    const text = await read('README.md');
    for (const phrase of OLD_SINGLE_EXCEPTION_PHRASES) {
      expect(text).not.toContain(phrase);
    }
    expect(text).toContain('exact-context-window lookup and the optional');
    expect(text).toContain('update check (both opt-in, off by default) are the two exceptions');
  });

  it('docs/CONCEPT.md no longer states the single-exception phrase, and names both exceptions', async () => {
    const text = await read('docs/CONCEPT.md');
    for (const phrase of OLD_SINGLE_EXCEPTION_PHRASES) {
      expect(text).not.toContain(phrase);
    }
    expect(text).toContain(
      'the opt-in exact-context-window lookup and the opt-in update check are the two exceptions',
    );
  });

  it('SettingsView.tsx Diagnostics footer no longer states the single-exception phrase, and names both exceptions', async () => {
    const text = await read('src/renderer/components/SettingsView.tsx');
    for (const phrase of OLD_SINGLE_EXCEPTION_PHRASES) {
      expect(text).not.toContain(phrase);
    }
    expect(text).toContain('the exact-context-window lookup above and the');
    expect(text).toContain('update check are the two exceptions, each making its own request only while it is');
  });
});
