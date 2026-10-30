/**
 * Collapse to one line and truncate to `max` characters, ending in `…` when clipped.
 *
 * The single convention for row-sized text taken out of a transcript: `toolInputHint` has
 * always used it and `finalTextOf` reuses it, so a hint and a subagent report cannot end up
 * clipped by two slightly different rules.
 */
export function clipOneLine(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 3)}…` : oneLine;
}
