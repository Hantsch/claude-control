/**
 * Story 007 D3 — the light theme's legibility claim, computed instead of glanced at.
 *
 * ACs 2 and 3 ("all statuses / all four bands remain distinguishable") are the two criteria
 * that rot silently: a hue nudged for looks still passes every screenshot and still collapses
 * two status dots into one. So this file is the metric, parsed straight out of
 * `src/renderer/styles.css`:
 *
 *  - **Contrast** via the WCAG relative-luminance ratio — body text ≥ 4.5:1 on its surface,
 *    `--text-dim` / `--text-faint` and every non-text use (dots, band fills, focus ring)
 *    ≥ 3:1 on the backdrop they are actually painted on.
 *  - **Distinguishability** via Euclidean distance in OKLab, with the *dark* scheme as the
 *    threshold rather than an invented number: dark ships and is accepted, so the light
 *    scheme's worst status pair and worst band pair must be no closer than dark's worst is.
 *    Both sides of that comparison are recomputed from this file on every run — reverting a
 *    light value to its dark twin therefore cannot slip through as a trivially true `>=`.
 *
 * Deliberately *not* asserted, so the reason is recorded rather than silently dropped: the
 * 1.3:1 hairline separators (`--border`, the scrollbar-thumb pairing of `--bg-active` on
 * `--bg-raised`) are a pre-existing property of the neutral surface tokens (007 D1) and
 * neither scheme meets 3:1 there, so that one gets a parity check against dark instead of a
 * target it would fail.
 */

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

const STYLES = new URL('../../src/renderer/styles.css', import.meta.url).pathname.replace(
  /^\/([a-zA-Z]:)/,
  '$1',
);

const LIGHT_MEDIA = '@media (prefers-color-scheme: light)';

/* ------------------------------------------------------------------ colour math (pure) */

