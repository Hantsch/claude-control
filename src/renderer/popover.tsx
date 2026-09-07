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
import {
  dismissibleCount,
  groupSessions,
  isDismissible,
  popoverGroupRank,
} from '../core/state/aggregate.ts';
import type { NotificationMode } from '../core/model/settings.ts';
import { applyNotificationMode, notificationMode } from '../core/model/settings.ts';
import type { AppSettings, AppState, SubagentNode } from '../shared/ipc.ts';
import {
  BAND_COLOR_VAR,
  STATUS_HINT,
  STATUS_LABEL,
  SUBAGENT_STATUS_COLOR_VAR,
  modelDisplayName,
  sessionLabel,
} from '../shared/presentation.ts';
import { EMPTY_STATE, api } from './api.ts';
import { ContextBar } from './components/ContextBar.tsx';
import { StatusDot } from './components/StatusDot.tsx';
import { StatusRollup } from './components/StatusRollup.tsx';
import { formatAge, formatDuration } from './lib/format.ts';
import { shouldFocusTopRow } from './lib/popoverFocus.ts';
import {
  SUBAGENT_FLAT_LIST_NOTE,
  subagentMessage,
  subagentSummary,
} from './lib/popoverModel.ts';
import { buildMetricParts, type MetricPart } from './lib/subagentParts.ts';
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
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    // Anywhere else *inside the popover* closes it. Nothing here leaves the renderer, so no
    // `blur` is raised and the popover itself stays open (the acceptance criterion for D11).
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (button.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    // Capture phase: capture always precedes bubble, so this fires before `Popover`'s
    // `document`-level bubble-phase listener — otherwise that listener (which bubbles from
    // target through `document` before reaching `window`) would close the whole popover
    // before `preventDefault()` below ever got a chance to run.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
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

/**
 * One subagent row inside an expanded session's detail block (story 010 D5). Mirrors the
 * prototype's `agentRow()` — status dot, label, `agentType` pill, then the numbers.
 *
 * The row is laid out on the *session row's own skeleton* — the same `.l1` grid
 * and the same `.l2` prose line — so a subagent's context bar, model chip and time land in
 * exactly the columns its parent uses, instead of drifting wherever a flex row happened to
 * put them. The one deliberate offset is the status dot: it sits in the session row's index
 * column (one cell right of the parent's dot), which is the nesting cue, and leaves the
 * label aligned under the branch. Line 2 carries the run's prose (report / error / the
 * absent-data note) with the duration right-aligned where the session's age sits.
 *
 * `model` and the context chip stay directly on the row (the popover is narrow, so a tooltip
 * would hide exactly the two facts a glance needs); `totalTokens`, `toolUses` and
 * lines-touched move into the duration's tooltip instead, still worded as
 * `buildMetricParts` produces them, so the pairing the acceptance criteria forbid — a bare
 * `184.3K tok` sitting next to `ctx 18%` with nothing to say which is which — cannot happen
 * here: the two live in different places on the row.
 *
 * The three absent-data cases (running/launched with no metrics yet, a failed run's error
 * text, and the flat-hierarchy note) are decided by `subagentMessage()` in `popoverModel.ts`
 * (story 010 D6) — this component only renders what that pure function returns, so the
 * wording and the case selection have unit coverage without a DOM.
 *
 * The model chip and the report's second line are story 011 D4: `node.model` stands in for
 * `buildMetricParts`'s old `model` part (that function no longer produces one at all) so a
 * declared-but-not-yet-run alias can show too, and `node.finalText` is rendered as the row's
 * own prose (line 2 since the re-alignment above). Both the chip's provenance title and the report's title are copied verbatim from
 * `SubagentTree.tsx`'s `Metrics()` / report line so the popover and the main window cannot
 * describe the same run differently.
 *
 * A failed run keeps `errorText` visible (unchanged since story 010) *and* still shows the
 * model chip / report line when `node.model` / `node.finalText` happen to be non-null (e.g. a
 * model that had already resolved, or a report that had already arrived, before the run died)
 * — the story requires the new fields to coexist with `errorText`, never be displaced by it,
 * matching `SubagentTree.tsx`, which never gated these on status either.
 */
function SubagentRow({ node }: { node: SubagentNode }): React.JSX.Element {
  const metricParts = node.metrics ? buildMetricParts(node.metrics) : [];
  const ctxPart = metricParts.find((part) => part.key === 'ctx');
  const tooltipParts = metricParts.filter((part) => part.key !== 'ctx');
  const modelPart: MetricPart | null = node.model
    ? {
        key: 'model',
        text: modelDisplayName(node.model) ?? node.model,
        // `node.metrics.model` is `result.model` specifically (see subagents.ts's `toNode`) —
        // `node.metrics` alone is not enough, since a finished result can carry numbers
        // (tokens, tool uses) without a resolved model, which would still leave `node.model`
        // sourced from the declared alias.
        title: node.metrics?.model != null
          ? 'Model the run actually resolved to'
          : 'Declared in the Agent call, not yet confirmed by the run',
      }
    : null;
  const durationTitle =
    tooltipParts.length > 0
      ? tooltipParts.map((part) => `${part.text} — ${part.title}`).join(' · ')
      : undefined;
  const context = node.metrics?.context ?? null;
  // The popover re-renders on a 5 s clock, so `Date.now()` here ages the line by itself.
  const message = subagentMessage(node.status, node.metrics, node.errorText, {
    lastActivityAt: node.lastActivityAt,
    now: Date.now(),
  });

  return (
    <div
      className="popover-subagent-row"
      role="listitem"
      tabIndex={0}
      data-nav-key={`a:${node.id}`}
    >
      {/* Line 1 — identity and numbers, on the session row's grid. Cells are placed by CSS
          (`grid-column`), not by source order: a run with no context or no model yet renders
          nothing for that cell, and auto-placement would slide every later cell left. */}
      <span className="l1">
        <span
          className="dot sm"
          style={{ background: `var(${SUBAGENT_STATUS_COLOR_VAR[node.status]})` }}
          title={node.status}
        />
        <span className="label" title={node.label}>
          {node.label}
        </span>
        {context && ctxPart && (
          // Same markup and classes as the session row's `ContextBar`, so the bar starts on
          // the same pixel — but with `buildMetricParts`'s subagent wording in the tooltip,
          // which says "when the run finished" where a live session says "right now".
          <span className="ctx" title={ctxPart.title}>
            <span className="ctx-bar">
              <span
                className="ctx-fill"
                style={{
                  width: `${Math.min(100, Math.round(context.ratio * 100))}%`,
                  background: `var(${BAND_COLOR_VAR[context.band]})`,
                }}
              />
            </span>
            <span className="ctx-value">{ctxPart.text}</span>
          </span>
        )}
        {modelPart && (
          <span className="model" title={modelPart.title}>
            {modelPart.text}
          </span>
        )}
      </span>
      {/* Line 2 — the prose, indented to the same 42px as the session row's, with the
          duration right-aligned where that row puts its uptime/age. The `agentType` pill leads
          the line — the session row's line 2 opens with what kind of work is running too, and
          off line 1 the label gets the whole column its parent spends on the branch. The
          subagent's own final
          report (story 011 D1/D4) lives here — never the parent session's `lastAssistantText`.
          It is absent while running/launched (D1 leaves `finalText` `null` until the result
          arrives), which is exactly when `subagentMessage()`'s `absent` case fills the line
          instead; an error keeps its own span so a failed run that had already reported can
          show both. */}
      <span className="l2">
        {node.agentType && <span className="type">{node.agentType}</span>}
        {message.kind === 'error' && (
          <span className="error" title={message.text ?? undefined}>
            {message.text}
          </span>
        )}
        {message.kind === 'absent' && <span className="faint">{message.text}</span>}
        {node.finalText && (
          <span className="txt" title="What the subagent reported back, clipped">
            {node.finalText}
          </span>
        )}
        <span className="spacer" />
        <span className="duration" title={durationTitle}>
          {formatDuration(node.durationMs)}
        </span>
      </span>
    </div>
  );
}

/**
 * A session row's right-click menu — the way *one* row gets out of the popover. Clearing the
 * whole list is the footer's "Mark all as seen" button, not a second item in here.
 *
 * In the flow of the list, directly under its row, rather than an absolutely positioned
 * overlay: the popover window is only as tall as `report()` measures head + rows + footer to
 * be, so an overhanging menu would simply be clipped at the window edge. Growing the list
 * instead lets the ResizeObserver resize the window to match — the same constraint
 * `NotifySwitch` lives under, and the same reason neither uses a native `Menu.popup` (a
 * second OS-level focus target would close the unpinned popover underneath it).
 */
function RowMenu({
  dismissible,
  onMarkSeen,
  onClose,
}: {
  /** False while the session is in flight — dismissing it would be a no-op (`isDismissible`). */
  dismissible: boolean;
  onMarkSeen: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null);

  // Anywhere else inside the popover closes the menu. Capture phase, like `NotifySwitch`'s:
  // nothing here leaves the renderer, so no `blur` fires and the popover itself stays open.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (menu.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', onPointerDown, true);
    return () => window.removeEventListener('mousedown', onPointerDown, true);
  }, [onClose]);

  // Focus the first usable item on open, so the keyboard route in (Shift+F10 or the menu key
  // on a focused row, both of which fire `contextmenu`) works without reaching for the mouse.
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // `preventDefault` matters: the popover's document-level handler skips prevented events,
      // so Escape closes the menu without also closing the whole popover.
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    items[Math.min(Math.max(index + delta, 0), items.length - 1)]?.focus();
  };

  return (
    <div
      className="popover-row-menu"
      role="menu"
      ref={menu}
      onKeyDown={onKeyDown}
      // The menu sits inside the row's click area in the DOM flow; a click on it must not also
      // be read as "jump to this session".
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!dismissible}
        title={
          dismissible
            ? 'Take this session out of the popover and the tray menu until it does something new'
            : 'Still in flight — it would come straight back, so there is nothing to dismiss'
        }
        onClick={onMarkSeen}
      >
        Mark as seen
      </button>
    </div>
  );
}

