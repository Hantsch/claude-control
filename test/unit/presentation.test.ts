/**
 * Presentation helpers shared by the tray, the toasts and the renderer (D3 of story 002:
 * `modelDisplayName()` — see `src/shared/presentation.ts` for the transformation spec).
 */

import { describe, expect, it } from 'vitest';
import { modelDisplayName } from '../../src/shared/presentation.ts';
import { formatAge } from '../../src/renderer/lib/format.ts';

describe('modelDisplayName', () => {
  it('title-cases a bracketed suffix id and upper-cases the suffix', () => {
    expect(modelDisplayName('claude-opus-5[1m]')).toBe('Opus 5 · 1M');
  });

  it('title-cases a multi-hyphen id with no suffix', () => {
    expect(modelDisplayName('claude-sonnet-4-5')).toBe('Sonnet 4 5');
  });

  it('strips a vendor/region prefix up to the last dot', () => {
    expect(modelDisplayName('us.anthropic.claude-opus-5')).toBe('Opus 5');
  });

  it('returns an unknown shape unchanged', () => {
    expect(modelDisplayName('gpt-4o')).toBe('gpt-4o');
  });

  it('returns null for null input', () => {
    expect(modelDisplayName(null)).toBeNull();
  });

  it('returns null for a blank string', () => {
    expect(modelDisplayName('')).toBeNull();
    expect(modelDisplayName('   ')).toBeNull();
  });

  it('title-cases a bare id with no suffix and no dots', () => {
    expect(modelDisplayName('claude-opus-5')).toBe('Opus 5');
  });

  it('handles multiple hyphens after digits, e.g. a dated snapshot id', () => {
    expect(modelDisplayName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4 5 20250929');
  });

  it('never throws on undefined', () => {
    expect(() => modelDisplayName(undefined)).not.toThrow();
    expect(modelDisplayName(undefined)).toBeNull();
  });

  it('returns the original string unchanged when the vendor-stripped id has no claude- prefix', () => {
    expect(modelDisplayName('us.anthropic.something-else')).toBe('us.anthropic.something-else');
  });
});

describe('formatAge', () => {
  it('returns "just now" just under the 5s boundary (4999ms)', () => {
    expect(formatAge(4999)).toBe('just now');
  });

  it('switches to normal "Ns ago" formatting at the 5s boundary (5000ms)', () => {
    expect(formatAge(5000)).toBe('5s ago');
  });
});
