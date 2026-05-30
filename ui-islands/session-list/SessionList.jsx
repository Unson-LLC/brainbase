import React from 'react';
import { useAppState, useStatusBump, appStore } from './useAppStore.js';
import { deriveSessionUiState } from '/modules/session-ui-state.js';

// Parity with vanilla renderSessionRowHTML activity indicator:
// waiting (needs input) / working / done / none.
function indicatorClass(ui) {
  if (ui.attention === 'needs-input' || ui.activity === 'waiting') return 'waiting';
  if (ui.activity === 'working') return 'working';
  if (ui.activity === 'done' || ui.activity === 'done-unread') return 'done';
  return '';
}

function SessionRow({ s, currentId }) {
  const ui = deriveSessionUiState(s.id, { currentSessionId: currentId });
  const active = s.id === currentId;
  const ind = indicatorClass(ui);
  const onClick = () => {
    appStore.setState({ currentSessionId: s.id });
    document.dispatchEvent(new CustomEvent('island:switch-session', { detail: { id: s.id } }));
  };
  return (
    <div
      className={`session-child-row${active ? ' active' : ''}${s.worktree ? ' has-worktree' : ''} transport-${ui.transport}`}
      data-id={s.id}
      data-state={ui.activity || 'idle'}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <span className="session-name">{s.name || s.id}</span>
      <span className="session-row-badges">
        {s.engine && <span className={`session-engine-badge engine-${s.engine}`} title={s.engine}>{s.engine[0]?.toUpperCase()}</span>}
        {s.worktree && <span className="session-worktree-chip" title="Worktree session">⑂</span>}
        {ind && <span className={`session-activity-indicator ${ind}`} title={ind} />}
      </span>
    </div>
  );
}

export default function SessionList() {
  useStatusBump(); // re-render on status changes (status is outside appStore)
  const sessions = useAppState((st) => st.sessions);
  const currentId = useAppState((st) => st.currentSessionId);
  const list = (sessions || []).filter((s) => s.intendedState !== 'archived');
  return <>{list.map((s) => <SessionRow key={s.id} s={s} currentId={currentId} />)}</>;
}
