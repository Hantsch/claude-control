/**
 * Pure CLI formatting helper, kept in its own module (no side effects) so it can be
 * imported by tests without pulling in `index.ts`'s `main().catch(...)` invocation.
 *
 * Threshold matches `formatAge` in `src/renderer/lib/format.ts` (Acceptance Criterion:
 * ages under 5s read "just now" on every surface). The CLI keeps its own compact
 * suffix-less shape (`3h` vs the renderer's `3h ago`) since it prints fixed-width table
 * columns, so the implementations stay separate rather than sharing one function.
 */
export function formatAge(ms: number): string {
  if (ms < 5_000) return 'just now';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
