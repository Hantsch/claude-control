/**
 * Settings (§8): thresholds (`T_work`, `T_idle`, per-tool overrides), notification toggles
 * and the Claude data directory path.
 */

import { useEffect, useState } from 'react';
import type { AppSettings, DiagnosticsInfo } from '../../shared/ipc.ts';
import { api } from '../api.ts';

export function SettingsView(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [saved, setSaved] = useState(false);
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

  if (!settings) return <div className="empty">Loading settings…</div>;

  const apply = async (next: AppSettings): Promise<void> => {
    setSettings(next);
    await api.setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const setSeconds = (key: 'tWorkMs' | 'tIdleMs', seconds: number): void => {
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
          How long an unpaired tool call may run before the session is called “probably
          waiting”. Concept default: 25 s.
        </span>
      </div>
      <div className="field">
        <span>T_idle</span>
        <span>
          <input
            type="number"
            min={1}
            value={Math.round(settings.thresholds.tIdleMs / 60000)}
            onChange={(event) =>
              void apply({
                ...settings,
                thresholds: {
                  ...settings.thresholds,
                  tIdleMs: Math.max(1, Number(event.target.value)) * 60000,
                },
              })
            }
          />{' '}
          min
        </span>
        <span className="hint">Silence after which a live session counts as idle. Default: 15 min.</span>
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
        <span>Toast when probably waiting</span>
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
            <dt>Version</dt>
            <dd>
              {diagnostics.appVersion} · Electron {diagnostics.electronVersion} · {diagnostics.platform}
            </dd>
          </dl>
          <div className="estimate">
            Claude Control is read-only: it never writes to Claude Code&rsquo;s data, never sends
            input to a session and makes no network requests.
          </div>
        </>
      )}
    </div>
  );
}
