/**
 * Presentation helpers shared by the tray, the toasts and the renderer (D3 of story 002:
 * `modelDisplayName()` — see `src/shared/presentation.ts` for the transformation spec).
 */

import { describe, expect, it } from 'vitest';
import { acceleratorFromChord, formatAccelerator } from '../../src/shared/accelerator.ts';
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

  it('title-cases a declared tier alias instead of falling into the claude- id parsing', () => {
    expect(modelDisplayName('opus')).toBe('Opus');
    expect(modelDisplayName('sonnet')).toBe('Sonnet');
    expect(modelDisplayName('haiku')).toBe('Haiku');
    expect(modelDisplayName('fable')).toBe('Fable');
  });

  it('does not treat an uppercase or partial match as a tier alias', () => {
    expect(modelDisplayName('Opus')).toBe('Opus');
    expect(modelDisplayName('opus-5')).toBe('opus-5');
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

describe('acceleratorFromChord', () => {
  const base = { key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

  it('builds Ctrl+Alt+C from ctrl+alt and a lowercase letter', () => {
    expect(acceleratorFromChord({ ...base, ctrlKey: true, altKey: true, key: 'c' })).toBe(
      'Ctrl+Alt+C',
    );
  });

  it('builds Ctrl+Shift+F1 from ctrl+shift and a function key', () => {
    expect(acceleratorFromChord({ ...base, ctrlKey: true, shiftKey: true, key: 'F1' })).toBe(
      'Ctrl+Shift+F1',
    );
  });

  it('returns null for a plain key with no modifiers', () => {
    expect(acceleratorFromChord({ ...base, key: 'c' })).toBeNull();
  });

  it('returns null for Shift alone (shift does not count as a qualifying modifier)', () => {
    expect(acceleratorFromChord({ ...base, shiftKey: true, key: 'c' })).toBeNull();
  });

  it('returns null when key is itself the held modifier', () => {
    expect(acceleratorFromChord({ ...base, ctrlKey: true, key: 'Control' })).toBeNull();
  });

  it('does not throw on empty/garbage input', () => {
    expect(() => acceleratorFromChord({ ...base, key: '' })).not.toThrow();
    expect(acceleratorFromChord({ ...base, key: '' })).toBeNull();
  });

  it('includes Meta in the fixed modifier order Ctrl, Alt, Shift, Meta', () => {
    expect(
      acceleratorFromChord({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true, key: 'x' }),
    ).toBe('Ctrl+Alt+Shift+Meta+X');
  });
});

describe('formatAccelerator', () => {
  it('shows an empty accelerator as "None"', () => {
    expect(formatAccelerator('')).toBe('None');
  });

  it('returns a non-empty accelerator unchanged', () => {
    expect(formatAccelerator('Ctrl+Alt+C')).toBe('Ctrl+Alt+C');
  });
});
