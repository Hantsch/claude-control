import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('../../src/renderer/styles.css', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'),
  'utf8',
);

function rulesFor(selectorPart: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (selector.includes(selectorPart)) rules.push({ selector, body: match[2]! });
  }
  return rules;
}

describe('detail window styles', () => {
  it('the detail window scrolls inside one container and has no fixed widths', () => {
    const rules = rulesFor('.detail-');
    expect(rules.length).toBeGreaterThan(0);
    const scrollers = rules.filter((rule) => /overflow(-y)?:\s*auto/.test(rule.body));
    expect(scrollers.map((rule) => rule.selector)).toEqual(['.detail-scroll']);
    for (const rule of rules) expect(rule.body).not.toMatch(/(^|[\s;])width:\s*\d+px/);
    expect(rules.find((rule) => rule.selector === '.detail-facts')!.body).toMatch(
      /flex-wrap:\s*wrap/,
    );
    expect(rules.find((rule) => rule.selector === '.detail-event-full')!.body).toMatch(
      /white-space:\s*pre-wrap/,
    );
  });

  it('the detail window uses only theme tokens', () => {
    const literal = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
    const colourDeclaration = /(?:^|[\s;])(?:color|background|background-color|border[a-z-]*)\s*:\s*([^;]+)/g;
    for (const rule of rulesFor('.detail-')) {
      expect(rule.body).not.toMatch(literal);
      for (const match of rule.body.matchAll(colourDeclaration)) {
        const value = match[1]!.trim();
        if (/^(transparent|0|none)$/.test(value)) continue;
        expect(value).toMatch(/var\(--[a-z-]+\)/);
      }
    }
  });
});