/**
 * Every keyboard-reachable node in the list carries a `data-nav-key` (story 010: `g:<projectKey>`
 * for a group head, `s:<sessionId>` for a session row, `a:<nodeId>` for a subagent row), so one
 * selector spans all three kinds and navigation is a flat list in DOM order.
 */
const NAV_SELECTOR = '[data-nav-key]';

/** The selector for one specific node. Keys carry a project key or a session id, so they are
 * escaped rather than interpolated into the attribute selector raw. */
function navSelector(key: string): string {
  return `[data-nav-key="${CSS.escape(key)}"]`;
}

/**
 * Expansion state is two `Set`s of keys, and D7 needs to drive them in three ways: `toggle` (a
 * click, or Enter on a group head) and the directional `on` / `off` the arrow keys want — → must
 * expand and ← must collapse, never flip, or holding → would close what it just opened.
 * Returns the set unchanged when nothing moves, so a → on an already-open node costs no render.
 */
type SetChange = 'on' | 'off' | 'toggle';

function changedSet(current: Set<string>, key: string, change: SetChange): Set<string> {
  const has = current.has(key);
  const want = change === 'toggle' ? !has : change === 'on';
  if (has === want) return current;
  const next = new Set(current);
  if (want) next.add(key);
  else next.delete(key);
  return next;
}

