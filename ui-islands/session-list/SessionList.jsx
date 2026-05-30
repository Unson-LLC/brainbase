import React, { useState } from 'react';
import { useAppState, useStatusBump, appStore, eventBus, EVENTS } from './useAppStore.js';
import { deriveSessionUiState } from '/modules/session-ui-state.js';
import { getProjectFromSession, getProjectConfig } from '/modules/project-mapping.js';
// Single source of truth for section boundaries / grouping — imported at runtime
// (esbuild external) so the island reuses the exact vanilla classification.
import { classifySessionsForGroupedList } from '/modules/ui/views/session-view.js';
import { groupSessionsByProject } from '/modules/session-manager.js';
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

// favorite-first then activity priority then timestamp desc (matches _getTimelineSessions
// / _sortFavoriteSessionsFirst used before grouping in the vanilla grouped view).
function orderSessions(arr, currentId) {
  return [...arr].sort((a, b) => {
    const fa = isFavorite(a) ? 0 : 1, fb = isFavorite(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ua = deriveSessionUiState(a.id, { currentSessionId: currentId });
    const ub = deriveSessionUiState(b.id, { currentSessionId: currentId });
    const pa = sortPriority(ua), pb = sortPriority(ub);
    if (pa !== pb) return pa - pb;
    return sortTimestamp(b, ub) - sortTimestamp(a, ua);
  });
}

// Grouped view parity (_sortFavoriteSessionsFirst): favorite first, otherwise PRESERVE
// the saved array order (Array.sort is stable) so drag-reordering survives re-render.
function favoriteFirst(arr) {
  return [...arr].sort((a, b) => (isFavorite(a) ? 0 : 1) - (isFavorite(b) ? 0 : 1));
}

// Transient drag state kept OUTSIDE React (module-level) so dragging causes no
// re-render churn. Highlight is toggled imperatively, exactly like the vanilla view.
const dragState = { id: null, project: null };
function onHandleDragStart(e, s, project) {
  dragState.id = s.id; dragState.project = project;
  const row = e.currentTarget.closest('.session-child-row');
  if (row) row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', s.id);
  if (row) e.dataTransfer.setDragImage(row, 0, 0);
}
function onHandleDragEnd() {
  dragState.id = null; dragState.project = null;
  document.querySelectorAll('#session-list .session-child-row.dragging, #session-list .session-child-row.drag-over')
    .forEach((el) => el.classList.remove('dragging', 'drag-over'));
}
function onRowDragOver(e, s, project) {
  e.preventDefault(); e.stopPropagation();
  if (dragState.id && dragState.project === project && dragState.id !== s.id) {
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
  }
}
function onRowDragLeave(e) { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); }
function onRowDrop(e, s, project) {
  e.preventDefault(); e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  const draggedId = dragState.id, draggedProject = dragState.project;
  if (!draggedId || draggedProject !== project || draggedId === s.id) return;
  const { sessions } = appStore.getState();
  const di = sessions.findIndex((x) => x.id === draggedId);
  const ti = sessions.findIndex((x) => x.id === s.id);
  if (di === -1 || ti === -1) return;
  const reordered = [...sessions];
  const [dragged] = reordered.splice(di, 1);
  const adj = di < ti ? ti - 1 : ti; // target index shifts after removal
  reordered.splice(adj, 0, dragged);
  appStore.setState({ sessions: reordered });
  // Persist through the existing service via the app bridge (single source of truth).
  document.dispatchEvent(new CustomEvent('island:session-action', { detail: { action: 'persistOrder' } }));
}

