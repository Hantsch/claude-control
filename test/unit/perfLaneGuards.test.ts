import { describe, expect, it } from 'vitest';
import { assertColdStartPremise, budgetMessage } from '../fixtures/engine.ts';

const clipped = `${'x'.repeat(110)}…`;
const session = (finalText: string | null) => ({ status: 'live', subagents: [{ finalText }] });
const usage = [{ usage: { inputTokens: 5 } }];

describe('perf lane guards', () => {
  it('a budget overrun names the measured time and the budget', () => {
    let message = '';
    try {
      expect(2053, budgetMessage('N5', 2053)).toBeLessThanOrEqual(2000);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('measured 2053 ms');
    expect(message).toContain('budget 2000 ms');
  });

  it('the cold-start premise rejects a wrong session count', () => {
    expect(() => assertColdStartPremise({ sessions: [session(clipped)] }, usage, 1)).not.toThrow();
    expect(() => assertColdStartPremise({ sessions: [session(clipped)] }, usage, 6)).toThrow();
  });

  it('the cold-start premise rejects an unclipped final text', () => {
    const unclipped = 'x'.repeat(110);
    expect(() => assertColdStartPremise({ sessions: [session(unclipped)] }, usage, 1)).toThrow();
  });

  it('the cold-start premise rejects a wrong ended count', () => {
    const ended = { status: 'ended', subagents: [{ finalText: clipped }] };
    expect(() => assertColdStartPremise({ sessions: [session(clipped), session(clipped)] }, usage, 2)).toThrow();
    expect(() => assertColdStartPremise({ sessions: [session(clipped), ended] }, usage, 2)).not.toThrow();
  });
});
