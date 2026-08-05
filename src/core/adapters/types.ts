/**
 * The adapter boundary (§9, N7).
 *
 * Everything agent-specific — path layout, slug encoding, JSONL record types,
 * `stop_reason` semantics, usage fields — lives behind this interface. v1 ships exactly
 * one implementation (`adapters/claude`). There is no plugin discovery: adding an agent
 * means adding a class and registering it.
 */

import type {
  HistoryEntry,
  IdeWindowRef,
  LiveSessionRef,
  SessionDetail,
  SessionId,
  SessionSnapshot,
} from '../model/types.ts';

export type WatchRootKind = 'registry' | 'transcripts' | 'ide';

export interface WatchRoot {
  kind: WatchRootKind;
  path: string;
  /** Directory depth to watch below `path`. */
  depth: number;
}

export interface AgentAdapter {
  /** Stable id, e.g. `"claude-code"`. */
  readonly id: string;

  /** Live sessions according to the agent's own registry, PID-verified. */
  discoverLiveSessions(): Promise<LiveSessionRef[]>;

  /** Directories to watch for change events (§5.3). */
  watchRoots(): WatchRoot[];

  /** Tail-read one session and return normalized facts (§5.2). */
  readStatus(ref: LiveSessionRef): Promise<SessionSnapshot>;

  /** Cheap, cancellable background walk over past transcripts (§5.1). */
  indexHistory(signal: AbortSignal): AsyncIterable<HistoryEntry>;

  /** Index a single transcript, e.g. right after its session ended. */
  readHistoryEntry(transcriptPath: string): Promise<HistoryEntry | null>;

  /** Full parse of a single transcript, on user request only (§5.1). */
  readDetail(id: SessionId, transcriptPath?: string | null): Promise<SessionDetail>;

  /** Window mapping for "jump to session" (§7). Empty array if unsupported. */
  listIdeWindows(): Promise<IdeWindowRef[]>;

  /**
   * Optional: release whatever the adapter cached for a session that has ended. Adapters
   * that keep no per-session state can leave it out.
   */
  forgetSession?(id: SessionId): void;
}
