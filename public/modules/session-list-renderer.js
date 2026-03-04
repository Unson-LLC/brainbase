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

function getPausedStatusLabel(session, { isPaused, needsRestart }) {
  if (needsRestart && !isPaused) {
    return null;
  }

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

/**
 * セッション行のHTMLを生成
 * @param {Object} session - セッションオブジェクト
 * @param {Object} options - オプション
 * @param {boolean} options.isActive - アクティブかどうか
 * @param {string} options.project - プロジェクト名
 * @param {boolean} options.showProjectEmoji - プロジェクト絵文字を表示するか
 * @param {boolean} options.isDraggable - ドラッグ可能か
 * @returns {string} HTML文字列
 */
export function renderSessionRowHTML(session, options = {}) {
  const { isActive = false, project = 'General', showProjectEmoji = false, isDraggable = true } = options;
  const displayName = escapeHtml(session.name || session.id);
  const hasWorktree = !!session.worktree;
  const engine = session.engine || 'claude';
  const activeClass = isActive ? ' active' : '';
  const archivedClass = session.intendedState === 'archived' ? ' archived' : '';
  const worktreeClass = hasWorktree ? ' has-worktree' : '';
  const draggableAttr = isDraggable ? 'true' : 'false';

  // runtimeStatus.needsRestart を使って予期しない停止状態を判定
  const needsRestart = session.runtimeStatus?.needsRestart || false;
  const ttydRunning = session.runtimeStatus?.ttydRunning || false;

  // 意図的な一時停止状態かどうか（intendedStateで判定）
  const isPaused = session.intendedState === 'paused';
  const pausedClass = isPaused ? ' paused' : '';
  const pausedStatusLabel = getPausedStatusLabel(session, { isPaused, needsRestart });
  const pausedLabelHTML = pausedStatusLabel
    ? `<span class="paused-label" title="${escapeHtml(pausedStatusLabel.title)}">${escapeHtml(pausedStatusLabel.text)}</span>`
    : '';

  // セッションアイコン: worktreeあり→git-merge、なし→terminal-square
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

  // エージェント活動インジケーター（session-indicators.js）のみ使用
  // セッション状態は右側のインジケーターと背景色で表現

  // マージボタン: worktreeがあり、アーカイブされていない場合のみ表示
  const mergeButton = hasWorktree && session.intendedState !== 'archived'
    ? '<button class="merge-session-btn" title="Merge to main"><i data-lucide="git-merge"></i></button>'
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
    ? '<button class="dropdown-item merge-session-btn"><i data-lucide="git-merge"></i>Merge to main</button>'
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
    <div class="session-child-row${activeClass}${archivedClass}${worktreeClass}${pausedClass}" data-id="${session.id}" data-project="${project}" data-engine="${engine}" draggable="${draggableAttr}">
      <span class="drag-handle" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span>
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
      <div class="session-actions-container">
        <button class="session-menu-toggle" title="メニュー"><i data-lucide="more-vertical"></i></button>
        <div class="session-dropdown-menu hidden">
          <button class="dropdown-item rename-session-btn"><i data-lucide="edit-2"></i>Rename</button>
          ${commitTreeMenuItem}
          ${mergeMenuItem}
          <button class="dropdown-item archive-session-btn"><i data-lucide="${archiveIcon}"></i>${archiveLabel}</button>
          ${resumePauseMenuItem}
          <div class="dropdown-divider"></div>
          <button class="dropdown-item goal-setup-btn"><i data-lucide="target"></i>ゴール設定</button>
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
