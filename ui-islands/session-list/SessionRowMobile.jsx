import React from 'react';
import { appStore, eventBus, EVENTS } from './useAppStore.js';
import { deriveSessionUiState } from '/modules/session-ui-state.js';
import { getProjectFromSession, getProjectConfig } from '/modules/project-mapping.js';
import SessionRowMenu from './SessionRowMenu.jsx';
import { GripVerticalIcon, MessageSquareIcon, TerminalSquareIcon } from './icons.jsx';

// Faithful JSX port of the vanilla mobile session row (session-list-renderer.js
// renderSessionRowHTML): .session-row-main > .session-name-container + .session-summary-row
// with the transport "Live" pill. Same CSS classes -> same look, but React-owned.

const TRANSPORT_LABEL = {
  connected: { text: 'Live', className: 'transport-ok', title: 'Terminal connected' },
  reconnecting: { text: 'Reconnecting', className: 'transport-warn', title: 'Terminal reconnecting' },
};
const ATTENTION_LABEL = {
  'needs-input': { text: 'Input', className: 'attention-input', title: 'Waiting for input' },
};

function Chip({ text, className, title }) {
  if (!text) return null;
  return <span className={`session-summary-chip ${className || ''}`} title={title || undefined}>{text}</span>;
}

function summaryChips(summary, isHibernated, isBroken, recentFile, session) {
  const chips = [];
  if (summary.repo || summary.baseBranch) {
    chips.push({ key: 'repo', text: `${summary.repo || 'repo'}${summary.baseBranch ? `/${summary.baseBranch}` : ''}`,
      className: 'chip-repo', title: summary.workspacePath || summary.repo || '' });
  }
  if (summary.dirty) chips.push({ key: 'dirty', text: 'dirty', className: 'chip-dirty', title: 'Working copy has uncommitted changes' });
  if (summary.unpushed || summary.changesNotPushed > 0) chips.push({ key: 'unpushed', text: 'unpushed', className: 'chip-unpushed', title: 'Local commits are not pushed' });
  if (summary.unmerged || summary.needsMerge) chips.push({ key: 'unmerged', text: 'unmerged', className: 'chip-unmerged', title: 'Changes are not integrated into the base branch' });
  if (summary.conflict || summary.hasConflicts) chips.push({ key: 'conflict', text: 'conflict', className: 'chip-conflict', title: 'Working copy has unresolved conflicts' });
  if (summary.prStatus === 'merged') chips.push({ key: 'pr', text: 'merged', className: 'chip-pr-ok', title: 'PR merged' });
  else if (summary.prStatus === 'open_or_pending') chips.push({ key: 'pr', text: 'pending', className: 'chip-pr-pending', title: 'PR open or pending' });
  if (summary.runtimeInventory) {
    const presence = summary.runtimeInventory.runtimePresence || 'cold';
    chips.push({ key: 'rt', text: presence === 'hot' ? 'hot' : 'cold', className: `chip-runtime-memory chip-runtime-${presence}`, title: 'Runtime' });
  }
  if (isHibernated) chips.push({ key: 'hib', text: 'スリープ中', className: 'chip-runtime-hibernated', title: 'スリープ中' });
  if (isBroken) chips.push({ key: 'brk', text: '復旧必要', className: 'chip-runtime-broken', title: session.resumeFailureReason || 'Runtime resume failed' });
  if (recentFile?.label) chips.push({ key: 'file', text: `file: ${recentFile.label}`, className: 'chip-file', title: recentFile.path || recentFile.label });
  return chips;
}

function activityIndicatorClass(activity) {
  if (activity === 'waiting') return 'waiting';
  if (activity === 'working' || activity === 'thinking') return 'working';
  if (activity === 'done-unread') return 'done';
  return 'idle';
}

export default function SessionRowMobile({ s, currentId }) {
  const ui = deriveSessionUiState(s.id, { currentSessionId: currentId });
  const project = getProjectFromSession(s);
  const cfg = getProjectConfig(project);
  const emoji = cfg?.emoji || '';
  const engine = s.engine || 'claude';
  const active = s.id === currentId;

  const activity = ui.activity || 'idle';
  const transport = ui.transport || 'disconnected';
  const attention = ui.attention || 'none';
  const summary = ui.summary || {};
  const recentFile = ui.recentFile || null;
  const isPaused = s.intendedState === 'paused';
  const isHibernated = s.intendedState === 'hibernated';
  const isBroken = s.intendedState === 'broken';

  const cls = [
    'session-child-row',
    active && 'active',
    s.intendedState === 'archived' && 'archived',
    s.worktree && 'has-worktree',
    isPaused && 'paused',
    isHibernated && 'hibernated',
    isBroken && 'broken',
    `transport-${transport}`,
    attention !== 'none' && `attention-${attention}`,
    s.favorite && 'favorite',
  ].filter(Boolean).join(' ');

  const convCount = s.conversationSummary?.totalConversations || 0;
  const transportInfo = TRANSPORT_LABEL[transport];
  const attentionInfo = attention !== 'none' ? ATTENTION_LABEL[attention] : null;
  const chips = summaryChips(summary, isHibernated, isBroken, recentFile, s);

  const onClick = () => {
    const prev = appStore.getState().currentSessionId;
    if (prev === s.id) return;
    appStore.setState({ currentSessionId: s.id });
    eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: s.id, previousSessionId: prev });
  };

  return (
    <div className={cls} data-id={s.id} data-project={project} data-engine={engine} draggable="false"
      role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}>
      <span className="drag-handle" title="Drag to reorder" draggable="false"><GripVerticalIcon /></span>
      <span className={`session-activity-indicator ${activityIndicatorClass(activity)}`} aria-hidden="true" />
      <div className="session-row-main">
        <div className="session-name-container">
          <span className="session-meta">
            {emoji
              ? <span className="session-icon session-config-icon" title={project}>{emoji}</span>
              : <span className="session-icon" title={s.worktree ? 'Worktree session' : 'Regular session'}><TerminalSquareIcon size={14} /></span>}
          </span>
          <span className="session-name">{s.name || s.id}</span>
          <span className="session-meta session-meta-right">
            {convCount > 0 && (
              <span className="conversation-badge" title={`${convCount} conversation(s)`}><MessageSquareIcon size={12} />{convCount}</span>
            )}
            <span className={`engine-icon engine-${engine}`} title={engine === 'codex' ? 'OpenAI Codex' : 'Claude Code'}>
              <img src={`/icons/${engine}.svg`} className="engine-svg-icon" alt={engine} />
            </span>
          </span>
        </div>
        <div className="session-summary-row">
          {chips.map((c) => <Chip key={c.key} text={c.text} className={c.className} title={c.title} />)}
          {transportInfo && <Chip text={transportInfo.text} className={`session-transport-badge ${transportInfo.className}`} title={transportInfo.title} />}
          {attentionInfo && <Chip text={attentionInfo.text} className={`session-attention-badge ${attentionInfo.className}`} title={attentionInfo.title} />}
        </div>
      </div>
      <SessionRowMenu s={s} favorite={Boolean(s.favorite)} />
    </div>
  );
}
