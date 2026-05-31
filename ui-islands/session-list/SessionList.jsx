import React, { useState } from 'react';
import { useAppState, useStatusBump, eventBus, EVENTS } from './useAppStore.js';
import { deriveSessionUiState } from '/modules/session-ui-state.js';
import { getProjectConfig } from '/modules/project-mapping.js';
// Single source of truth for section boundaries / grouping — imported at runtime
// (esbuild external) so the island reuses the exact vanilla classification.
import { classifySessionsForGroupedList } from '/modules/ui/views/session-view.js';
import { groupSessionsByProject } from '/modules/session-manager.js';
import { orderTimelineSessions, isFavorite } from './sessionOrder.js';
import SessionRowFull from './SessionRowFull.jsx';
import SessionToolbar, { filterSessions } from './SessionToolbar.jsx';

// favorite-first -> activity priority(sticky done) -> timestamp desc。
// sticky-done 機構を含め sessionOrder.js に集約(vanilla _getTimelineSessions パリティ)。
function orderSessions(arr, currentId) {
  return orderTimelineSessions(arr, currentId, deriveSessionUiState);
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
  const [query, setQuery] = useState('');
  const [favOnly, setFavOnly] = useState(false);

  const all = (sessions || []).filter((s) => s.intendedState !== 'archived');
  const favoriteCount = all.filter(isFavorite).length;
  const list = filterSessions(all, query, favOnly);

  const toolbar = (
    <SessionToolbar query={query} onQuery={setQuery}
      favOnly={favOnly} onToggleFav={() => setFavOnly((v) => !v)} favoriteCount={favoriteCount} />
  );

  let body;
  if (list.length === 0) {
    body = <div className="empty-state session-list-empty">{favOnly ? 'お気に入りのセッションはありません' : '一致するセッションがありません'}</div>;
  } else if (view === 'project') {
    const { activeSessions, pausedSessions, hibernatedSessions } = classifySessionsForGroupedList(list);
    body = (
      <>
        {activeSessions.length > 0 && <Section title="作業中" sessions={activeSessions} currentId={currentId} />}
        {pausedSessions.length > 0 && <Section title="停止中" sessions={pausedSessions} currentId={currentId} defaultCollapsed />}
        {hibernatedSessions.length > 0 && <Section title="スリープ中" sessions={hibernatedSessions} currentId={currentId} defaultCollapsed />}
      </>
    );
  } else {
    // timeline (default): flat favorite -> priority -> timestamp desc
    body = orderSessions(list, currentId).map((s) => <SessionRowFull key={s.id} s={s} currentId={currentId} />);
  }

  return <>{toolbar}{body}</>;
}
