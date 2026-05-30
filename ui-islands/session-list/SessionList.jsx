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

function SessionRow({ s, currentId, showEmoji = true }) {
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
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
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
          {sessions.map((s) => <SessionRow key={s.id} s={s} currentId={currentId} showEmoji={false} />)}
        </div>
      )}
    </div>
  );
}

function Section({ title, sessions, currentId, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const ordered = orderSessions(sessions, currentId);
  // group AFTER ordering so favorites/active surface first within each project group
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
