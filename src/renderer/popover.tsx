/**
 * The tray popover (§8) — the fast path, no window management:
 *
 *   Claude Control · 4 sessions                                    📌  ✕
 *   ● Icons nacharbeiten     claude-control · main      done       3m ago   ▓▓▓▓░
 *   ◐ G0 freigegeben        Hantsch-MMO · feature/x    working    now      ▓▓░░░
 *   ◑ AI scrum sprint 02    ai-diary · main            needs you? 1m ago   ▓░░░░
 *   ○ Repo-Audit            claude · main              stale      42m ago  ▓▓▓░░
 *   ─────────────────────────────────────────────────────────────────
 *   Open Claude Control                    Settings      Quit
 *
 * Rows come from `traySessions`, not `sessions`: this is the glance surface, so it shows what
 * is in flight, what you have not acknowledged, and what you touched recently — not every
 * live session (§6.5). The main window is the complete list.
 *
 * One click on a row focuses that session's window (F6). The title bar is a drag region, so
 * the window can be moved; pinned it survives losing focus and keeps that position.
 */

import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState } from '../shared/ipc.ts';
import { STATUS_HINT, STATUS_LABEL, sessionLabel } from '../shared/presentation.ts';
import { EMPTY_STATE, api } from './api.ts';
import { ContextBar } from './components/ContextBar.tsx';
import { StatusDot } from './components/StatusDot.tsx';
import { formatAge } from './lib/format.ts';
import './styles.css';

function Popover(): React.JSX.Element {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [pinned, setPinned] = useState(false);
  const [, setClock] = useState(0);
  const head = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.getState().then(setState);
    void api.getPopoverPinned().then(setPinned);
    const off = api.onStateChanged(setState);
    const timer = setInterval(() => setClock((value) => value + 1), 5_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

  /**
   * The popover sizes itself to its content, so main can resize the window to match.
   *
   * Measured on the *content*, never on the shell: the shell is stretched to the window, so
   * measuring it reports the window's own height back to main — a feedback loop in which any
   * rounding accumulates, which is what made the popover shrink a little on every open.
   */
  const report = useCallback(() => {
    const height =
      (head.current?.offsetHeight ?? 0) +
      (rows.current?.offsetHeight ?? 0) +
      (foot.current?.offsetHeight ?? 0) +
      2; // the 1 px border on both sides of `.popover`
    void api.setPopoverHeight(height);
  }, []);

  useLayoutEffect(() => {
    report();
    const element = rows.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [report]);

  const togglePin = (): void => {
    void api.setPopoverPinned(!pinned).then(setPinned);
  };

  const shown = state.traySessions;
  const hidden = state.sessions.length - shown.length;

  return (
    <div className="popover">
      <div className="popover-head" ref={head}>
        <span className="title">Claude Control</span>
        <span
          className="count"
          title={
            hidden > 0
              ? `${hidden} more live session${hidden === 1 ? '' : 's'} — settled and already seen. Open Claude Control to see all of them.`
              : undefined
          }
        >
          {shown.length === 1 ? '1 session' : `${shown.length} sessions`}
          {hidden > 0 ? ` · ${hidden} settled` : ''}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className={`icon-button${pinned ? ' on' : ''}`}
          title={pinned ? 'Unpin — close on focus loss again' : 'Pin — keep this window open'}
          aria-pressed={pinned}
          onClick={togglePin}
        >
          <PinIcon filled={pinned} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Close"
          onClick={() => void api.closePopover()}
        >
          ✕
        </button>
      </div>

      <div className="popover-list">
        <div className="popover-rows" ref={rows}>
          {shown.length === 0 && (
            <div className="empty">
              {state.sessions.length === 0 ? 'No live sessions' : 'Nothing needs you right now'}
            </div>
          )}
          {shown.map((session) => (
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
              <span
                className="status"
                title={`${STATUS_LABEL[session.status]} — ${STATUS_HINT[session.status]}`}
              >
                {STATUS_LABEL[session.status]}
              </span>
              <span className="age">
                {formatAge(session.lastActivityAt ? Date.now() - session.lastActivityAt : null)}
              </span>
              <ContextBar context={session.context} />
            </button>
          ))}
        </div>
      </div>

      <div className="popover-footer" ref={foot}>
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

/** Drawn rather than an emoji, so it inherits the text colour and stays crisp at any DPI. */
function PinIcon({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M5.5 1.5h5M6.5 1.5v4.5L4.5 8.5h7L9.5 6V1.5M8 8.5v6"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <Popover />
  </StrictMode>,
);