function Popover(): React.JSX.Element {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [pinned, setPinned] = useState(false);
  const [, setClock] = useState(0);
  // Which project groups are collapsed, by `project.key` — default is none, i.e. all groups
  // expanded (story 010 Decisions (Sprint): "default state is groups expanded, sessions
  // collapsed"). Sessions themselves default-collapse per-row, which is D4's concern. Like
  // `openNodes` below, this resets to empty whenever the popover window is hidden, so a group
  // the user collapsed during a session comes back expanded on reopen.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  // Which session (and, later, subagent) detail blocks are open, keyed `s:<sessionId>` /
  // `a:<nodeId>` (story 010 D4). Default is empty — every session starts collapsed — and the
  // set resets to empty whenever the popover window is hidden (Decisions (Sprint): "Expansion
  // state does not survive hide"), not on `blur`, so a pinned-but-unfocused popover keeps what
  // was expanded. `collapsedGroups` above gets the same reset.
  const [openNodes, setOpenNodes] = useState<Set<string>>(() => new Set());
  // Why the last jump did not land, or null. A jump that fails used to be *completely*
  // silent: main hid the popover and the renderer dropped the `FocusResult` on the floor, so
  // "no window could be resolved" and "focused the right window" looked identical from the
  // outside. Main now keeps the popover open on failure precisely so this can say what
  // happened; the message is the focuser's own, never a rephrasing of it.
  const [jumpError, setJumpError] = useState<string | null>(null);
  // Which session row has its right-click menu open, by `s:<sessionId>` nav key, or null.
  // Only ever one — opening a second menu closes the first, like a native context menu.
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const head = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);

  // The two toggles live here rather than in the render closures so the `document`-level keydown
  // handler below can call the *same* function the click handlers call. Both are stable and use
  // functional updates, so the handler needs no dependency on the current sets and never acts on
  // a stale one. Note the asymmetry the keys already carry: `collapsedGroups` holds bare project
  // keys and means *collapsed*, `openNodes` holds prefixed node keys and means *open*.
  const changeGroupCollapsed = useCallback((projectKey: string, change: SetChange): void => {
    setCollapsedGroups((current) => changedSet(current, projectKey, change));
  }, []);
  const changeNodeOpen = useCallback((nodeKey: string, change: SetChange): void => {
    setOpenNodes((current) => changedSet(current, nodeKey, change));
  }, []);

  /**
   * Jump to a session's window (F6). The single entry point for the row click and the row's
   * Enter/Space, so the mouse and the keyboard cannot report a failure differently. A flash
   * counts as landed — Windows refused the foreground but the taskbar button is telling the
   * user where to look, which the popover would only obscure by staying open.
   */
  const jumpToSession = useCallback((sessionId: string): void => {
    setJumpError(null);
    void api.focusSession(sessionId).then((result) => {
      setJumpError(result.ok || result.flashed ? null : result.message);
    });
  }, []);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.hidden) {
        setOpenNodes(new Set());
        setCollapsedGroups(new Set());
        setJumpError(null);
        setMenuKey(null);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

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

  // Which nav node (by `data-nav-key`, so any of the three kinds) currently holds keyboard
  // focus — tracked explicitly rather than inferred from `document.activeElement`, since the
  // popover window is reused (hidden/shown, never recreated) and the previous session's focused
  // element can still be `document.activeElement` on reopen. `null` means focus sits outside the
  // list entirely (Pin, Close, the notify switch, the footer), which is what keeps the two
  // effects below from yanking it back in.
  const focusedNavKey = useRef<string | null>(null);

  // One `focusin` listener instead of an `onFocus` on each of the three node kinds: it bubbles,
  // so a nested chevron / mute toggle resolves to its owning node via `.closest()`, and focus
  // moving to a non-node target clears the ref in the same place.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target as HTMLElement | null;
      const node = target?.closest<HTMLElement>(NAV_SELECTOR) ?? null;
      focusedNavKey.current =
        node && rows.current?.contains(node) ? (node.dataset.navKey ?? null) : null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // Whether a row has been successfully focused since the popover was last "opened" (i.e. since
  // the last real `window` `'focus'` event). Lets the `[state]` effect below keep retrying the
  // initial focus across the very first popover open of an app run, where the window is already
  // OS-focused (so no `'focus'` event fires again) and the mount-time `focusTopRow()` call finds
  // zero rows because `state` is still `EMPTY_STATE` while `api.getState()` resolves.
  const focusedYet = useRef(false);

  // Focuses the most urgent row. Sessions are already sorted by urgency within and across
  // groups, so the first `s:`-prefixed node in DOM order is the most urgent session — but group
  // heads (`data-nav-key="g:..."`) render before their sessions, so a bare `NAV_SELECTOR` query
  // would land on the first group head instead whenever ≥2 projects are live. Scoping the query
  // to session rows keeps this story 003's "opening the popover focuses the most urgent row"
  // acceptance criterion intact regardless of group-head presence. Unconditional: the window is
  // reused rather than recreated, so `document.activeElement` can still point at a row from the
  // previous session — a "focus already inside the list" guard would then skip refocusing on
  // reopen, breaking that acceptance criterion for every open after the first.
  const focusTopRow = useCallback(() => {
    const container = rows.current;
    if (!container) return;
    // Nodes are `div[role="button"]` with a `data-nav-key` (a nested mute-toggle `<button>`
    // ruled out a real `<button>` for the row itself); scope to session rows only (see above).
    const row = container.querySelector<HTMLElement>('[data-nav-key^="s:"]');
    if (!row) return;
    row.focus();
    focusedYet.current = true;
  }, []);

  /**
   * "Mark as seen" (the row's right-click menu). The row is about to unmount together with the
   * menu button that holds the focus, which would strand it on `document.body` — so re-arm the
   * initial-focus retry below and let the next engine snapshot put the focus back on the most
   * urgent remaining row.
   */
  const markSeen = useCallback((sessionId: string): void => {
    setMenuKey(null);
    focusedYet.current = false;
    void api.dismiss(sessionId);
  }, []);

  /**
   * "Mark all as seen" (the footer button). Same re-arming, but here it usually changes
   * nothing: the button itself keeps the focus and `shouldFocusTopRow` refuses to pull focus
   * out of the footer. It matters only when the button disables itself out from under the
   * focus, which is exactly when landing on the top row is the right answer.
   */
  const markAllSeen = useCallback((): void => {
    setMenuKey(null);
    focusedYet.current = false;
    void api.dismissAll();
  }, []);

  const closeMenu = useCallback((): void => setMenuKey(null), []);

  // Initial focus, and again every time the (reused, shown/hidden rather than recreated)
  // popover window regains OS focus — that is how "opening the popover focuses the most
  // urgent row" is detected, since there is no extra IPC event for it. Resetting `focusedYet`
  // here (rather than only inside `focusTopRow`) marks the start of a new "not yet focused this
  // session" window, which the `[state]` effect below uses to retry once real rows show up.
  useEffect(() => {
    const onFocus = () => {
      focusedYet.current = false;
      focusTopRow();
    };
    focusedYet.current = false;
    focusTopRow();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [focusTopRow]);

  // If nothing has been focused yet this session, retry now that `state` may finally hold real
  // rows (covers the first-open race described above). Otherwise, fall back to the previous
  // behavior: if the node that had keyboard focus is gone from the new snapshot, focus the first
  // (most urgent) node again instead of leaving focus stranded on `document.body`. The check is
  // now "is the remembered node still in the DOM" rather than "is that sessionId still in
  // `traySessions`", because since D7 the focused node can also be a group head or a subagent
  // row — for a session row the two are equivalent. Driven by `focusedNavKey` rather than "is
  // focus anywhere in the container" — otherwise this would yank focus back into the row list on
  // every new engine snapshot even when the user deliberately focused Pin, Close, or the
  // notify-switch button instead.
  useEffect(() => {
    if (!focusedYet.current) {
      // Story 012 D6: the retry is allowed while focus is nowhere meaningful (body) or already
      // inside the list, but must not steal it off Pin / Close / the notify switch — with zero
      // sessions open, the first arriving session used to yank focus onto its row. The decision
      // itself lives in `popoverFocus.ts`, where it is testable without a DOM.
      const active = document.activeElement;
      const activeElementIsBody =
        active == null || active === document.body || active === document.documentElement;
      const activeElementIsInList = active != null && rows.current?.contains(active) === true;
      const allowed = shouldFocusTopRow({
        focusedYet: focusedYet.current,
        activeElementIsBody,
        activeElementIsInList,
      });
      if (allowed) focusTopRow();
      return;
    }
    const key = focusedNavKey.current;
    if (key && !rows.current?.querySelector(navSelector(key))) focusTopRow();
  }, [state, focusTopRow]);

  // Arrow-key row navigation and Escape-to-close, for the life of the component. Registered on
  // `document` (not conditionally, unlike `NotifySwitch`'s menu-only listener) so it works
  // whenever the popover has focus. Respects `event.defaultPrevented` so `NotifySwitch`'s own
  // Escape handling (which closes its menu, not the popover) is not double-handled here.
  useEffect(() => {
    // The nav node that owns the focus, if any. `document.activeElement` may be the node itself
    // or a descendant of it (story 004's `mute-toggle`, D4's chevron), so `.closest()` resolves
    // either case to the owning node; the containment check keeps anything outside the list
    // (Pin, Close, the notify switch, the footer) from counting as a node.
    const focusedNode = (): HTMLElement | null => {
      const node =
        (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(NAV_SELECTOR) ?? null;
      return node && rows.current?.contains(node) ? node : null;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = rows.current?.querySelectorAll<HTMLElement>(NAV_SELECTOR);
        if (!items || items.length === 0) return;
        const list = Array.from(items);
        // One flat list in DOM order across all three node kinds (group head, session row,
        // subagent row). `indexOf` staying -1 clamps to the top node when focus is elsewhere
        // entirely, exactly as before.
        const active = focusedNode();
        const currentIndex = active ? list.indexOf(active) : -1;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = Math.min(Math.max(currentIndex + delta, 0), list.length - 1);
        list[nextIndex]?.focus();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        // → expands the focused node, ← collapses it, dispatched by the key's prefix. Both call
        // the very functions the click handlers call, so a keyboard toggle cannot drift from a
        // mouse one. A subagent row falls through untouched — it has nothing to expand, and the
        // story wants that as a plain no-op, so `preventDefault()` is deliberately not reached.
        const key = focusedNode()?.dataset.navKey;
        const expand = event.key === 'ArrowRight';
        if (key?.startsWith('g:')) {
          event.preventDefault();
          // Inverted on purpose: the set holds *collapsed* groups, so expanding removes the key.
          changeGroupCollapsed(key.slice(2), expand ? 'off' : 'on');
        } else if (key?.startsWith('s:')) {
          event.preventDefault();
          changeNodeOpen(key, expand ? 'on' : 'off');
        }
      } else if (event.key === 'Escape') {
        void api.closePopover();
      }
      // Enter needs nothing here: the group head activates its own Enter/Space (D3) and the
      // session row its own (story 003's jump-to-session), both via `preventDefault()`, which
      // the guard at the top of this handler then respects — while a subagent row has no key
      // handler at all, which *is* the required no-op ("a subagent has no window to focus").
      // Handling Enter again here would be unreachable for two kinds and a duplicate for none.
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [changeGroupCollapsed, changeNodeOpen]);

  // Focus survives an expand or collapse (AC: "the node that was focused is still focused
  // afterwards, never the document body"). A toggle re-renders the list, and while React
  // normally reconciles the focused element in place, anything that makes it drop the node
  // instead — a changed key, a wrapper appearing — drops the focus with it, silently, to
  // `document.body`. So after every expand/collapse render the remembered node is refocused if
  // it lost focus, and scrolled into view either way.
  //
  // Deliberately scoped to the two expansion states rather than *every* render: the 5 s clock
  // and each engine snapshot re-render too, and scrolling the focused node back into view every
  // few seconds would fight a user who has scrolled the list by hand.
  useLayoutEffect(() => {
    const key = focusedNavKey.current;
    if (!key) return;
    // Only while the popover really holds the OS focus — a pinned-but-unfocused window, or the
    // hidden one whose `visibilitychange` reset just re-rendered it, must not pull focus.
    if (!document.hasFocus()) return;
    const node = rows.current?.querySelector<HTMLElement>(navSelector(key));
    if (!node) return;
    // `contains` covers the node itself as well as its chevron / mute toggle: when focus is on
    // one of those, moving it up to the row would break repeated Enter on the same button.
    if (!node.contains(document.activeElement)) node.focus();
    node.scrollIntoView({ block: 'nearest' });
  }, [collapsedGroups, openNodes]);

  const togglePin = (): void => {
    void api.setPopoverPinned(!pinned).then(setPinned);
  };

  const shown = state.traySessions;
  const hidden = state.sessions.length - shown.length;
  // What "Mark all as seen" would actually remove — everything settled, i.e. not in flight.
  const dismissible = dismissibleCount(shown);
  const waitingCount = shown.filter((session) => session.status === 'waiting').length;

  // Rows are already sorted by urgency within a group (`compareSessions`); groups themselves
  // sort by their most urgent *unacknowledged* session (`popoverGroupRank`), then by project
  // name — so a project whose only waiting row has already been seen sinks below one with
  // real news instead of holding the top spot.
  const groups = groupSessions(shown).sort((a, b) => {
    const rank = popoverGroupRank(a) - popoverGroupRank(b);
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
          {groups.map((group) => {
            const collapsed = collapsedGroups.has(group.project.key);
            // Same function the → / ← handler calls (D7), so click and keyboard cannot drift.
            const toggleGroup = (): void => changeGroupCollapsed(group.project.key, 'toggle');
            return (
            <Fragment key={group.project.key}>
              {groups.length > 1 && (
                <div
                  className="popover-group-head"
                  role="button"
                  tabIndex={0}
                  data-nav-key={`g:${group.project.key}`}
                  onClick={toggleGroup}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleGroup();
                    }
                  }}
                >
                  <span className={`chev${collapsed ? '' : ' open'}`} aria-hidden="true">
                    ▶
                  </span>
                  <span className="name">{group.project.name}</span>
                  {group.attention > 0 && (
                    <span className="attention">
                      {group.attention === 1 ? '1 waiting' : `${group.attention} waiting`}
                    </span>
                  )}
                  <span className="spacer" />
                  <StatusRollup counts={group.statusCounts} />
                  <span className="count">
                    {group.sessions.length === 1 ? '1 session' : `${group.sessions.length} sessions`}
                  </span>
                </div>
              )}
              {!collapsed && group.sessions.map((session, index) => {
                const toggleMuted = (event: React.SyntheticEvent): void => {
                  // The mute toggle is nested inside the row's div-as-button — stop the click
                  // here or it would also fire the row's onClick (focus/jump) right after.
                  event.stopPropagation();
                  void api.setSessionMuted(session.sessionId, !session.muted);
                };
                const waiting = session.status === 'waiting';
                const subagents = subagentSummary(session.subagents);
                const uptime = formatUptime(session.startedAt);
                const nodeKey = `s:${session.sessionId}`;
                const isOpen = openNodes.has(nodeKey);
                const toggleOpen = (event: React.SyntheticEvent): void => {
                  // Same idiom as the mute toggle above: stop the click here so it does not
                  // also fire the row's own onClick (focus/jump to the session's window).
                  event.stopPropagation();
                  // Same function the → / ← handler calls (D7).
                  changeNodeOpen(nodeKey, 'toggle');
                };
                return (
                <Fragment key={session.sessionId}>
                <div
                  role="button"
                  tabIndex={0}
                  className={`popover-row${session.muted ? ' muted' : ''}`}
                  title={session.statusReason}
                  data-nav-key={nodeKey}
                  onClick={() => jumpToSession(session.sessionId)}
                  // Right-click (and the keyboard's Shift+F10 / menu key, which fire the same
                  // event on the focused row) opens the row menu instead of the OS one.
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuKey(nodeKey);
                  }}
                  onKeyDown={(event) => {
                    // Preserve the button-like keyboard behaviour a plain <div role="button">
                    // does not get for free — but only for the row itself: bail out if the
                    // keydown bubbled up from the nested mute-toggle <button> so its own native
                    // Enter/Space activation is not suppressed by this handler.
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      jumpToSession(session.sessionId);
                    }
                  }}
                >
                  {/* Line 1 — identity and numbers: chevron, status glyph, index in the
                      group, branch, context, model, mute toggle. */}
                  <span className="l1">
                    {/* D4: clicking the chevron toggles the detail block below, without also
                        firing the row's own jump-on-click (stopPropagation, same idiom as the
                        mute toggle). Focus stays on this button across the re-render since
                        React reconciles it in place rather than remounting it. */}
                    <button
                      type="button"
                      className={`chev${isOpen ? ' open' : ''}`}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                      onClick={toggleOpen}
                    >
                      ▶
                    </button>
                    <StatusDot status={session.status} />
                    <span className="idx">{index + 1}</span>
                    {/* Identity, in the order you ask about it: *which run is this* first,
                        then where it runs. The branch alone cannot tell two sessions on the
                        same branch apart — a routine case (two agents on one sprint branch) —
                        so the name leads and the branch trails it, quieter. */}
                    <span className="ident">
                      <span className="name" title={sessionLabel(session)}>
                        {sessionLabel(session)}
                      </span>
                      <span className="branch" title={session.branch ?? session.project.name}>
                        {session.branch ? session.branch : session.project.name}
                      </span>
                    </span>
                    <ContextBar context={session.context} valueFormat="tokens" />
                    <span className="model" title={session.model ?? undefined}>
                      {modelDisplayName(session.model)}
                    </span>
                    <button
                      type="button"
                      className={`mute-toggle${session.muted ? ' on' : ''}`}
                      onClick={toggleMuted}
                      onDoubleClick={(event) => event.stopPropagation()}
                      title={session.muted ? 'Unmute this session' : 'Mute this session'}
                      aria-pressed={session.muted}
                    >
                      {session.muted ? '🔇' : '🔔'}
                    </button>
                    {session.windowUnknown && (
                      <span
                        className="window-unknown-badge"
                        title="Window state couldn't be determined, so this session is shown to be safe"
                      >
                        ❓
                      </span>
                    )}
                  </span>
                  {/* Line 2 — the prose: status or, for a waiting session, the *whole*
                      reason. This is what the second line is for: the 8-column grid of story
                      002 cut that string off after four words. */}
                  <span className="l2">
                    <StatusDot status={session.status} size="sm" />
                    <span
                      className="txt"
                      title={
                        session.pendingTool?.hint ??
                        `${STATUS_LABEL[session.status]} — ${STATUS_HINT[session.status]}`
                      }
                      style={waiting ? { color: 'var(--status-waiting)' } : undefined}
                    >
                      {waiting ? (
                        session.statusReason
                      ) : (
                        <Fragment>
                          {STATUS_LABEL[session.status]}
                          {session.pendingTool && ` · ${session.pendingTool.name}`}
                        </Fragment>
                      )}
                    </span>
                    {subagents && (
                      <span className="sub" title={subagents.title}>
                        {subagents.pipClasses.map((pip, pipIndex) => (
                          <span
                            // Pips are positional and interchangeable — the index *is* the
                            // identity here, there is nothing else to key on.
                            key={pipIndex}
                            className={`pip${pip ? ` ${pip}` : ''}`}
                          />
                        ))}
                        <span className="cnt">
                          {subagents.done}/{subagents.total}
                        </span>
                      </span>
                    )}
                    <span className="spacer" />
                    <span className="age" title={uptimeTitle(session.startedAt)}>
                      {uptime ? `${uptime} · ` : ''}
                      {formatAge(
                        session.lastActivityAt ? Date.now() - session.lastActivityAt : null,
                      )}
                    </span>
                  </span>
                </div>
                {menuKey === nodeKey && (
                  <RowMenu
                    dismissible={isDismissible(session)}
                    onMarkSeen={() => markSeen(session.sessionId)}
                    onClose={closeMenu}
                  />
                )}
                {isOpen && (
                  // Detail block (D4): title + last-said, then the subagent area. Mirrors the
                  // prototype's `.detail` / `.kv` structure — see sessionRow() in
                  // docs/requirements/assets/010-popover-drilldown-prototype.html.
                  <div className="popover-detail">
                    <div className="kv">
                      <span className="title">{sessionLabel(session)}</span>
                      <span className="txt">
                        {session.lastAssistantText || 'nothing said yet'}
                      </span>
                    </div>
                    {session.subagents.length === 0 ? (
                      <div className="kv faint">no subagents</div>
                    ) : (
                      <>
                        <div className="popover-subagents" role="list">
                          {session.subagents.map((node) => (
                            <SubagentRow key={node.id} node={node} />
                          ))}
                        </div>
                        {/* The flat-list disclaimer belongs to the whole list, not any one
                            row (story 010 D6) — `buildSubagentTree` sets `children: []`
                            unconditionally, so a subagent that spawned its own would not be
                            recognisable as a parent here. Sibling of `.popover-subagents`
                            (story 013 D6) so role="list" only ever contains SubagentRows. */}
                        <div className="flat-note">{SUBAGENT_FLAT_LIST_NOTE}</div>
                      </>
                    )}
                  </div>
                )}
                </Fragment>
                );
              })}
            </Fragment>
            );
          })}
        </div>
      </div>

      {/* `foot` measures everything below the list, so the failure strip lives inside it —
          otherwise the height reported to main would not include it and the window would
          clip its own footer. */}
      <div ref={foot}>
        {jumpError && (
          <div className="popover-jump-error" role="status">
            {jumpError}
          </div>
        )}
        <div className="popover-footer">
          <button type="button" onClick={() => void api.openMainWindow('sessions')}>
            Open Claude Control
          </button>
          <span className="spacer" />
          {/* Left of Settings: the way out when a pile of finished sessions has built up,
              without right-clicking each row. Disabled rather than hidden when there is
              nothing settled to clear, so the footer's buttons never jump sideways. */}
          <button
            type="button"
            disabled={dismissible === 0}
            title={
              dismissible === 0
                ? 'Nothing settled to clear — everything here is still in flight'
                : 'Take every settled session out of this list and the tray menu. Anything still running stays, and a new turn brings a session back.'
            }
            onClick={markAllSeen}
          >
            Mark all as seen{dismissible > 0 ? ` (${dismissible})` : ''}
          </button>
          <button type="button" onClick={() => void api.openMainWindow('settings')}>
            Settings
          </button>
          <button type="button" onClick={() => void api.quit()}>
            Quit
          </button>
        </div>
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
