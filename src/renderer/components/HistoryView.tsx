/**
 * History (M6, F7, F8, §8): past sessions with a project filter, a date range and free-text
 * search over titles. `aiTitle` from the transcript is used as the label when present.
 *
 * History is exactly as complete as `~/.claude/projects/` is, and the index is rebuilt on
 * every start (§5.4) — the view says so while indexing is still running.
 */

import { useEffect, useMemo, useState } from 'react';
import type { AppState, HistoryEntry, HistoryPage } from '../../shared/ipc.ts';
import {
  formatShownOf,
  HISTORY_FINAL_LABEL,
  TRUNCATED_TOTAL_EXPLANATION,
  TRUNCATED_TOTAL_MARKER,
} from '../../shared/presentation.ts';
import { api } from '../api.ts';
import { formatBytes, formatDateTime, formatDuration, formatTokens } from '../lib/format.ts';
import { groupHistory, type HistoryGroup, type HistoryGroupDimension } from '../../core/state/historyGrouping.ts';

const PAGE_SIZE = 200;

/** Per-entry token count shown in the Tokens column — same formula as `groupHistory`'s sum. */
function entryTokens(entry: HistoryEntry): number | null {
  if (!entry.usage) return null;
  return entry.usage.inputTokens + entry.usage.outputTokens + entry.usage.cacheCreationTokens;
}

const DIMENSIONS: Array<{ value: HistoryGroupDimension | 'none'; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'project', label: 'Project' },
  { value: 'branch', label: 'Branch' },
  { value: 'model', label: 'Model' },
];

/** One session row, shared by the flat table and every group's table (D7). */
function HistoryRow({ entry, onSelect }: { entry: HistoryEntry; onSelect: () => void }): React.JSX.Element {
  const tokens = entryTokens(entry);
  return (
    <tr onClick={onSelect}>
      <td>{formatDateTime(entry.endedAt ?? entry.mtimeMs)}</td>
      <td title={entry.project.path}>{entry.project.name}</td>
      <td>{entry.branch ?? '—'}</td>
      <td>{HISTORY_FINAL_LABEL[entry.finalStatus]}</td>
      <td className="title" title={entry.title ?? entry.sessionId}>
        {entry.title ?? entry.sessionId}
      </td>
      <td>{formatBytes(entry.fileSize)}</td>
      <td>{tokens === null ? '—' : formatTokens(tokens)}</td>
    </tr>
  );
}

export function HistoryView({ state }: { state: AppState }): React.JSX.Element {
  const [page, setPage] = useState<HistoryPage>({ entries: [], total: 0, indexing: true });
  const [search, setSearch] = useState('');
  const [projectKey, setProjectKey] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [dimension, setDimension] = useState<HistoryGroupDimension | 'none'>('none');
  // Presence in the set means collapsed (mirrors popover.tsx's `collapsedGroups` convention) —
  // all groups start expanded. Reset whenever the dimension changes.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const truncated = page.total > page.entries.length;

  const groups = useMemo<HistoryGroup[]>(
    () => (dimension === 'none' ? [] : groupHistory(page.entries, dimension, { truncated })),
    [page.entries, dimension, truncated],
  );

  const shownOf = formatShownOf(page.entries.length, page.total);

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

      <div className="segmented">
        {DIMENSIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={dimension === value ? 'active' : undefined}
            onClick={() => {
              setDimension(value);
              setCollapsedGroups(new Set());
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {shownOf && <div className="shown-of">{shownOf}</div>}

      {dimension === 'none' ? (
        <table className="history">
          <thead>
            <tr>
              <th>Ended</th>
              <th>Project</th>
              <th>Branch</th>
              <th>Final state</th>
              <th>Title</th>
              <th>Size</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {page.entries.map((entry) => (
              <HistoryRow
                key={entry.sessionId}
                entry={entry}
                onSelect={() => {
                  setSelected(entry);
                  // Fire-and-forget: upgrades the stored entry's usage to the exact total once
                  // the full parse completes; the `history` broadcast it emits refreshes this view.
                  void api.getDetail(entry.sessionId);
                }}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="history-groups">
          {groups.map((group) => {
            const collapsed = collapsedGroups.has(group.key);
            const toggleGroup = (): void => {
              setCollapsedGroups((prev) => {
                const next = new Set(prev);
                if (next.has(group.key)) next.delete(group.key);
                else next.add(group.key);
                return next;
              });
            };
            return (
              <div key={group.key}>
                <div
                  className="history-group-head"
                  role="button"
                  tabIndex={0}
                  onClick={toggleGroup}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleGroup();
                    }
                  }}
                >
                  <span className={`chev${collapsed ? '' : ' open'}`} aria-hidden="true">
                    ▶
                  </span>
                  <span className="name">{group.label}</span>
                  <span className="count">
                    {group.entries.length === 1 ? '1 session' : `${group.entries.length} sessions`}
                  </span>
                  {group.notCounted > 0 && (
                    <span className="not-counted">· {group.notCounted} not counted</span>
                  )}
                  <span className="spacer" />
                  <span
                    className="total"
                    title={group.truncated || group.partial ? TRUNCATED_TOTAL_EXPLANATION : undefined}
                    aria-label={
                      group.truncated || group.partial ? TRUNCATED_TOTAL_EXPLANATION : undefined
                    }
                  >
                    {group.truncated ? TRUNCATED_TOTAL_MARKER : ''}
                    {group.partial ? '~' : ''}
                    {formatTokens(group.totalTokens)} tokens
                  </span>
                </div>
                {!collapsed && (
                  <table className="history">
                    <thead>
                      <tr>
                        <th>Ended</th>
                        <th>Project</th>
                        <th>Branch</th>
                        <th>Final state</th>
                        <th>Title</th>
                        <th>Size</th>
                        <th>Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.entries.map((entry) => (
                        <HistoryRow
                          key={entry.sessionId}
                          entry={entry}
                          onSelect={() => {
                            setSelected(entry);
                            // Fire-and-forget: upgrades the stored entry's usage to the exact
                            // total; the `history` broadcast it emits refreshes this view.
                            void api.getDetail(entry.sessionId);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

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
