/**
 * Pure model→context-window table built from LiteLLM's
 * `model_prices_and_context_window.json` payload (story 005, D2).
 *
 * This module does no IO of its own — callers fetch/read the raw JSON and hand it to
 * `parseModelWindows`, which extracts only `max_input_tokens` per model and ignores every
 * price field. `lookupWindow` then mirrors `windowForModel`'s matching semantics
 * (`src/core/state/contextPressure.ts`): case-insensitive exact match first, then
 * longest-prefix match — with an extra step that also matches table keys with a stripped
 * `provider/` prefix, since LiteLLM's keys are namespaced (e.g. `anthropic/claude-opus-5`)
 * while `message.model` typically is not.
 */

/** model → context window, keyed exactly as found in the source payload. */
export type ModelWindowTable = Record<string, number>;

/**
 * Extracts `{ model: max_input_tokens }` from a raw LiteLLM payload. Entries missing
 * `max_input_tokens`, or where it isn't a positive finite number, are skipped. All other
 * fields (pricing, provider metadata, etc.) are ignored entirely.
 */
export function parseModelWindows(payload: Record<string, unknown>): ModelWindowTable {
  const table: ModelWindowTable = {};
  for (const [model, value] of Object.entries(payload)) {
    if (!value || typeof value !== 'object') continue;
    const maxInputTokens = (value as Record<string, unknown>).max_input_tokens;
    if (typeof maxInputTokens !== 'number' || !Number.isFinite(maxInputTokens) || maxInputTokens <= 0) continue;
    table[model] = maxInputTokens;
  }
  return table;
}

/** Strips a single leading `provider/` segment, if present. */
function stripProviderPrefix(key: string): string {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(slash + 1);
}

/**
 * Looks up `model`'s context window in `table`. Case-insensitive. Tries, in order:
 *   1. exact match against table keys as-is
 *   2. exact match against table keys with a `provider/` prefix stripped
 *   3. longest-prefix match, considered against both the raw and prefix-stripped keys
 * Returns `null` when nothing matches.
 */
export function lookupWindow(table: ModelWindowTable, model: string | null): number | null {
  if (!model) return null;
  const key = model.toLowerCase();

  let exact: number | undefined;
  let bestLength = 0;
  let bestWindow: number | null = null;

  for (const [candidate, window] of Object.entries(table)) {
    const rawCandidate = candidate.toLowerCase();
    const strippedCandidate = stripProviderPrefix(rawCandidate);

    if (rawCandidate === key || strippedCandidate === key) {
      exact = window;
      continue;
    }

    if (key.startsWith(rawCandidate) && rawCandidate.length > bestLength) {
      bestLength = rawCandidate.length;
      bestWindow = window;
    }
    if (key.startsWith(strippedCandidate) && strippedCandidate.length > bestLength) {
      bestLength = strippedCandidate.length;
      bestWindow = window;
    }
  }

  if (exact !== undefined) return exact;
  return bestWindow;
}
