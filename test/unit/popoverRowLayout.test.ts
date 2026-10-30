import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const STYLES = new URL('../../src/renderer/styles.css', import.meta.url).pathname.replace(
  /^\/([a-zA-Z]:)/,
  '$1',
);

describe('popover row layout', () => {
  it("the popover row's first line keeps its eight-track grid", async () => {
    const css = await readFile(STYLES, 'utf8');
    const body = /\.popover-row \.l1\s*[,{][^{}]*?\{?([^{}]*)\}/.exec(css)?.[1] ?? '';
    const columns = /grid-template-columns:\s*([^;]+);/.exec(body);
    expect(css.match(/\.popover-row \.l1\s*[,{]/g)).toHaveLength(1);
    expect(columns?.[1]?.trim()).toBe('9px 13px 11px minmax(0, 1fr) 108px 92px 22px 18px');
  });
});
