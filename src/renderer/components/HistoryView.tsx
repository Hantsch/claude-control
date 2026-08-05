/**
 * History (M6, F7, F8, §8): past sessions with a project filter, a date range and free-text
 * search over titles. `aiTitle` from the transcript is used as the label when present.
 *
 * History is exactly as complete as `~/.claude/projects/` is, and the index is rebuilt on
 * every start (§5.4) — the view says so while indexing is still running.
 */

import { useEffect, useMemo, useState } from 'react';
import type { AppState, HistoryEntry, HistoryPage } from '../../shared/ipc.ts';
import { HISTORY_FINAL_LABEL } from '../../shared/presentation.ts';
import { api } from '../api.ts';
import { formatBytes, formatDateTime, formatDuration } from '../lib/format.ts';

const PAGE_SIZE = 200;

export function HistoryView({ state }: { state: AppState }): React.JSX.Element {
  const [page, setPage] = useState<HistoryPage>({ entries: [], total: 0, indexing: true });
  const [search, setSearch] = useState('');
  const [projectKey, setProjectKey] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  const query = useMemo(
    () => ({
      search: search.trim() || null,
      projectKey: projectKey || null,
      from: from ? Date.parse(`${from}T00:00:00`) : null,
      to: to ? Date.parse(`${to}T23:59:59`) : null,
      limit: PAGE_SIZE,
    }),
    [search, projectKey, from, to],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const result = await api.getHistory(query);
      if (!cancelled) setPage(result);
    };
    void load();
    // Re-query whenever the background index reports progress.
    const off = api.onHistoryChanged(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [query]);

  return (
    <div>
      <div className="filters">
        <label>
          Project
          <select value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
            <option value="">all</option>
            {state.projects.map((project) => (
              <option key={project.key} value={project.key}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            type="search"
            value={search}
            placeholder="title, branch, id"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <span className="estimate">
          {page.total} session{page.total === 1 ? '' : 's'}
          {page.indexing ? ' · indexing…' : ''}
        </span>
        <button type="button" onClick={() => void api.reindexHistory()}>
          Rebuild index
        </button>
      </div>

      <table className="history">
        <thead>
          <tr>
            <th>Ended</th>
            <th>Project</th>
            <th>Branch</th>
            <th>Final state</th>
            <th>Title</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {page.entries.map((entry) => (
            <tr key={entry.sessionId} onClick={() => setSelected(entry)}>
              <td>{formatDateTime(entry.endedAt ?? entry.mtimeMs)}</td>
              <td title={entry.project.path}>{entry.project.name}</td>
              <td>{entry.branch ?? '—'}</td>
              <td>{HISTORY_FINAL_LABEL[entry.finalStatus]}</td>
              <td className="title" title={entry.title ?? entry.sessionId}>
                {entry.title ?? entry.sessionId}
              </td>
              <td>{formatBytes(entry.fileSize)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {page.entries.length === 0 && (
        <div className="empty">
          {page.indexing ? 'Building the history index…' : 'No sessions match these filters.'}
        </div>
      )}

      {selected && (
        <div className="notice">
          <strong>{selected.title ?? selected.sessionId}</strong>
          <br />
          {formatDateTime(selected.startedAt)} → {formatDateTime(selected.endedAt)} ·{' '}
          {formatDuration(
            selected.startedAt && selected.endedAt ? selected.endedAt - selected.startedAt : null,
          )}{' '}
          · {selected.model ?? 'model unknown'} · ~{selected.messageCountEstimate} records
          <br />
          <code>{selected.transcriptPath}</code>
          <div className="row-actions">
            <button type="button" onClick={() => void api.copyText(selected.transcriptPath)}>
              Copy path
            </button>
            <button type="button" onClick={() => void api.revealPath(selected.transcriptPath)}>
              Show file
            </button>
            <button type="button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
