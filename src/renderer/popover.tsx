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

import {
  Fragment,
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { STATUS_SORT_RANK, groupSessions } from '../core/state/aggregate.ts';
import type { NotificationMode } from '../core/model/settings.ts';
import { applyNotificationMode, notificationMode } from '../core/model/settings.ts';
import type { AppSettings, AppState } from '../shared/ipc.ts';
import {
  STATUS_HINT,
  STATUS_LABEL,
  modelDisplayName,
  sessionLabel,
} from '../shared/presentation.ts';
import { EMPTY_STATE, api } from './api.ts';
import { ContextBar } from './components/ContextBar.tsx';
import { StatusDot } from './components/StatusDot.tsx';
import { formatAge, formatDuration } from './lib/format.ts';
import './styles.css';

/** Uptime cell (D9) only kicks in once a session has been running a while — below that
 * threshold the `.age` cell already tells the story, so the cell stays empty. */
const UPTIME_THRESHOLD_MS = 3_600_000;

function formatUptime(startedAt: number): string {
  const elapsed = Date.now() - startedAt;
  if (elapsed < UPTIME_THRESHOLD_MS) return '';
  return `↑${formatDuration(elapsed)}`;
}

function uptimeTitle(startedAt: number): string | undefined {
  const elapsed = Date.now() - startedAt;
  if (elapsed < UPTIME_THRESHOLD_MS) return undefined;
  const hours = Math.floor(elapsed / 3_600_000);
  const minutes = Math.floor((elapsed % 3_600_000) / 60_000);
  const parts = [`${hours} hour${hours === 1 ? '' : 's'}`];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return `Running for ${parts.join(' ')}`;
}

/** The quick-switch's wording: a short word on the button, the full sentence in the menu. */
const NOTIFY_MODES: { mode: NotificationMode; short: string; text: string }[] = [
  { mode: 'off', short: 'off', text: 'No notifications' },
  { mode: 'waiting', short: 'waiting', text: 'When a session needs me' },
  { mode: 'done', short: 'done', text: 'When a session is done' },
  { mode: 'all', short: 'all', text: 'Both' },
];

/**
 * Notification quick-switch (D11). Deliberately a plain React overlay and not `Menu.popup`:
 * the popover hides on the window's `blur` unless it is pinned, and a native menu is a second
 * OS-level focus target, so opening one would close the window underneath it. Rendered in the
 * flow of `.popover-head` for the same reason an absolute overlay is wrong here — the window
 * is only as tall as `report()` says, so the menu has to grow the head instead of overhanging
 * the window edge, where it would simply be clipped.
 */
function NotifySwitch(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.getSettings().then(setSettings);
    return api.onSettingsChanged(setSettings);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Anywhere else *inside the popover* closes it. Nothing here leaves the renderer, so no
    // `blur` is raised and the popover itself stays open (the acceptance criterion for D11).
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (button.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [open]);

  const current = settings ? notificationMode(settings.notifications) : null;

  const select = (mode: NotificationMode): void => {
    setOpen(false);
    if (!settings) return;
    // Same shape as `SettingsView.apply()`: the store merges and broadcasts
    // `onSettingsChanged`, which is how the open main window's Settings tab follows along.
    const next: AppSettings = {
      ...settings,
      notifications: applyNotificationMode(settings.notifications, mode),
    };
    setSettings(next);
    void api.setSettings(next).catch((error: unknown) => {
      // The optimistic update above already flipped the button to the new mode; if the
      // write itself fails, at least surface it instead of leaving the UI showing a mode
      // that was never persisted.
      console.error('Failed to save notification mode', error);
    });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`notify-button${open ? ' on' : ''}`}
        title="When Claude Control should notify you"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!current}
        onClick={() => setOpen((value) => !value)}
      >
        notify: {NOTIFY_MODES.find((entry) => entry.mode === current)?.short ?? '…'} ▾
      </button>
      {open && current && (
        <div className="notify-menu" role="menu" ref={menu}>
          {NOTIFY_MODES.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              role="menuitemradio"
              aria-checked={entry.mode === current}
              className={`notify-item${entry.mode === current ? ' on' : ''}`}
              onClick={() => select(entry.mode)}
            >
              <span className="mark">{entry.mode === current ? '●' : ''}</span>
              {entry.text}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

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
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    for (const element of [head.current, rows.current, foot.current]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [report]);

  const togglePin = (): void => {
    void api.setPopoverPinned(!pinned).then(setPinned);
  };

  const shown = state.traySessions;
  const hidden = state.sessions.length - shown.length;
  const waitingCount = shown.filter((session) => session.status === 'waiting').length;

  // Rows are already sorted by urgency within a group (`compareSessions`); groups themselves
  // sort by their most urgent session, then by project name.
  const groups = groupSessions(shown).sort((a, b) => {
    // `groupSessions` never produces an empty group, so `sessions[0]` — the most urgent row,
    // per `compareSessions` — always exists.
    const rank = STATUS_SORT_RANK[a.sessions[0]!.status] - STATUS_SORT_RANK[b.sessions[0]!.status];
    if (rank !== 0) return rank;
    return a.project.name.localeCompare(b.project.name);
  });

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
          {waitingCount > 0 ? (
            <span style={{ color: 'var(--status-waiting)' }}> ({waitingCount} waiting)</span>
          ) : null}
          {hidden > 0 ? ` · ${hidden} settled` : ''}
        </span>
        <span className="spacer" />
        <NotifySwitch />
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
          {groups.map((group) => (
            <Fragment key={group.project.key}>
              {groups.length > 1 && (
                <div className="popover-group-head">
                  <span className="name">{group.project.name}</span>
                  <span className="count">
                    {group.sessions.length === 1 ? '1 session' : `${group.sessions.length} sessions`}
                  </span>
                </div>
              )}
              {group.sessions.map((session) => (
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
                  <span
                    className="where"
                    title={session.status === 'waiting' ? session.statusReason : undefined}
                    style={session.status === 'waiting' ? { color: 'var(--status-waiting)' } : undefined}
                  >
                    {session.status === 'waiting'
                      ? session.statusReason
                      : `${session.project.name}${session.branch ? ` · ${session.branch}` : ''}`}
                  </span>
                  <span
                    className="status"
                    title={
                      session.pendingTool?.hint ??
                      `${STATUS_LABEL[session.status]} — ${STATUS_HINT[session.status]}`
                    }
                  >
                    {STATUS_LABEL[session.status]}
                    {session.pendingTool && (
                      <Fragment>
                        {' · '}
                        {session.pendingTool.name}
                        {session.subagents.some((node) => node.status === 'running')
                          ? ' · subagent'
                          : ''}
                      </Fragment>
                    )}
                  </span>
                  <span className="model" title={session.model ?? undefined}>
                    {modelDisplayName(session.model)}
                  </span>
                  <span className="uptime" title={uptimeTitle(session.startedAt)}>
                    {formatUptime(session.startedAt)}
                  </span>
                  <span className="age">
                    {formatAge(
                      session.lastActivityAt ? Date.now() - session.lastActivityAt : null,
                    )}
                  </span>
                  <ContextBar context={session.context} />
                </button>
              ))}
            </Fragment>
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
