/**
 * Settings (§8): thresholds (`T_work` and the per-tool overrides that double as speed
 * classes), how long settled sessions stay in the tray, notification toggles
 * and the Claude data directory path.
 */

import { useEffect, useState } from 'react';
import type {
  AppSettings,
  DiagnosticsInfo,
  ModelWindowStatus,
  ShortcutStatus,
} from '../../shared/ipc.ts';
import { acceleratorFromChord, formatAccelerator } from '../../shared/accelerator.ts';
import { api } from '../api.ts';

/** Renders the age of a fetched table for the checkbox's inline result and the diagnostics line. */
function formatAgeMs(ageMs: number | null): string {
  if (ageMs === null) return 'just now';
  const days = Math.floor(ageMs / 86_400_000);
  if (days >= 1) return `${days} d`;
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours >= 1) return `${hours} h`;
  const minutes = Math.max(1, Math.floor(ageMs / 60_000));
  return `${minutes} min`;
}

/** The Diagnostics state line for the opt-in exact-context-window table (story 005, D7). */
function formatModelWindowsLine(status: ModelWindowStatus): string {
  if (!status.enabled) return 'off — no network requests';
  const parts: string[] = [
    'on',
    `${status.entryCount} model${status.entryCount === 1 ? '' : 's'}`,
    status.fetchedAt === null ? 'never fetched' : `fetched ${formatAgeMs(status.ageMs)} ago`,
  ];
  parts.push(`last refresh ${status.lastOutcome === 'never' ? 'pending' : status.lastOutcome}`);
  return parts.join(' · ');
}

