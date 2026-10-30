/**
 * The session detail window: one transcript, read-only. The target arrives in the URL on
 * first load and over `onDetailTarget` when the window is reused for another session.
 */

import { StrictMode, useEffect, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.ts';
import { SessionDetailWindow } from './components/SessionDetailWindow.tsx';
import { detailLoad, type DetailLoad } from './lib/detailModel.ts';
import './styles.css';

const IDLE: DetailLoad = { state: 'idle' };

function DetailApp(): React.JSX.Element {
  const [load, dispatch] = useReducer(detailLoad, IDLE);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('session');
    if (initial) dispatch({ type: 'target', id: initial });
    return api.onDetailTarget(({ sessionId }) => dispatch({ type: 'target', id: sessionId }));
  }, []);

  const targetId = load.state === 'idle' ? null : load.id;
  useEffect(() => {
    if (targetId === null) return;
    // The reducer drops a response whose id is no longer the target, so a slow read of a
    // previous session cannot overwrite the current one.
    api.getDetail(targetId).then(
      (detail) => dispatch({ type: 'resolved', detail }),
      (error: unknown) =>
        dispatch({
          type: 'rejected',
          id: targetId,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }, [targetId]);

  useEffect(() => {
    if (load.state === 'loaded') document.title = load.detail.title ?? load.detail.sessionId;
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void api.closeDetailWindow();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return <SessionDetailWindow load={load} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <DetailApp />
  </StrictMode>,
);
