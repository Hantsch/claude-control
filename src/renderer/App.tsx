/**
 * Main window shell: Sessions / History / Settings (§8).
 *
 * The renderer is a pure view — it holds selection and filter state and nothing else. Every
 * derived value arrives over IPC already finished.
 */

import { useEffect, useState } from 'react';
import type { AppState, SessionView } from '../shared/ipc.ts';
import { EMPTY_STATE, api, type MainTab } from './api.ts';
import { HistoryView } from './components/HistoryView.tsx';
import { SessionDetailPane } from './components/SessionDetailPane.tsx';
import { SessionsView } from './components/SessionsView.tsx';
import { SettingsView } from './components/SettingsView.tsx';

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [tab, setTab] = useState<MainTab>(initialTab());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  // Re-render on a slow beat so relative times ("3m ago") stay honest between events.
  const [, setClock] = useState(0);

  useEffect(() => {
    void api.getState().then(setState);
    const offState = api.onStateChanged(setState);
    const offNavigate = api.onNavigate(setTab);
    const timer = setInterval(() => setClock((value) => value + 1), 5_000);
    return () => {
      offState();
      offNavigate();
      clearInterval(timer);
    };
  }, []);

  // Fall back to the most urgent session so the detail pane is useful without a click; the
  // list is already sorted by urgency (§6.5 order).
  const selected =
    state.sessions.find((session) => session.sessionId === selectedId) ?? state.sessions[0] ?? null;

  const activate = (session: SessionView): void => {
    void api.focusSession(session.sessionId);
  };

  // Selecting a row puts the session in the detail pane, which is exactly the moment the
  // user has looked at it — so that is what clears it from the tray badge (§6.5).
  const select = (session: SessionView): void => {
    setSelectedId(session.sessionId);
    if (!session.seen) void api.acknowledge(session.sessionId);
  };

  return (
    <div className="app">
      <div className="tabs">
        {(['sessions', 'history', 'settings'] as const).map((name) => (
          <button
            key={name}
            type="button"
            className={tab === name ? 'active' : ''}
            onClick={() => setTab(name)}
          >
            {name === 'sessions' ? `Sessions (${state.sessions.length})` : name[0]!.toUpperCase() + name.slice(1)}
          </button>
        ))}
        <span className="spacer" />
        {tab === 'sessions' && state.projects.length > 1 && (
          <select
            value={projectFilter ?? ''}
            onChange={(event) => setProjectFilter(event.target.value || null)}
          >
            <option value="">all projects</option>
            {state.projects.map((project) => (
              <option key={project.key} value={project.key}>
                {project.name}
              </option>
            ))}
          </select>
        )}
        <span className="meta">
          {state.attention > 0 ? `${state.attention} need attention · ` : ''}
          {state.indexingHistory ? 'indexing history…' : `${state.historyCount} in history`}
        </span>
        {state.attention > 0 && (
          <button
            type="button"
            title="Clear the tray badge for every session that is currently done or waiting, and take the settled ones out of the tray popover. A new status change brings them back."
            onClick={() => void api.dismissAll()}
          >
            Mark all as seen
          </button>
        )}
        <button type="button" onClick={() => void api.refresh()}>
          Refresh
        </button>
      </div>

      <div className="body">
        {tab === 'sessions' && (
          <>
            <div className="pane list">
              <SessionsView
                state={state}
                selectedId={selected?.sessionId ?? null}
                projectFilter={projectFilter}
                onSelect={select}
                onActivate={activate}
              />
            </div>
            <div className="pane detail">
              <SessionDetailPane session={selected} />
            </div>
          </>
        )}
        {tab === 'history' && (
          <div className="pane list" style={{ borderRight: 'none' }}>
            <HistoryView state={state} />
          </div>
        )}
        {tab === 'settings' && (
          <div className="pane list" style={{ borderRight: 'none' }}>
            <SettingsView />
          </div>
        )}
      </div>
    </div>
  );
}

function initialTab(): MainTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab === 'history' || tab === 'settings' ? tab : 'sessions';
}