export function SettingsView(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus | null>(null);
  const [saved, setSaved] = useState(false);
  const [modelWindowsPending, setModelWindowsPending] = useState(false);
  const [modelWindowsResult, setModelWindowsResult] = useState<string | null>(null);
  /**
   * The data directory is committed on blur or Enter, not on every keystroke: changing it
   * tears down and rebuilds the file watchers, so saving per character would restart them
   * once per typed letter.
   */
  const [claudeDirDraft, setClaudeDirDraft] = useState<string | null>(null);

  useEffect(() => {
    void api.getSettings().then(setSettings);
    void api.diagnostics().then(setDiagnostics);
    return api.onSettingsChanged(setSettings);
  }, []);

  useEffect(() => {
    void api.getShortcutStatus().then(setShortcutStatus);
    return api.onShortcutStatusChanged(setShortcutStatus);
  }, []);

  if (!settings) return <div className="empty">Loading settings…</div>;

  const apply = async (next: AppSettings): Promise<void> => {
    setSettings(next);
    await api.setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const toggleOnlineTable = (checked: boolean): void => {
    void apply({
      ...settings,
      contextWindows: { ...settings.contextWindows, useOnlineTable: checked },
    });
    setModelWindowsResult(null);
    if (!checked) {
      // No fetch happens with the setting off (D3/D6), but the Diagnostics line still needs to
      // flip to "off — no network requests" right away rather than keep showing the stale
      // "on · …" text until something else happens to re-fetch diagnostics. `enabled: false` is
      // the only field `formatModelWindowsLine` looks at in that case, so flipping it locally
      // (instead of round-tripping through `api.diagnostics()`, which could race the `apply`
      // call above) is enough to mirror the ON path's re-fetch-and-update behavior.
      setDiagnostics((prev) =>
        prev && prev.modelWindows ? { ...prev, modelWindows: { ...prev.modelWindows, enabled: false } } : prev,
      );
      return;
    }
    setModelWindowsPending(true);
    void api
      .refreshModelWindows()
      .then((status) => {
        setModelWindowsPending(false);
        setDiagnostics((prev) => (prev ? { ...prev, modelWindows: status } : prev));
        if (!status) {
          setModelWindowsResult('Refresh did not run.');
        } else if (status.lastOutcome === 'ok') {
          setModelWindowsResult(`Fetched ${status.entryCount} models.`);
        } else {
          setModelWindowsResult(status.lastError ? `Refresh failed: ${status.lastError}` : 'Refresh failed.');
        }
      })
      .catch((error: unknown) => {
        setModelWindowsPending(false);
        setModelWindowsResult(error instanceof Error ? `Refresh failed: ${error.message}` : 'Refresh failed.');
      });
  };

  const setSeconds = (key: 'tWorkMs', seconds: number): void => {
    void apply({
      ...settings,
      thresholds: { ...settings.thresholds, [key]: Math.max(1, seconds) * 1000 },
    });
  };

  return (
    <div className="settings">
      <div className="section-title">Status thresholds</div>
      <div className="field">
        <span>T_work (default)</span>
        <span>
          <input
            type="number"
            min={1}
            value={Math.round(settings.thresholds.tWorkMs / 1000)}
            onChange={(event) => setSeconds('tWorkMs', Number(event.target.value))}
          />{' '}
          s
        </span>
        <span className="hint">
          How long an unpaired tool call may run before it counts as overdue. This is also the
          line between the two speed classes: a tool budgeted above it is “slow by nature”, so
          an overdue one reads as “stale” instead of “needs you?”. Default: 25 s.
        </span>
      </div>

      <div className="section-title">Per-tool T_work overrides</div>
      <div className="tool-grid">
        {Object.entries(settings.thresholds.perToolWorkMs)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tool, ms]) => (
            <label key={tool}>
              {tool}
              <span>
                <input
                  type="number"
                  min={1}
                  value={Math.round(ms / 1000)}
                  onChange={(event) =>
                    void apply({
                      ...settings,
                      thresholds: {
                        ...settings.thresholds,
                        perToolWorkMs: {
                          ...settings.thresholds.perToolWorkMs,
                          [tool]: Math.max(1, Number(event.target.value)) * 1000,
                        },
                      },
                    })
                  }
                />{' '}
                s
              </span>
            </label>
          ))}
      </div>
      <div className="hint">
        Slow tools need a longer budget, otherwise a long `npm install` looks like a
        permission prompt. Fast tools should stay short so real prompts surface quickly.
      </div>

      <div className="section-title">Session list</div>
      <div className="field">
        <span>Hide unused sessions</span>
        <input
          type="checkbox"
          checked={settings.list.hideUnusedSessions}
          onChange={(event) =>
            void apply({
              ...settings,
              list: { ...settings.list, hideUnusedSessions: event.target.checked },
            })
          }
        />
        <span className="hint">
          A Claude Code window registers itself before anything happens in it. With this on,
          such a session (“no prompt yet”) stays out of the list, the popover and the tray
          until its first message.
        </span>
      </div>
      <div className="field">
        <span>Hide abandoned sessions</span>
        <input
          type="checkbox"
          checked={settings.list.hideOrphanSessions}
          onChange={(event) =>
            void apply({
              ...settings,
              list: { ...settings.list, hideOrphanSessions: event.target.checked },
            })
          }
        />
        <span className="hint">
          A session whose terminal window is gone while a windowed twin still runs in the same
          folder is likely an abandoned process. With this on, such orphaned sessions stay out
          of the list, the popover and the tray.
        </span>
      </div>
      <div className="field">
        <span>Keep settled sessions in the tray for</span>
        <span>
          <input
            type="number"
            min={1}
            value={Math.round(settings.list.trayRecentMs / 60000)}
            onChange={(event) =>
              void apply({
                ...settings,
                list: {
                  ...settings.list,
                  trayRecentMs: Math.max(1, Number(event.target.value)) * 60000,
                },
              })
            }
          />{' '}
          min
        </span>
        <span className="hint">
          The popover and the tray menu always show what is running and anything you have not
          acknowledged yet, at any age. This only decides how long a finished, already-seen
          session stays listed there. The main window keeps showing every live session.
          Default: 30 min.
        </span>
      </div>

      <div className="section-title">Notifications</div>
      <div className="field">
        <span>Enabled</span>
        <input
          type="checkbox"
          checked={settings.notifications.enabled}
          onChange={(event) =>
            void apply({
              ...settings,
              notifications: { ...settings.notifications, enabled: event.target.checked },
            })
          }
        />
      </div>
      <div className="field">
        <span>Toast when done</span>
        <input
          type="checkbox"
          checked={settings.notifications.onDone}
          onChange={(event) =>
            void apply({
              ...settings,
              notifications: { ...settings.notifications, onDone: event.target.checked },
            })
          }
        />
      </div>
      <div className="field">
        <span>Toast when a session may need you</span>
        <input
          type="checkbox"
          checked={settings.notifications.onWaiting}
          onChange={(event) =>
            void apply({
              ...settings,
              notifications: { ...settings.notifications, onWaiting: event.target.checked },
            })
          }
        />
      </div>
      <div className="field">
        <span>Per-session cooldown</span>
        <span>
          <input
            type="number"
            min={0}
            value={Math.round(settings.notifications.cooldownMs / 1000)}
            onChange={(event) =>
              void apply({
                ...settings,
                notifications: {
                  ...settings.notifications,
                  cooldownMs: Math.max(0, Number(event.target.value)) * 1000,
                },
              })
            }
          />{' '}
          s
        </span>
      </div>

      <div className="section-title">Reading</div>
      <div className="field">
        <span>Claude data directory</span>
        <input
          type="text"
          value={claudeDirDraft ?? settings.claudeDir ?? ''}
          placeholder={diagnostics?.claudeDir ?? '~/.claude'}
          onChange={(event) => setClaudeDirDraft(event.target.value)}
          onBlur={() => {
            if (claudeDirDraft === null) return;
            const next = claudeDirDraft.trim() || null;
            setClaudeDirDraft(null);
            if (next !== settings.claudeDir) void apply({ ...settings, claudeDir: next });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setClaudeDirDraft(null);
          }}
        />
        <span className="hint">
          Empty uses the default location. Applied on Enter or when the field loses focus,
          because changing it restarts the watchers.
        </span>
      </div>
      <div className="field">
        <span>Event debounce</span>
        <span>
          <input
            type="number"
            min={0}
            value={settings.reading.debounceMs}
            onChange={(event) =>
              void apply({
                ...settings,
                reading: { ...settings.reading, debounceMs: Math.max(0, Number(event.target.value)) },
              })
            }
          />{' '}
          ms
        </span>
        <span className="hint">Trailing debounce per file. Default 250 ms (§5.3).</span>
      </div>
      <div className="field">
        <span>Liveness tick</span>
        <span>
          <input
            type="number"
            min={1}
            value={Math.round(settings.reading.tickIntervalMs / 1000)}
            onChange={(event) =>
              void apply({
                ...settings,
                reading: {
                  ...settings.reading,
                  tickIntervalMs: Math.max(1, Number(event.target.value)) * 1000,
                },
              })
            }
          />{' '}
          s
        </span>
      </div>
      <div className="field">
        <span>Index history on start</span>
        <input
          type="checkbox"
          checked={settings.indexHistoryOnStart}
          onChange={(event) => void apply({ ...settings, indexHistoryOnStart: event.target.checked })}
        />
      </div>
      <div className="field">
        <span>Start with Windows</span>
        <input
          type="checkbox"
          checked={settings.ui.autostart}
          onChange={(event) =>
            void apply({ ...settings, ui: { ...settings.ui, autostart: event.target.checked } })
          }
        />
        <span className="hint">
          The entry points at where the EXE is now; if you move it, it is repaired the next time
          the app starts.
        </span>
      </div>
      <div className="field">
        <span>Global shortcut</span>
        <span>
          <button
            type="button"
            onKeyDown={(event) => {
              if (event.key === 'Tab') return;
              const result = acceleratorFromChord({
                key: event.key,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
              });
              event.preventDefault();
              if (result !== null) {
                void apply({ ...settings, ui: { ...settings.ui, globalShortcut: result } });
              }
            }}
          >
            {formatAccelerator(settings.ui.globalShortcut)}
          </button>{' '}
          <button
            type="button"
            onClick={() =>
              void apply({ ...settings, ui: { ...settings.ui, globalShortcut: 'Ctrl+Alt+C' } })
            }
          >
            Reset
          </button>{' '}
          <button
            type="button"
            onClick={() => void apply({ ...settings, ui: { ...settings.ui, globalShortcut: '' } })}
          >
            Off
          </button>
        </span>
        <span className="hint">
          Click the combination and press the keys you want to use, e.g. Ctrl+Alt+C. Toggles the
          popover from anywhere.
        </span>
        {shortcutStatus && !shortcutStatus.registered && (
          <span className="hint warning">
            {formatAccelerator(shortcutStatus.accelerator)} is already taken by another
            application — pick a different combination.
          </span>
        )}
      </div>

      <div className="section-title">Context windows</div>
      <div className="field">
        <span>Fetch exact context windows online</span>
        <input
          type="checkbox"
          checked={settings.contextWindows.useOnlineTable}
          onChange={(event) => toggleOnlineTable(event.target.checked)}
        />
        <span className="hint">
          Downloads LiteLLM&rsquo;s model&rarr;context-window table from a JSON file on GitHub, at
          most once a week and checked periodically in the background. This is the only network
          request Claude Control ever makes; off by default, and the gauge keeps using
          today&rsquo;s estimated window without it.
        </span>
        {modelWindowsPending && <span className="hint">Checking…</span>}
        {!modelWindowsPending && modelWindowsResult && <span className="hint">{modelWindowsResult}</span>}
      </div>

      <div className="row-actions">
        <button type="button" onClick={() => void api.resetSettings().then(setSettings)}>
          Reset to defaults
        </button>
        <button type="button" onClick={() => void api.refresh()}>
          Refresh now
        </button>
      </div>
      {saved && <div className="notice">Saved.</div>}

      {diagnostics && (
        <>
          <div className="section-title">Diagnostics</div>
          <dl className="kv">
            <dt>Data directory</dt>
            <dd className="mono">{diagnostics.claudeDir}</dd>
            <dt>Adapter</dt>
            <dd>{diagnostics.adapterId}</dd>
            <dt>Focus backend</dt>
            <dd>{diagnostics.focusBackend}</dd>
            <dt>Toast button target</dt>
            {diagnostics.protocolTarget.state === 'registered' && (
              <dd className="mono">{diagnostics.protocolTarget.path}</dd>
            )}
            {diagnostics.protocolTarget.state === 'failed' && (
              <dd className="warning">not registered — toast buttons will not work</dd>
            )}
            {diagnostics.protocolTarget.state === 'unsupported' && <dd>n/a — Windows only</dd>}
            <dt>Exact context windows</dt>
            <dd
              className={
                diagnostics.modelWindows?.enabled && diagnostics.modelWindows.lastOutcome === 'failed'
                  ? 'warning'
                  : undefined
              }
            >
              {diagnostics.modelWindows ? formatModelWindowsLine(diagnostics.modelWindows) : 'off — no network requests'}
            </dd>
            <dt>Version</dt>
            <dd>
              {diagnostics.appVersion} · Electron {diagnostics.electronVersion} · {diagnostics.platform}
            </dd>
          </dl>
          <div className="estimate">
            Claude Control is read-only: it never writes to Claude Code&rsquo;s data, never sends
            input to a session. It has no listening socket, sends no telemetry, and by default
            sends nothing over the network &mdash; the exact-context-window lookup above is the
            only exception, making exactly one outbound request while it is turned on.
          </div>
        </>
      )}
    </div>
  );
}
