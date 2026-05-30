import React from 'react';
import { getProjectFromSession } from '/modules/project-mapping.js';
import { SearchIcon, StarIcon } from './icons.jsx';

// Shared session-list toolbar (search + favorites-only filter) used by both the desktop
// sidebar (#session-list) and the mobile bottom-sheet (#mobile-session-list). The vanilla
// renderer used to render this into #session-list; the island owns rendering now, so it
// must render the toolbar too.

export function filterSessions(sessions, query, favOnly) {
  const q = (query || '').trim().toLowerCase();
  return (sessions || []).filter((s) => {
    if (favOnly && !s.favorite) return false;
    if (q && !(`${s.name || ''} ${getProjectFromSession(s)}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

export default function SessionToolbar({ query, onQuery, favOnly, onToggleFav, favoriteCount }) {
  return (
    <div className="session-list-toolbar">
      <label className="session-search-wrap">
        <SearchIcon size={16} />
        <input className="session-search-input" type="search" value={query}
          placeholder="セッションを検索" aria-label="セッションを検索"
          onChange={(e) => onQuery(e.target.value)} />
      </label>
      <button className={`session-favorites-filter-btn${favOnly ? ' active' : ''}`} type="button"
        aria-pressed={favOnly} title="お気に入りのみ" aria-label="お気に入りのみ"
        onClick={onToggleFav}>
        <StarIcon size={16} />
        <span className="session-favorites-count">{favoriteCount}</span>
      </button>
    </div>
  );
}
