import React, { useState } from 'react';
import { useAppState, useStatusBump, eventBus, EVENTS } from './useAppStore.js';
import { deriveSessionUiState } from '/modules/session-ui-state.js';
import { getProjectConfig } from '/modules/project-mapping.js';
// Single source of truth for section boundaries / grouping — imported at runtime
// (esbuild external) so the island reuses the exact vanilla classification.
import { classifySessionsForGroupedList } from '/modules/ui/views/session-view.js';
import { groupSessionsByProject } from '/modules/session-manager.js';
import SessionRowFull from './SessionRowFull.jsx';

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

// favorite-first then activity priority then timestamp desc (matches _getTimelineSessions).
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
          {sessions.map((s) => <SessionRowFull key={s.id} s={s} currentId={currentId} draggable />)}
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
  return <>{ordered.map((s) => <SessionRowFull key={s.id} s={s} currentId={currentId} />)}</>;
}
