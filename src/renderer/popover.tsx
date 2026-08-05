/**
 * The tray popover (§8) — the fast path, no window management:
 *
 *   ● Icons nacharbeiten     claude-control · main      done      3m ago
 *   ◐ G0 freigegeben        Hantsch-MMO · feature/x    working   now
 *   ◑ AI scrum sprint 02    ai-diary · main            waiting?  1m ago
 *   ○ claude-a0             claude · main              idle      42m ago
 *   ───────────────────────────────────────────────────────────
 *   Open Claude Control                    Settings      Quit
 *
 * One click on a row focuses that session's window (F6).
 */

import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState } from '../shared/ipc.ts';
import { STATUS_LABEL, sessionLabel } from '../shared/presentation.ts';
import { EMPTY_STATE, api } from './api.ts';
import { StatusDot } from './components/StatusDot.tsx';
import { formatAge } from './lib/format.ts';
import './styles.css';

function Popover(): React.JSX.Element {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [, setClock] = useState(0);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.getState().then(setState);
    const off = api.onStateChanged(setState);
    const timer = setInterval(() => setClock((value) => value + 1), 5_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

  // The popover sizes itself to its content, so main can resize the window to match.
  useLayoutEffect(() => {
    const height = (shell.current?.scrollHeight ?? 240) + 2;
    void api.setPopoverHeight(height);
  }, [state.sessions.length]);

  return (
    <div className="popover" ref={shell}>
      <div className="popover-list">
        {state.sessions.length === 0 && <div className="empty">No live sessions</div>}
        {state.sessions.map((session) => (
          <button
            key={session.sessionId}
            type="button"
            className="popover-row"
            title={session.statusReason}
            onClick={() => void api.focusSession(session.sessionId)}
          >
            <StatusDot status={session.status} />
            <span className="name" title={sessionLabel(session)}>
              {sessionLabel(session)}
            </span>
            <span className="where">
              {session.project.name}
              {session.branch ? ` · ${session.branch}` : ''}
            </span>
            <span className="status">
              {session.status === 'waiting' ? 'waiting?' : STATUS_LABEL[session.status]}
            </span>
            <span className="age">
              {formatAge(session.lastActivityAt ? Date.now() - session.lastActivityAt : null)}
            </span>
          </button>
        ))}
      </div>
      <div className="popover-footer">
        <button type="button" onClick={() => void api.openMainWindow('sessions')}>
          Open Claude Control
        </button>
        <span className="spacer" />
        <button type="button" onClick={() => void api.openMainWindow('settings')}>
          Settings
        </button>
        <button type="button" onClick={() => void api.quit()}>
          Quit
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <Popover />
  </StrictMode>,
);
