/**
 * Typed access to the preload bridge. The renderer has no other way to reach the outside
 * world (§3).
 */

import type { AppState, RendererApi } from '../shared/ipc.ts';

export type MainTab = 'sessions' | 'history' | 'settings';

export interface FullApi extends RendererApi {
  onNavigate(listener: (tab: MainTab) => void): () => void;
  setPopoverHeight(height: number): Promise<void>;
  getPopoverPinned(): Promise<boolean>;
  /** Returns the pin state that was actually applied. */
  setPopoverPinned(pinned: boolean): Promise<boolean>;
}

declare global {
  interface Window {
    claudeControl: FullApi;
  }
}

export const api: FullApi = window.claudeControl;

export const EMPTY_STATE: AppState = {
  sessions: [],
  traySessions: [],
  groups: [],
  trayState: 'none',
  attention: 0,
  projects: [],
  at: 0,
  indexingHistory: false,
  historyCount: 0,
};