function SessionRow({ s, currentId, showEmoji = true, grouped = false }) {
  const ui = deriveSessionUiState(s.id, { currentSessionId: currentId });
  const active = s.id === currentId;
  const ind = indicatorClass(ui);
  const project = getProjectFromSession(s);
  const emoji = getProjectConfig(project)?.emoji || '';
  const convCount = s.conversationSummary?.totalConversations || 0;
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
      data-project={grouped ? project : undefined}
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      onDragOver={grouped ? (e) => onRowDragOver(e, s, project) : undefined}
      onDragLeave={grouped ? onRowDragLeave : undefined}
      onDrop={grouped ? (e) => onRowDrop(e, s, project) : undefined}
    >
      {grouped && (
        <span className="drag-handle" draggable
          onDragStart={(e) => onHandleDragStart(e, s, project)} onDragEnd={onHandleDragEnd}
          onClick={(e) => e.stopPropagation()} title="ドラッグで並び替え">⠿</span>
      )}
      {showEmoji && emoji && <span className="session-project-emoji" title={project}>{emoji}</span>}
      <span className="session-name-container">
        <span className="session-name">{s.name || s.id}</span>
        {convCount > 0 && (
          <span className="conversation-badge" title={`${convCount} conversation(s)`}>💬{convCount}</span>
        )}
      </span>
      <span className="session-row-badges">
        {s.engine && <span className={`session-engine-badge engine-${s.engine}`} title={s.engine}>{s.engine[0]?.toUpperCase()}</span>}
        {s.worktree && <span className="session-worktree-chip" title="Worktree session">⑂</span>}
        {ind && <span className={`session-activity-indicator ${ind}`} title={ind} />}
      </span>
      <SessionRowMenu s={s} favorite={isFavorite(s)} />
    </div>
  );
}

function ProjectGroup({ project, sessions, currentId }) {
  const [collapsed, setCollapsed] = useState(false);
  const emoji = getProjectConfig(project)?.emoji || '';
  const addSession = (e) => {
    e.stopPropagation();
    eventBus.emit(EVENTS.CREATE_SESSION, { project });
  };
  return (
    <div className="session-project-group">
      <div
        className="session-group-header session-project-header"
        onClick={() => setCollapsed((c) => !c)}
        role="button" tabIndex={0}
      >
        <span className="folder-icon">{collapsed ? '📁' : '📂'}</span>
        {emoji && <span className="session-project-emoji group" title={project}>{emoji}</span>}
        <span className="group-title">{project}</span>
        <button className="add-project-session-btn" data-project={project}
          title={`New Session in ${project}`} onClick={addSession}>＋</button>
      </div>
      {!collapsed && (
        <div className="session-project-children">
          {sessions.map((s) => <SessionRow key={s.id} s={s} currentId={currentId} showEmoji={false} grouped />)}
        </div>
      )}
    </div>
  );
}

function Section({ title, sessions, currentId, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // Parity with vanilla grouped view: favorite-first but PRESERVE saved order (not the
  // timeline activity-priority sort) so drag-reordered order is respected.
  const ordered = favoriteFirst(sessions);
  const grouped = groupSessionsByProject(ordered, { excludeArchived: false, includeEmptyProjects: false });
  return (
    <div className="session-section">
      <div className="session-section-header" onClick={() => setCollapsed((c) => !c)} role="button" tabIndex={0}>
        <span className="section-chevron">{collapsed ? '▶' : '▼'}</span>
        <span>{title}</span>
        <span className="session-count">{sessions.length}</span>
      </div>
      {!collapsed && (
        <div className="session-section-children">
          {Object.entries(grouped).map(([project, ps]) => (
            <ProjectGroup key={project} project={project} sessions={ps} currentId={currentId} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SessionList() {
  useStatusBump();
  const sessions = useAppState((st) => st.sessions);
  const currentId = useAppState((st) => st.currentSessionId);
  const view = useAppState((st) => st.ui?.sessionListView) || 'timeline';
  const list = (sessions || []).filter((s) => s.intendedState !== 'archived');

  if (view === 'project') {
    const { activeSessions, pausedSessions, hibernatedSessions } = classifySessionsForGroupedList(list);
    return (
      <>
        {activeSessions.length > 0 && <Section title="作業中" sessions={activeSessions} currentId={currentId} />}
        {pausedSessions.length > 0 && <Section title="停止中" sessions={pausedSessions} currentId={currentId} defaultCollapsed />}
        {hibernatedSessions.length > 0 && <Section title="スリープ中" sessions={hibernatedSessions} currentId={currentId} defaultCollapsed />}
      </>
    );
  }

  // timeline (default): flat favorite -> priority -> timestamp desc
  const ordered = orderSessions(list, currentId);
  return <>{ordered.map((s) => <SessionRow key={s.id} s={s} currentId={currentId} />)}</>;
}
