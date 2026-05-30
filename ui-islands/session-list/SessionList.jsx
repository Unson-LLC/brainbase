import React from 'react';
import { useAppState, appStore } from './useAppStore.js';

function SessionRow({ s, active }) {
  const onClick = () => {
    appStore.setState({ currentSessionId: s.id });
    document.dispatchEvent(new CustomEvent('island:switch-session', { detail: { id: s.id } }));
  };
  const state = s.intendedState === 'archived' ? 'idle' : (s.runtimeState === 'interactive_ready' ? 'idle' : 'idle');
  return (
    <div
      className={`session-child-row${active ? ' active' : ''}`}
      data-id={s.id}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <span className="session-name">{s.name || s.id}</span>
      <span className={`session-activity-indicator ${state}`} title={state} />
    </div>
  );
}

export default function SessionList() {
  // Selectors return RAW store refs only (stable until store updates) -> no
  // new-array-per-snapshot loop (React #185). Derivation happens in render.
  const sessions = useAppState((st) => st.sessions);
  const currentId = useAppState((st) => st.currentSessionId);
  const list = (sessions || []).filter((s) => s.intendedState !== 'archived');
  return (
    <>
      {list.map((s) => <SessionRow key={s.id} s={s} active={s.id === currentId} />)}
    </>
  );
}
