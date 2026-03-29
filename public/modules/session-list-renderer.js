/**
 * セッションリストのHTMLレンダリング
 * DOM操作からテンプレート生成を分離
 */

import { getProjectConfig } from './project-mapping.js';
import { escapeHtml } from './ui-helpers.js';

/**
 * 相対時間フォーマット（例: "3m ago", "2h ago", "1d ago"）
 * @param {string} isoString - ISO 8601 日時文字列
 * @returns {string} 相対時間
 */
function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'now';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getPausedStatusLabel(session, { isPaused }) {
  if (!isPaused) {
    return null;
  }

  if (session.pausedReason === 'manual') {
    return {
      text: '⏸ Manual pause',
      title: 'Paused manually to save resources.'
    };
  }

  if (session.pausedReason === 'tmux_missing_on_restore') {
    return {
      text: '⏸ Auto pause',
      title: 'Paused automatically because TMUX session was missing during restore.'
    };
  }

  if (session.pausedReason === 'migrated_from_stopped') {
    return {
      text: '⏸ Migrated',
      title: 'Migrated from legacy stopped state.'
    };
  }

  return {
    text: '⏸ Paused',
    title: 'Session is paused.'
  };
}

function renderChip(text, { className = '', title = '' } = {}) {
  if (!text) return '';
  const classes = ['session-summary-chip', className].filter(Boolean).join(' ');
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="${classes}"${titleAttr}>${escapeHtml(text)}</span>`;
}

/**
 * セッション行のHTMLを生成
 * @param {Object} session - セッションオブジェクト
 * @param {Object} options - オプション
 * @param {boolean} options.isActive - アクティブかどうか
 * @param {string} options.project - プロジェクト名
 * @param {boolean} options.showProjectEmoji - プロジェクト絵文字を表示するか
 * @param {boolean} options.isDraggable - ドラッグ可能か
 * @param {Object} options.sessionUiState - セッションUI状態（deriveSessionUiStateから）
 * @returns {string} HTML文字列
 */
export function renderSessionRowHTML(session, options = {}) {
  const {
    isActive = false,
    project = 'General',
    showProjectEmoji = false,
    isDraggable = true,
    sessionUiState = null
  } = options;
  const displayName = escapeHtml(session.name || session.id);
  const hasWorktree = !!session.worktree;
  const engine = session.engine || 'claude';
  const uiState = sessionUiState || {};
  const summary = uiState.summary || {};
  const activity = uiState.activity || 'idle';
  const transport = uiState.transport || 'disconnected';
  const attention = uiState.attention || 'none';
  const recentFile = uiState.recentFile || null;
  const activeClass = isActive ? ' active' : '';
  const archivedClass = session.intendedState === 'archived' ? ' archived' : '';
  const worktreeClass = hasWorktree ? ' has-worktree' : '';
  const transportClass = transport ? ` transport-${transport}` : '';
  const attentionClass = attention !== 'none' ? ` attention-${attention}` : '';
  const draggableAttr = isDraggable ? 'true' : 'false';

  // 意図的な一時停止状態かどうか（intendedStateで判定）
  const isPaused = session.intendedState === 'paused';
  const pausedClass = isPaused ? ' paused' : '';
  const pausedStatusLabel = getPausedStatusLabel(session, { isPaused });
  const pausedLabelHTML = pausedStatusLabel
    ? `<span class="paused-label" title="${escapeHtml(pausedStatusLabel.title)}">${escapeHtml(pausedStatusLabel.text)}</span>`
    : '';

  const sessionIcon = hasWorktree ? 'git-merge' : 'terminal-square';

  // Engine icon: codex/claudeの区別をSVGアイコンで表示
  const engineMeta = engine === 'codex'
    ? { title: 'OpenAI Codex', className: 'engine-icon engine-codex' }
    : { title: 'Claude Code', className: 'engine-icon engine-claude' };
  const engineBadge = `<span class="${engineMeta.className}" title="${engineMeta.title}"><img src="/icons/${engine}.svg" class="engine-svg-icon" alt="${engineMeta.title}"></span>`;

  const projectConfig = showProjectEmoji ? getProjectConfig(project) : null;
  const projectEmoji = projectConfig?.emoji ? escapeHtml(projectConfig.emoji) : '';
  const projectLabel = escapeHtml(project);
  const projectEmojiBadge = showProjectEmoji && projectEmoji
    ? `<span class="session-project-emoji" title="${projectLabel}">${projectEmoji}</span>`
    : '';

  // 会話ログ情報（conversationSummary - 軽量版）
  const convSummary = session.conversationSummary;
  const convCount = convSummary?.totalConversations || 0;
  const convLastActivity = convSummary?.lastActivity;
  const convBadge = convCount > 0
    ? `<span class="conversation-badge" title="${convCount} conversation(s)${convLastActivity ? ', last: ' + formatRelativeTime(convLastActivity) : ''}"><i data-lucide="message-square"></i>${convCount}</span>`
    : '';

  const isWorking = activity === 'working' || activity === 'thinking' || activity === 'goalseek';
  const activityIndicator = isWorking
    ? '<span class="session-activity-indicator working" title="Agent working"></span>'
    : activity === 'done-unread'
      ? '<span class="session-activity-indicator done" title="Unread done signal"></span>'
      : '<span class="session-activity-indicator idle" aria-hidden="true"></span>';

  const transportLabelMap = {
    connected: { text: 'Live', className: 'transport-ok', title: 'Terminal connected' },
    reconnecting: { text: 'Reconnecting', className: 'transport-warn', title: 'Terminal reconnecting' },
    disconnected: { text: 'Offline', className: 'transport-muted', title: 'Terminal disconnected' }
  };

  const summaryChips = [];
  if (summary.repo || summary.baseBranch) {
    summaryChips.push(renderChip(
      `${summary.repo || 'repo'}${summary.baseBranch ? `/${summary.baseBranch}` : ''}`,
      {
        className: 'chip-repo',
        title: summary.workspacePath || summary.repo || ''
      }
    ));
  }
  if (summary.dirty) {
    summaryChips.push(renderChip('dirty', { className: 'chip-dirty', title: 'Working copy has changes' }));
  }
  if (summary.changesNotPushed > 0) {
    summaryChips.push(renderChip(`↑${summary.changesNotPushed}`, {
      className: 'chip-push',
      title: `${summary.changesNotPushed} change(s) not pushed`
    }));
  }
  if (summary.prStatus === 'merged') {
    summaryChips.push(renderChip('merged', { className: 'chip-pr-ok', title: 'PR merged' }));
  } else if (summary.prStatus === 'open_or_pending') {
    summaryChips.push(renderChip('pending', { className: 'chip-pr-pending', title: 'PR open or pending' }));
  }
  if (recentFile?.label) {
    summaryChips.push(renderChip(`file: ${recentFile.label}`, {
      className: 'chip-file',
      title: recentFile.path || recentFile.label
    }));
  }

  const transportBadge = transportLabelMap[transport]
    ? renderChip(transportLabelMap[transport].text, {
      className: `session-transport-badge ${transportLabelMap[transport].className}`,
      title: transportLabelMap[transport].title
    })
    : '';

  const attentionLabelMap = {
    'needs-input': { text: 'Input', className: 'attention-input', title: 'Waiting for input' }
  };

  const attentionBadge = (attention !== 'none' && attentionLabelMap[attention])
    ? renderChip(attentionLabelMap[attention].text, {
      className: `session-attention-badge ${attentionLabelMap[attention].className}`,
      title: attentionLabelMap[attention].title
    })
    : '';

  // マージボタン: worktreeがあり、アーカイブされていない場合のみ表示
  const mergeButton = hasWorktree && session.intendedState !== 'archived'
    ? '<button class="merge-session-btn" title="Merge to base branch"><i data-lucide="git-merge"></i></button>'
    : '';

  const commitTreeButton = session.intendedState !== 'archived'
    ? '<button class="commit-tree-btn" title="Commit tree"><i data-lucide="git-branch"></i></button>'
    : '';

  // 再開ボタン: 一時停止中の場合に表示
  const resumeButton = isPaused
    ? '<button class="resume-session-btn" title="Resume session"><i data-lucide="play-circle"></i></button>'
    : '';

  // 一時停止ボタン: 作業中（paused以外）の場合に表示
  const pauseButton = !isPaused && session.intendedState !== 'archived'
    ? '<button class="pause-session-btn" title="Pause session"><i data-lucide="pause-circle"></i></button>'
    : '';

  // ドロップダウンメニュー項目
  const mergeMenuItem = hasWorktree && session.intendedState !== 'archived'
    ? '<button class="dropdown-item merge-session-btn"><i data-lucide="git-merge"></i>Merge to base branch</button>'
    : '';

  const commitTreeMenuItem = session.intendedState !== 'archived'
    ? '<button class="dropdown-item commit-tree-btn"><i data-lucide="git-branch"></i>Commit tree</button>'
    : '';

  const resumePauseMenuItem = isPaused
    ? '<button class="dropdown-item resume-session-btn"><i data-lucide="play-circle"></i>Resume session</button>'
    : (!isPaused && session.intendedState !== 'archived'
        ? '<button class="dropdown-item pause-session-btn"><i data-lucide="pause-circle"></i>Pause session</button>'
        : '');

  const archiveLabel = session.intendedState === 'archived' ? 'Unarchive' : 'Archive';
  const archiveIcon = session.intendedState === 'archived' ? 'archive-restore' : 'archive';

  return `
    <div class="session-child-row${activeClass}${archivedClass}${worktreeClass}${pausedClass}${transportClass}${attentionClass}" data-id="${session.id}" data-project="${project}" data-engine="${engine}" draggable="false">
      <span class="drag-handle" title="Drag to reorder" draggable="${draggableAttr}"><i data-lucide="grip-vertical"></i></span>
      ${activityIndicator}
      <div class="session-row-main">
        <div class="session-name-container">
          <span class="session-meta">
            <span class="session-icon" title="${hasWorktree ? 'Worktree session' : 'Regular session'}"><i data-lucide="${sessionIcon}"></i></span>
          </span>
          ${projectEmojiBadge}
          <span class="session-name">${displayName}</span>
          ${pausedLabelHTML}
          <span class="session-meta session-meta-right">
            ${convBadge}
            ${engineBadge}
          </span>
        </div>
        <div class="session-summary-row">
          ${summaryChips.join('')}
          ${transportBadge}
          ${attentionBadge}
        </div>
      </div>
      <div class="session-actions-container">
        <button class="session-menu-toggle" title="メニュー"><i data-lucide="more-vertical"></i></button>
        <div class="session-dropdown-menu hidden">
          <button class="dropdown-item rename-session-btn"><i data-lucide="edit-2"></i>Rename</button>
          ${commitTreeMenuItem}
          ${mergeMenuItem}
          <button class="dropdown-item archive-session-btn"><i data-lucide="${archiveIcon}"></i>${archiveLabel}</button>
          ${resumePauseMenuItem}
          <div class="dropdown-divider"></div>
          <button class="dropdown-item delete-session-btn danger"><i data-lucide="trash-2"></i>Delete</button>
        </div>
      </div>
      <div class="child-actions" style="display: none;">
        <button class="rename-session-btn" title="Rename"><i data-lucide="edit-2"></i></button>
        ${commitTreeButton}
        ${mergeButton}
        <button class="archive-session-btn" title="${session.intendedState === 'archived' ? 'Unarchive' : 'Archive'}">
          <i data-lucide="${session.intendedState === 'archived' ? 'archive-restore' : 'archive'}"></i>
        </button>
        ${resumeButton}
        ${pauseButton}
        <button class="delete-session-btn" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `;
}

/**
 * セッショングループヘッダーのHTMLを生成
 * @param {string} project - プロジェクト名
 * @param {Object} options - オプション
 * @param {boolean} options.isExpanded - 展開状態
 * @returns {string} HTML文字列
 */
export function renderSessionGroupHeaderHTML(project, options = {}) {
  const { isExpanded = true } = options;
  const folderIcon = isExpanded ? 'folder-open' : 'folder';
  const projectConfig = getProjectConfig(project);
  const projectEmoji = projectConfig?.emoji ? escapeHtml(projectConfig.emoji) : '';
  const projectLabel = escapeHtml(project);
  const projectEmojiBadge = projectEmoji
    ? `<span class="session-project-emoji group" title="${projectLabel}">${projectEmoji}</span>`
    : '';

  return `
    <div class="session-group-header">
      <span class="folder-icon"><i data-lucide="${folderIcon}"></i></span>
      ${projectEmojiBadge}
      <span class="group-title">${projectLabel}</span>
      <button class="add-project-session-btn" data-project="${project}" title="New Session in ${projectLabel}"><i data-lucide="plus"></i></button>
    </div>
  `;
}
