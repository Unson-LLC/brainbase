import React, { useState } from 'react';
import { useAppState, useStatusBump, eventBus, EVENTS } from './useAppStore.js';
import { deriveSessionUiState } from '/modules/session-ui-state.js';
import { getProjectFromSession, getProjectConfig } from '/modules/project-mapping.js';
import { classifySessionsForGroupedList } from '/modules/ui/views/session-view.js';
import { groupSessionsByProject } from '/modules/session-manager.js';
import SessionRowFull from './SessionRowFull.jsx';
import { SearchIcon, StarIcon } from './icons.jsx';

// Mobile bottom-sheet session list. Reproduces the vanilla mobile design (toolbar +
// spacious rows + "Live" pill) while rendering via React from the live appStore.

function isFavorite(s) { return Boolean(s.favorite); }
function favoriteFirst(arr) { return [...arr].sort((a, b) => (isFavorite(a) ? 0 : 1) - (isFavorite(b) ? 0 : 1)); }

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
function orderTimeline(arr, currentId) {
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

function MobileProjectGroup({ project, sessions, currentId }) {
  const [collapsed, setCollapsed] = useState(false);
  const emoji = getProjectConfig(project)?.emoji || '';
  const addSession = (e) => { e.stopPropagation(); eventBus.emit(EVENTS.CREATE_SESSION, { project }); };
  return (
    <div className="session-project-group">
      <div className="session-group-header session-project-header" role="button" tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}>
        <span className="folder-icon">{collapsed ? '📁' : '📂'}</span>
        {emoji && <span className="session-project-emoji group" title={project}>{emoji}</span>}
        <span className="group-title">{project}</span>
        <button className="add-project-session-btn" data-project={project} title={`New Session in ${project}`} onClick={addSession}>＋</button>
      </div>
      {!collapsed && (
        <div className="session-project-children">
          {sessions.map((s) => <SessionRowFull key={s.id} s={s} currentId={currentId} />)}
        </div>
      )}
    </div>
  );
}

function MobileSection({ title, sessions, currentId, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const grouped = groupSessionsByProject(favoriteFirst(sessions), { excludeArchived: false, includeEmptyProjects: false });
  return (
    <div className="session-section">
      <div className="session-section-header" role="button" tabIndex={0} onClick={() => setCollapsed((c) => !c)}>
        <span className="section-chevron">{collapsed ? '▶' : '▼'}</span>
        <span>{title}</span>
        <span className="session-count">{sessions.length}</span>
      </div>
      {!collapsed && (
        <div className="session-section-children">
          {Object.entries(grouped).map(([project, ps]) => (
            <MobileProjectGroup key={project} project={project} sessions={ps} currentId={currentId} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SessionListMobile() {
  useStatusBump();
  const sessions = useAppState((st) => st.sessions);
  const currentId = useAppState((st) => st.currentSessionId);
  const view = useAppState((st) => st.ui?.sessionListView) || 'timeline';
  const [query, setQuery] = useState('');
  const [favOnly, setFavOnly] = useState(false);

  const all = (sessions || []).filter((s) => s.intendedState !== 'archived');
  const favoriteCount = all.filter(isFavorite).length;
  const q = query.trim().toLowerCase();
  const list = all.filter((s) => {
    if (favOnly && !isFavorite(s)) return false;
    if (q && !(`${s.name || ''} ${getProjectFromSession(s)}`.toLowerCase().includes(q))) return false;
    return true;
  });

  const toolbar = (
    <div className="session-list-toolbar">
      <label className="session-search-wrap">
        <SearchIcon size={16} />
        <input className="session-search-input" type="search" value={query}
          placeholder="セッションを検索" aria-label="セッションを検索"
          onChange={(e) => setQuery(e.target.value)} />
      </label>
      <button className={`session-favorites-filter-btn${favOnly ? ' active' : ''}`} type="button"
        aria-pressed={favOnly} title="お気に入りのみ" aria-label="お気に入りのみ"
        onClick={() => setFavOnly((v) => !v)}>
        <StarIcon size={16} />
        <span className="session-favorites-count">{favoriteCount}</span>
      </button>
    </div>
  );

  let body;
  if (list.length === 0) {
    body = <div className="empty-state session-list-empty">{favOnly ? 'お気に入りのセッションはありません' : '一致するセッションがありません'}</div>;
  } else if (view === 'project') {
    const { activeSessions, pausedSessions, hibernatedSessions } = classifySessionsForGroupedList(list);
    body = (
      <>
        {activeSessions.length > 0 && <MobileSection title="作業中" sessions={activeSessions} currentId={currentId} />}
        {pausedSessions.length > 0 && <MobileSection title="停止中" sessions={pausedSessions} currentId={currentId} defaultCollapsed />}
        {hibernatedSessions.length > 0 && <MobileSection title="スリープ中" sessions={hibernatedSessions} currentId={currentId} defaultCollapsed />}
      </>
    );
  } else {
    body = orderTimeline(list, currentId).map((s) => <SessionRowFull key={s.id} s={s} currentId={currentId} />);
  }

  return <>{toolbar}{body}</>;
}
