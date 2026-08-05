/**
 * Context pressure (§6.4, F9).
 *
 *   used ≈ input_tokens + cache_read_input_tokens + cache_creation_input_tokens
 *
 * The denominator is the problem: `message.model` reports `claude-opus-5` *without* the
 * `[1m]` suffix that marks the 1M-context variant (RESEARCH.md §2), so the window is not
 * directly knowable. v1 resolves that with a lookup table (conservative 200 000 default)
 * plus **auto-widening**: if observed usage ever exceeds the assumed window for a session,
 * that session is reclassified to the 1M tier rather than pinned at a nonsensical 400 %.
 *
 * Every value produced here is an estimate and is labelled as one in the UI.
 */

import type { ContextBand, ContextPressure, SessionId, UsageTotals } from '../model/types.ts';

/** Conservative default when the model is unknown or not in the table. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** The wider tier a session is promoted to by auto-widening. */
export const WIDE_CONTEXT_WINDOW = 1_000_000;

/**
 * model → context window. Keys are matched case-insensitively against `message.model`,
 * first by exact match, then by longest prefix, so unseen point releases still resolve.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-5': 200_000,
  'claude-sonnet-5': 200_000,
  'claude-fable-5': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-opus-4-8': 200_000,
  'claude-opus-4-7': 200_000,
  'claude-sonnet-4-5': 200_000,
  // An explicit 1M variant, should the suffix ever appear in the transcript.
  'claude-opus-5[1m]': WIDE_CONTEXT_WINDOW,
  'claude-sonnet-5[1m]': WIDE_CONTEXT_WINDOW,
};

/** Thresholds from §6.4: 🟢 <60 % · 🟡 60–80 % · 🔴 80–92 % · ⚠️ >92 %. */
export function bandFor(ratio: number): ContextBand {
  if (ratio < 0.6) return 'green';
  if (ratio < 0.8) return 'yellow';
  if (ratio <= 0.92) return 'red';
  return 'critical';
}

export function usedTokens(usage: UsageTotals): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function windowForModel(model: string | null): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  const key = model.toLowerCase();
  const exact = MODEL_CONTEXT_WINDOWS[key];
  if (exact) return exact;
  let best = 0;
  let bestWindow = DEFAULT_CONTEXT_WINDOW;
  for (const [candidate, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (key.startsWith(candidate) && candidate.length > best) {
      best = candidate.length;
      bestWindow = window;
    }
  }
  return bestWindow;
}

/**
 * Tracks per-session auto-widening. Sticky: once a session is known to exceed the assumed
 * window it stays on the wider tier, because usage drops back after a compaction and the
 * session would otherwise flip between tiers.
 */
export class ContextWindowEstimator {
  private readonly widened = new Set<SessionId>();

  estimate(sessionId: SessionId, model: string | null, usage: UsageTotals | null): ContextPressure | null {
    if (!usage) return null;
    const used = usedTokens(usage);
    let window = windowForModel(model);

    if (this.widened.has(sessionId)) {
      window = Math.max(window, WIDE_CONTEXT_WINDOW);
    } else if (used > window) {
      // Observed usage exceeds the assumption → this session runs the wider tier (§6.4).
      this.widened.add(sessionId);
      window = Math.max(window, WIDE_CONTEXT_WINDOW);
    }

    const ratio = window > 0 ? used / window : 0;
    return {
      used,
      window,
      ratio,
      band: bandFor(ratio),
      widened: this.widened.has(sessionId),
      model,
    };
  }

  forget(sessionId: SessionId): void {
    this.widened.delete(sessionId);
  }

  isWidened(sessionId: SessionId): boolean {
    return this.widened.has(sessionId);
  }
}
