import type { TranscriptTailFacts } from './types.ts';

/** The session's label: `/rename` beats the generated title, which beats the newest prompt. */
export function sessionTitleOf(
  facts: Pick<TranscriptTailFacts, 'customTitle' | 'aiTitle' | 'lastPromptText'>,
): string | null {
  return facts.customTitle ?? facts.aiTitle ?? facts.lastPromptText ?? null;
}