/** `#rrggbb` → the three 0..1 sRGB components. */
function channels(hex: string): [number, number, number] {
  const body = hex.trim().replace('#', '');
  expect(body, `${hex} is not a six-digit hex colour`).toMatch(/^[0-9a-fA-F]{6}$/);
  return [0, 2, 4].map((i) => Number.parseInt(body.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** sRGB transfer function, undone (WCAG 2.x / IEC 61966-2-1). */
function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `#rrggbb` → OKLab (Björn Ottosson's matrices, via linear sRGB and the LMS cube roots). */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance: plain Euclidean in OKLab, which is what that space is for. */
function distance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** The closest pair in a set — the number that decides whether a palette collapses. */
function worstPair(colours: Array<[string, string]>): { gap: number; pair: string } {
  let gap = Number.POSITIVE_INFINITY;
  let pair = '';
  for (let i = 0; i < colours.length; i += 1) {
    for (let j = i + 1; j < colours.length; j += 1) {
      const left = colours[i];
      const right = colours[j];
      if (!left || !right) continue;
      const d = distance(left[1], right[1]);
      if (d < gap) {
        gap = d;
        pair = `${left[0]} / ${right[0]}`;
      }
    }
  }
  return { gap, pair };
}

/** What `opacity` does: composite the colour over its backdrop in gamma-encoded sRGB. */
function faded(hex: string, backdrop: string, alpha: number): string {
  const fg = channels(hex);
  const bg = channels(backdrop);
  return `#${fg
    .map((v, i) => Math.round((v * alpha + (bg[i] ?? 0) * (1 - alpha)) * 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/* ---------------------------------------------------------------------- styles.css */

type Scheme = Record<string, string>;

/** Every `--token: value;` in a declaration block, values kept raw. */
function declarations(block: string): Scheme {
  const out: Scheme = {};
  for (const match of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) out[name] = value.trim();
  }
  return out;
}

/** The body of the first `:root { … }` rule at or after `from`. `:root` bodies do not nest. */
function rootBody(css: string, from: number): string {
  const root = css.indexOf(':root', from);
  const open = css.indexOf('{', root);
  const close = css.indexOf('}', open);
  expect(root, 'styles.css has no :root block').toBeGreaterThan(-1);
  return css.slice(open + 1, close);
}

let dark: Scheme;
let light: Scheme;

beforeAll(async () => {
  const css = await readFile(STYLES, 'utf8');
  const mediaAt = css.indexOf(LIGHT_MEDIA);
  expect(mediaAt, `styles.css has no "${LIGHT_MEDIA}" block`).toBeGreaterThan(-1);
  dark = declarations(rootBody(css, 0));
  // The light branch overrides only what it names, so every lookup falls back to dark —
  // exactly how the cascade resolves it in the browser.
  light = { ...dark, ...declarations(rootBody(css, mediaAt)) };
});

const STATUSES = [
  'status-waiting',
  'status-done',
  'status-working',
  'status-stale',
  'status-queued',
  'status-starting',
  'status-ended',
  'status-unknown',
];

/** In escalation order, which is the order the gauge walks through them. */
const BANDS = ['band-green', 'band-yellow', 'band-red', 'band-critical'];

/**
 * The dark values as shipped. Pinned because the story's whole review question is "did any
 * dark value move?" — and because they are one half of every distinguishability comparison
 * below, so a quiet edit there would move the threshold instead of failing.
 */
const DARK_SEMANTIC: Scheme = {
  'status-waiting': '#ff9f0a',
  'status-done': '#30d158',
  'status-working': '#0a84ff',
  'status-stale': '#ac8e68',
  'status-queued': '#bf5af2',
  'status-starting': '#64d2ff',
  'status-ended': '#5a5a60',
  'status-unknown': '#7a7a80',
  'band-green': '#30d158',
  'band-yellow': '#ffd60a',
  'band-red': '#ff453a',
  'band-critical': '#ff2d55',
};

/** Every surface a row — and therefore a dot, a pip or a bar track — can sit on. */
const SURFACES = ['bg', 'bg-raised', 'bg-hover', 'bg-active'];

/** The two page surfaces: what "its own surface" means for a block of text. */
const PAGE_SURFACES = ['bg', 'bg-raised'];

function token(scheme: Scheme, name: string): string {
  const value = scheme[name];
  expect(value, `styles.css declares no --${name}`).toBeTruthy();
  return value ?? '';
}

/** `[name, hex]` pairs, so a failure message says which token it was. */
function palette(scheme: Scheme, names: string[]): Array<[string, string]> {
  return names.map((name) => [name, token(scheme, name)]);
}

/** The worst ratio a colour reaches across the given surfaces, and where. */
function worstOn(scheme: Scheme, colour: string, surfaces: string[]): { ratio: number; on: string } {
  let ratio = Number.POSITIVE_INFINITY;
  let on = '';
  for (const surface of surfaces) {
    const r = contrast(colour, token(scheme, surface));
    if (r < ratio) {
      ratio = r;
      on = surface;
    }
  }
  return { ratio, on };
}

/* ------------------------------------------------------------------------- the tests */

describe('colour math helpers', () => {
  it('reproduces the reference values the assertions below depend on', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    // Ottosson's own reference points: white is (1, 0, 0), black is the origin.
    expect(oklab('#ffffff')[0]).toBeCloseTo(1, 3);
    expect(Math.hypot(...oklab('#ffffff').slice(1))).toBeCloseTo(0, 3);
    expect(distance('#000000', '#ffffff')).toBeCloseTo(1, 3);
    expect(distance('#123456', '#123456')).toBe(0);
    // 50 % of a colour over white is halfway there in each channel.
    expect(faded('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('styles.css theme structure', () => {
  it('has exactly one light media block, overriding :root', async () => {
    const css = await readFile(STYLES, 'utf8');
    expect(css.split(LIGHT_MEDIA)).toHaveLength(2);
  });

  it('leaves the shipped dark values for all twelve semantic tokens untouched', () => {
    for (const [name, hex] of Object.entries(DARK_SEMANTIC)) {
      expect(token(dark, name).toLowerCase(), `dark --${name} moved`).toBe(hex);
    }
  });

  it('gives every status and band its own light value, never inheriting the dark one', () => {
    for (const name of [...STATUSES, ...BANDS]) {
      expect(
        token(light, name).toLowerCase(),
        `--${name} has no light override — it would render its dark value on a light surface`,
      ).not.toBe(token(dark, name).toLowerCase());
    }
  });
});

describe('light scheme contrast', () => {
  it('paints body text at 4.5:1 or better on every surface it lands on', () => {
    const { ratio, on } = worstOn(light, token(light, 'text'), SURFACES);
    expect(ratio, `--text on --${on}`).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the two dimmed text tokens at 3:1 or better on the page surfaces', () => {
    for (const name of ['text-dim', 'text-faint']) {
      const { ratio, on } = worstOn(light, token(light, name), [...PAGE_SURFACES, 'bg-hover']);
      expect(ratio, `--${name} on --${on}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every status and band fill at 3:1 or better against its darkest backdrop', () => {
    for (const [name, hex] of palette(light, [...STATUSES, ...BANDS])) {
      const { ratio, on } = worstOn(light, hex, SURFACES);
      expect(ratio, `--${name} (${hex}) on --${on}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('holds the two hues that are also used as text to the 4.5:1 text target', () => {
    // `--status-waiting` is the settings warning hint and the popover group's attention mark,
    // `--band-red` is `.meta.error` and the subagent row's error line. Text never sits on a
    // selected row's `--bg-active`, so the page surfaces plus hover are the honest set.
    for (const name of ['status-waiting', 'band-red']) {
      const { ratio, on } = worstOn(light, token(light, name), [...PAGE_SURFACES, 'bg-hover']);
      expect(ratio, `--${name} as text on --${on}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the focus ring at 3:1 against the row it is drawn over', () => {
    // `.popover-row:focus` and `.popover-group-head:focus-visible` outline the row while it is
    // also hovered, so `--bg-hover` is the ring's real backdrop.
    const { ratio, on } = worstOn(light, token(light, 'accent'), [...PAGE_SURFACES, 'bg-hover']);
    expect(ratio, `--accent ring on --${on}`).toBeGreaterThanOrEqual(3);
  });

  it('leaves the hairline separators no fainter than the accepted dark scheme', () => {
    // Neither scheme reaches 3:1 here and both are decorative (a 1px divider, an overlay
    // scrollbar thumb), so the honest bar is "not worse than what ships". The thumb's backdrop
    // is `--bg-raised`: `.popover-body` paints it and `.popover-list` adds no background.
    for (const surface of PAGE_SURFACES) {
      expect(
        contrast(token(light, 'border'), token(light, surface)),
        `--border on --${surface}`,
      ).toBeGreaterThanOrEqual(contrast(token(dark, 'border'), token(dark, surface)));
    }
    expect(
      contrast(token(light, 'bg-active'), token(light, 'bg-raised')),
      'scrollbar thumb on the popover list',
    ).toBeGreaterThanOrEqual(contrast(token(dark, 'bg-active'), token(dark, 'bg-raised')));
  });

  it('keeps the working dot visible at the dimmest frame of its pulse', () => {
    // `.dot.pulse` fades to `--pulse-min`, so the trough — not the fill — is what a glance at a
    // working session actually gets. Parity with dark again: the opacity floor is a D1 token.
    const trough = (scheme: Scheme, surface: string): number => {
      const alpha = Number.parseFloat(token(scheme, 'pulse-min'));
      const backdrop = token(scheme, surface);
      return contrast(faded(token(scheme, 'status-working'), backdrop, alpha), backdrop);
    };
    for (const surface of [...SURFACES]) {
      expect(trough(light, surface), `pulse trough on --${surface}`).toBeGreaterThanOrEqual(
        trough(dark, surface),
      );
    }
  });
});

describe('both schemes contrast to target', () => {
  it('holds --text-faint at 3:1 or better on --bg-active, in both schemes', () => {
    for (const [name, scheme] of [
      ['dark', dark],
      ['light', light],
    ] as const) {
      const ratio = contrast(token(scheme, 'text-faint'), token(scheme, 'bg-active'));
      expect(ratio, `${name} --text-faint on --bg-active`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the faded .muted body text at 4.5:1 or better on every surface, in both schemes', () => {
    // A muted row can also be selected (`--bg-active`), so all four surfaces are in play, not
    // just the two page backgrounds — that selected+muted combination is exactly where the
    // pre-fix 0.6 opacity fell short (4.09:1) even though the page-surface cases alone looked
    // fine.
    for (const [name, scheme] of [
      ['dark', dark],
      ['light', light],
    ] as const) {
      const alpha = Number.parseFloat(token(scheme, 'muted-opacity'));
      for (const surface of SURFACES) {
        const backdrop = token(scheme, surface);
        const ratio = contrast(faded(token(scheme, 'text'), backdrop, alpha), backdrop);
        expect(ratio, `${name} .muted text on --${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('light scheme distinguishability (OKLab)', () => {
  it('separates the eight statuses at least as well as the dark scheme does', () => {
    const darkWorst = worstPair(palette(dark, STATUSES));
    const lightWorst = worstPair(palette(light, STATUSES));
    expect(
      lightWorst.gap,
      `light's closest status pair is ${lightWorst.pair} at ${lightWorst.gap.toFixed(4)}, ` +
        `dark's is ${darkWorst.pair} at ${darkWorst.gap.toFixed(4)}`,
    ).toBeGreaterThanOrEqual(darkWorst.gap);
  });

  it('separates the four bands at least as well as the dark scheme does', () => {
    const darkWorst = worstPair(palette(dark, BANDS));
    const lightWorst = worstPair(palette(light, BANDS));
    expect(
      lightWorst.gap,
      `light's closest band pair is ${lightWorst.pair} at ${lightWorst.gap.toFixed(4)}, ` +
        `dark's is ${darkWorst.pair} at ${darkWorst.gap.toFixed(4)}`,
    ).toBeGreaterThanOrEqual(darkWorst.gap);
  });

  it('reads as four escalating band steps, not two plus two', () => {
    // Every neighbour along green → yellow → red → critical must be a real step, measured
    // against the same dark-scheme worst pair, so the ramp cannot degenerate into two clumps.
    const floor = worstPair(palette(dark, BANDS)).gap;
    for (let i = 1; i < BANDS.length; i += 1) {
      const previous = BANDS[i - 1] ?? '';
      const current = BANDS[i] ?? '';
      expect(
        distance(token(light, previous), token(light, current)),
        `--${previous} → --${current}`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });
});
