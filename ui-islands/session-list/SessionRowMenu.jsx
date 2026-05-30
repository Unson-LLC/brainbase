import React, { useEffect, useRef, useState } from 'react';

function act(sessionId, action) {
  document.dispatchEvent(new CustomEvent('island:session-action', { detail: { action, sessionId } }));
}

// Context menu parity with vanilla .session-dropdown-menu (favorite / archive /
// hibernate-resume-resumeRuntime / delete). Actions delegate to the app bridge
// which calls sessionService (single source of truth).
export default function SessionRowMenu({ s, favorite }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDoc, true);
    return () => document.removeEventListener('click', onDoc, true);
  }, [open]);

  const stop = (e) => { e.stopPropagation(); };
  const run = (action) => (e) => { e.stopPropagation(); setOpen(false); act(s.id, action); };

  const isArchived = s.intendedState === 'archived';
  const isPaused = s.intendedState === 'paused';
  const isHibernated = s.intendedState === 'hibernated' || s.intendedState === 'broken';
  const isActive = !isArchived && !isPaused && !isHibernated;

  return (
    <div className="session-actions-container" ref={ref} onClick={stop}>
      <button className="session-menu-toggle" title="メニュー"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>⋮</button>
      {open && (
        <div className="session-dropdown-menu">
          <button className={`dropdown-item favorite-session-btn${favorite ? ' active' : ''}`} onClick={run('favorite')}>
            ★ {favorite ? 'お気に入りから外す' : 'お気に入りに追加'}
          </button>
          <div className="dropdown-divider" />
          <button className="dropdown-item rename-session-btn" onClick={run('rename')}>✎ 名前を変更</button>
          <div className="dropdown-divider" />
          {isHibernated && <button className="dropdown-item" onClick={run('resumeRuntime')}>↻ 再開</button>}
          {isActive && <button className="dropdown-item" onClick={run('hibernate')}>⏻ スリープ</button>}
          {isPaused && <button className="dropdown-item" onClick={run('resume')}>▶ 再開</button>}
          <button className="dropdown-item archive-session-btn" onClick={run(isArchived ? 'unarchive' : 'archive')}>
            🗄 {isArchived ? '復元' : 'アーカイブ'}
          </button>
          <div className="dropdown-divider" />
          <button className="dropdown-item delete-session-btn danger" onClick={run('delete')}>🗑 削除</button>
        </div>
      )}
    </div>
  );
}
