import React from 'react';
import { useAppState, useStatusBump, appStore, eventBus, EVENTS } from './useAppStore.js';
import { deriveSessionUiState } from '/modules/session-ui-state.js';
import { getProjectFromSession, getProjectConfig } from '/modules/project-mapping.js';
import SessionRowMenu from './SessionRowMenu.jsx';

function indicatorClass(ui) {
  if (ui.attention === 'needs-input' || ui.activity === 'waiting') return 'waiting';
  if (ui.activity === 'working') return 'working';
  if (ui.activity === 'done' || ui.activity === 'done-unread') return 'done';
  return '';
}

// Parity with session-view _getActivitySortPriority: attention/working=1, done-unread=2, idle=3.
function sortPriority(ui) {
  const st = ui.hookStatus?.state;
  if (st) {
    if (['running', 'starting', 'waiting'].includes(st)) return 1;
    if (st === 'done-unread') return 2;
    return 3;
  }
  if (['thinking', 'working', 'waiting'].includes(ui.activity)) return 1;
  if (ui.activity === 'done-unread') return 2;
  return 3;
}
function sortTimestamp(s, ui) {
  const live = ui.hookStatus?.liveActivity;
  return live?.updatedAt || ui.hookStatus?.lastDoneAt || s.lastActivityAt || s.createdAt || 0;
}
function isFavorite(s) { return Boolean(s.favorite); }

function SessionRow({ s, currentId }) {
  const ui = deriveSessionUiState(s.id, { currentSessionId: currentId });
  const active = s.id === currentId;
  const ind = indicatorClass(ui);
  const project = getProjectFromSession(s);
  const emoji = getProjectConfig(project)?.emoji || '';
  const onClick = () => {
    const prev = appStore.getState().currentSessionId;
    if (prev === s.id) return;
    appStore.setState({ currentSessionId: s.id });
    eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: s.id, previousSessionId: prev });
  };
  return (
    <div
      className={`session-child-row${active ? ' active' : ''}${s.worktree ? ' has-worktree' : ''} transport-${ui.transport}`}
      data-id={s.id}
      data-state={ui.activity || 'idle'}
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      {emoji && <span className="session-project-emoji" title={project}>{emoji}</span>}
      <span className="session-name">{s.name || s.id}</span>
      <span className="session-row-badges">
        {s.engine && <span className={`session-engine-badge engine-${s.engine}`} title={s.engine}>{s.engine[0]?.toUpperCase()}</span>}
        {s.worktree && <span className="session-worktree-chip" title="Worktree session">⑂</span>}
        {ind && <span className={`session-activity-indicator ${ind}`} title={ind} />}
      </span>
      <SessionRowMenu s={s} favorite={isFavorite(s)} />
    </div>
  );
}

export default function SessionList() {
  useStatusBump();
  const sessions = useAppState((st) => st.sessions);
  const currentId = useAppState((st) => st.currentSessionId);
  const list = (sessions || []).filter((s) => s.intendedState !== 'archived');
  // Timeline order parity (_getTimelineSessions): favorite -> activity priority -> timestamp desc.
  const ordered = [...list].sort((a, b) => {
    const fa = isFavorite(a) ? 0 : 1, fb = isFavorite(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ua = deriveSessionUiState(a.id, { currentSessionId: currentId });
    const ub = deriveSessionUiState(b.id, { currentSessionId: currentId });
    const pa = sortPriority(ua), pb = sortPriority(ub);
    if (pa !== pb) return pa - pb;
    return sortTimestamp(b, ub) - sortTimestamp(a, ua);
  });
  return <>{ordered.map((s) => <SessionRow key={s.id} s={s} currentId={currentId} />)}</>;
}
