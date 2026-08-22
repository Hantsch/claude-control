/**
 * Pure CLI formatting helper, kept in its own module (no side effects) so it can be
 * imported by tests without pulling in `index.ts`'s `main().catch(...)` invocation.
 *
 * Threshold matches `formatAge` in `src/renderer/lib/format.ts` (Acceptance Criterion:
 * ages under 5s read "just now" on every surface). The CLI keeps its own compact
 * suffix-less shape (`3h` vs the renderer's `3h ago`) since it prints fixed-width table
 * columns, so the implementations stay separate rather than sharing one function.
 */

import type { ContextPressure } from '../core/model/types.ts';

export function formatAge(ms: number): string {
  if (ms < 5_000) return 'just now';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * Provenance marker for the `ctx=` column (story 005 D8): `~` when `window` is only an
 * estimated guess, `=` once the opt-in fetched table resolved this model exactly. A
 * `widened` pressure is always `'estimated'` (D4), so it always reads `~`.
 */
export function contextMarker(windowSource: ContextPressure['windowSource']): '~' | '=' {
  return windowSource === 'exact' ? '=' : '~';
}

/** Full `ctx=` cell text: percentage, the `*` widened flag, then the provenance marker. */
export function formatContextColumn(context: ContextPressure | null): string {
  if (!context) return '—';
  return `${Math.round(context.ratio * 100)}%${context.widened ? '*' : ''}${contextMarker(context.windowSource)}`;
}

/**
 * Whether `createEngine` should be handed a data dir at all. Mirrors the main process's own
 * rule (`createEngine.ts`): a `WindowSource` is only ever constructed when a data dir is
 * given, so leaving this `undefined` while the setting is off is what guarantees the CLI
 * never fetches anything — there is no `WindowSource` instance to do it.
 */
export function engineDataDir(useOnlineTable: boolean, dataDir: string): string | undefined {
  return useOnlineTable ? dataDir : undefined;
}
