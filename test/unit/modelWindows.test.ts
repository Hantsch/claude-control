/**
 * Pure model→window table parsing/matching (story 005, D2).
 */

import { describe, expect, it } from 'vitest';
import { lookupWindow, parseModelWindows } from '../../src/core/context/modelWindows.ts';

const fixturePayload = {
  'anthropic/claude-opus-5': {
    max_input_tokens: 200_000,
    max_output_tokens: 32_000,
    input_cost_per_token: 0.000015,
  },
  'claude-sonnet-4-5': {
    max_input_tokens: 200_000,
    input_cost_per_token: 0.000003,
  },
  'anthropic/claude-opus-5[1m]': {
    max_input_tokens: 1_000_000,
  },
  'no-max-input': {
    max_output_tokens: 4096,
    input_cost_per_token: 0.000001,
  },
  'zero-max-input': {
    max_input_tokens: 0,
  },
  'negative-max-input': {
    max_input_tokens: -5,
  },
  'not-an-object': 'oops',
};

describe('parseModelWindows', () => {
  it('extracts only max_input_tokens, ignoring price fields', () => {
    const table = parseModelWindows(fixturePayload);
    expect(table['anthropic/claude-opus-5']).toBe(200_000);
    expect(table['claude-sonnet-4-5']).toBe(200_000);
    expect(table['anthropic/claude-opus-5[1m]']).toBe(1_000_000);
  });

  it('skips entries without a positive numeric max_input_tokens', () => {
    const table = parseModelWindows(fixturePayload);
    expect(table['no-max-input']).toBeUndefined();
    expect(table['zero-max-input']).toBeUndefined();
    expect(table['negative-max-input']).toBeUndefined();
    expect(table['not-an-object']).toBeUndefined();
  });
});

describe('lookupWindow', () => {
  const table = parseModelWindows(fixturePayload);

  it('resolves a provider/-prefixed key via prefix-stripping', () => {
    expect(lookupWindow(table, 'claude-opus-5')).toBe(200_000);
  });

  it('resolves an exact match with no provider prefix', () => {
    expect(lookupWindow(table, 'claude-sonnet-4-5')).toBe(200_000);
  });

  it('is case-insensitive', () => {
    expect(lookupWindow(table, 'Claude-Sonnet-4-5')).toBe(200_000);
  });

  it('falls back to longest-prefix match for unseen point releases', () => {
    expect(lookupWindow(table, 'claude-opus-5-20260101')).toBe(200_000);
    expect(lookupWindow(table, 'claude-opus-5[1m]-20260101')).toBe(1_000_000);
  });

  it('returns null for an unknown model', () => {
    expect(lookupWindow(table, 'gpt-5')).toBeNull();
  });

  it('returns null for a null model', () => {
    expect(lookupWindow(table, null)).toBeNull();
  });
});
