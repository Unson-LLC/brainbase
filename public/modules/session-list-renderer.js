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

function renderChip(text, { className = '', title = '' } = {}) {
  if (!text) return '';
  const classes = ['session-summary-chip', className].filter(Boolean).join(' ');
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="${classes}"${titleAttr}>${escapeHtml(text)}</span>`;
}

function formatRuntimeMemory(rssKb) {
  const kb = Number(rssKb || 0);
  if (kb <= 0) return '0 MB';
  return `${Math.round(kb / 1024)} MB`;
}

function buildRuntimeInventoryTitle(runtimeInventory) {
  const categoryCounts = Object.entries(runtimeInventory?.processesByCategory || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([category, count]) => `${category}:${count}`)
    .join(', ');
  const posture = runtimeInventory?.runtimePresence || 'cold';
  const processCount = Number(runtimeInventory?.processCount || 0);
  const rssText = formatRuntimeMemory(runtimeInventory?.rssKb);
  return `Runtime ${posture}, RSS ${rssText}, processes ${processCount}${categoryCounts ? ` (${categoryCounts})` : ''}`;
}

function getSessionIconName(session, project) {
  const text = `${session?.name || ''} ${project || ''}`.toLowerCase();
  if (text.includes('mobile') || text.includes('モバイル')) return 'smartphone';
  if (text.includes('data') || text.includes('database') || text.includes('データ')) return 'database';
  if (text.includes('design') || text.includes('ui') || text.includes('ux') || text.includes('デザイン')) return 'palette';
  if (text.includes('marketing') || text.includes('campaign') || text.includes('マーケ')) return 'folder';
  if (text.includes('research') || text.includes('調査')) return 'search';
  if (text.includes('robot') || text.includes('ロボット') || text.includes('agent')) return 'bot';
  if (text.includes('report') || text.includes('報告') || text.includes('仕様') || text.includes('課題')) return 'file-text';
  if (text.includes('定例') || text.includes('運用') || text.includes('日次')) return 'terminal-square';
  return 'terminal-square';
}

function isLucideIconName(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]*$/i.test(value.trim());
}

function renderSessionIcon({ configuredIcon, fallbackIcon, title }) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  if (configuredIcon) {
    const icon = String(configuredIcon).trim();
    if (isLucideIconName(icon)) {
      return `<span class="session-icon session-config-icon session-config-lucide"${titleAttr}><i data-lucide="${escapeHtml(icon)}"></i></span>`;
    }
    return `<span class="session-icon session-config-icon"${titleAttr}>${escapeHtml(icon)}</span>`;
  }
  return `<span class="session-icon"${titleAttr}><i data-lucide="${escapeHtml(fallbackIcon)}"></i></span>`;
}

/**
 * セッション行のHTMLを生成
 * @param {Object} session - セッションオブジェクト
 * @param {Object} options - オプション
 * @param {boolean} options.isActive - アクティブかどうか
 * @param {string} options.project - プロジェクト名
 * @param {boolean} options.showProjectEmoji - プロジェクト絵文字を表示するか
 * @param {boolean} options.isDraggable - ドラッグ可能か
 * @param {boolean} options.isFavorite - お気に入りかどうか
 * @param {Object} options.sessionUiState - セッションUI状態（deriveSessionUiStateから）
 * @returns {string} HTML文字列
 */
export function renderSessionRowHTML(session, options = {}) {
  const {
    isActive = false,
    project = 'General',
    showProjectEmoji = false,
    isDraggable = true,
    isFavorite = false,
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
  const favoriteClass = isFavorite ? ' favorite' : '';
  const draggableAttr = isDraggable ? 'true' : 'false';

  // 意図的な一時停止状態かどうか（intendedStateで判定）
  const isPaused = session.intendedState === 'paused';
  const isHibernated = session.intendedState === 'hibernated';
  const isBroken = session.intendedState === 'broken';
  const pausedClass = isPaused ? ' paused' : '';
  const hibernatedClass = isHibernated ? ' hibernated' : '';
  const brokenClass = isBroken ? ' broken' : '';

  // Engine icon: codex/claudeの区別をSVGアイコンで表示
  const engineMeta = engine === 'codex'
    ? { title: 'OpenAI Codex', className: 'engine-icon engine-codex' }
    : { title: 'Claude Code', className: 'engine-icon engine-claude' };
  const engineBadge = `<span class="${engineMeta.className}" title="${engineMeta.title}"><img src="/icons/${engine}.svg" class="engine-svg-icon" alt="${engineMeta.title}"></span>`;

  const projectConfig = getProjectConfig(project);
  const projectEmoji = projectConfig?.emoji ? escapeHtml(projectConfig.emoji) : '';
  const projectLabel = escapeHtml(project);
  const configuredProjectIcon = projectConfig?.icon || projectConfig?.emoji || '';
  const sessionIcon = renderSessionIcon({
    configuredIcon: configuredProjectIcon,
    fallbackIcon: getSessionIconName(session, project),
    title: configuredProjectIcon ? `${projectLabel} icon from config.yml` : (hasWorktree ? 'Worktree session' : 'Regular session')
  });
  const projectEmojiBadge = showProjectEmoji && projectEmoji && !configuredProjectIcon
    ? `<span class="session-project-emoji" title="${projectLabel}">${projectEmoji}</span>`
    : '';

  // 会話ログ情報（conversationSummary - 軽量版）
  const convSummary = session.conversationSummary;
  const convCount = convSummary?.totalConversations || 0;
  const convLastActivity = convSummary?.lastActivity;
  const convBadge = convCount > 0
    ? `<span class="conversation-badge" title="${convCount} conversation(s)${convLastActivity ? ', last: ' + formatRelativeTime(convLastActivity) : ''}"><i data-lucide="message-square"></i>${convCount}</span>`
    : '';

  const isWorking = activity === 'working' || activity === 'thinking';
  const activityIndicator = activity === 'waiting'
    ? '<span class="session-activity-indicator waiting" title="Waiting for input"></span>'
    : isWorking
      ? '<span class="session-activity-indicator working" title="Agent working"></span>'
      : activity === 'done-unread'
        ? '<span class="session-activity-indicator done" title="Unread done signal"></span>'
        : '<span class="session-activity-indicator idle" aria-hidden="true"></span>';

  const transportLabelMap = {
    connected: { text: 'Live', className: 'transport-ok', title: 'Terminal connected' },
    reconnecting: { text: 'Reconnecting', className: 'transport-warn', title: 'Terminal reconnecting' }
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
    summaryChips.push(renderChip('dirty', {
      className: 'chip-dirty',
      title: 'Working copy has uncommitted changes'
    }));
  }
  if (summary.unpushed || summary.changesNotPushed > 0) {
    summaryChips.push(renderChip('unpushed', {
      className: 'chip-unpushed',
      title: 'Local commits are not pushed'
    }));
  }
  if (summary.unmerged || summary.needsMerge) {
    summaryChips.push(renderChip('unmerged', {
      className: 'chip-unmerged',
      title: 'Changes are not integrated into the base branch'
    }));
  }
  if (summary.conflict || summary.hasConflicts) {
    summaryChips.push(renderChip('conflict', {
      className: 'chip-conflict',
      title: 'Working copy has unresolved conflicts'
    }));
  }
  if (summary.prStatus === 'merged') {
    summaryChips.push(renderChip('merged', { className: 'chip-pr-ok', title: 'PR merged' }));
  } else if (summary.prStatus === 'open_or_pending') {
    summaryChips.push(renderChip('pending', { className: 'chip-pr-pending', title: 'PR open or pending' }));
  }
  if (summary.runtimeInventory) {
    const runtimeInventory = summary.runtimeInventory;
    const runtimePresence = runtimeInventory.runtimePresence || 'cold';
    const runtimeMemoryText = runtimePresence === 'hot'
      ? `hot ${formatRuntimeMemory(runtimeInventory.rssKb)}`
      : 'cold';
    summaryChips.push(renderChip(runtimeMemoryText, {
      className: `chip-runtime-memory chip-runtime-${runtimePresence}`,
      title: buildRuntimeInventoryTitle(runtimeInventory)
    }));
  }
  if (isHibernated) {
    summaryChips.push(renderChip('スリープ中', {
      className: 'chip-runtime-hibernated',
      title: session.hibernatedAt ? `スリープ ${formatRelativeTime(session.hibernatedAt)}` : 'スリープ中'
    }));
  }
  if (isBroken) {
    summaryChips.push(renderChip('broken', {
      className: 'chip-runtime-broken',
      title: session.resumeFailureReason || 'Runtime resume failed'
    }));
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

  // 再開ボタン: 一時停止中の場合に表示
  const resumeButton = isPaused
    ? '<button class="resume-session-btn" title="再開"><i data-lucide="play-circle"></i></button>'
    : '';
  const resumeRuntimeButton = (isHibernated || isBroken)
    ? '<button class="resume-runtime-btn" title="再開"><i data-lucide="rotate-cw"></i></button>'
    : '';

  // 一時停止ボタン: 作業中（paused以外）の場合に表示
  const canHibernate = engine === 'codex' && !isPaused && !isHibernated && !isBroken && session.intendedState !== 'archived';
  const pauseButton = !isPaused && !isHibernated && !isBroken && session.intendedState !== 'archived'
    ? '<button class="pause-session-btn" title="一時停止"><i data-lucide="pause-circle"></i></button>'
    : '';
  const hibernateButton = canHibernate
    ? '<button class="hibernate-session-btn" title="スリープ"><i data-lucide="power"></i></button>'
    : '';

  // ドロップダウンメニュー項目
  const resumePauseMenuItem = isPaused
    ? '<button class="dropdown-item resume-session-btn"><i data-lucide="play-circle"></i>再開</button>'
    : (!isPaused && !isHibernated && !isBroken && session.intendedState !== 'archived'
        ? '<button class="dropdown-item pause-session-btn"><i data-lucide="pause-circle"></i>一時停止</button>'
        : '');
  const hibernateMenuItem = canHibernate
    ? '<button class="dropdown-item hibernate-session-btn"><i data-lucide="power"></i>スリープ</button>'
    : '';
  const resumeRuntimeMenuItem = (isHibernated || isBroken)
    ? '<button class="dropdown-item resume-runtime-btn"><i data-lucide="rotate-cw"></i>再開</button>'
    : '';

  const archiveLabel = session.intendedState === 'archived' ? '復元' : 'アーカイブ';
  const archiveIcon = session.intendedState === 'archived' ? 'archive-restore' : 'archive';
  const favoriteTitle = isFavorite ? 'お気に入りから外す' : 'お気に入りに追加';
  const favoriteMenuItem = `<button class="dropdown-item favorite-session-btn${isFavorite ? ' active' : ''}" aria-pressed="${isFavorite ? 'true' : 'false'}"><i data-lucide="star"></i>${favoriteTitle}</button>`;

  return `
    <div class="session-child-row${activeClass}${archivedClass}${worktreeClass}${pausedClass}${hibernatedClass}${brokenClass}${transportClass}${attentionClass}${favoriteClass}" data-id="${session.id}" data-project="${project}" data-engine="${engine}" draggable="false">
      <span class="drag-handle" title="Drag to reorder" draggable="${draggableAttr}"><i data-lucide="grip-vertical"></i></span>
      ${activityIndicator}
      <div class="session-row-main">
        <div class="session-name-container">
          <span class="session-meta">
            ${sessionIcon}
          </span>
          ${projectEmojiBadge}
          <span class="session-name">${displayName}</span>
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
          <button class="dropdown-item rename-session-btn"><i data-lucide="edit-2"></i>名前を変更</button>
          ${favoriteMenuItem}
          <div class="dropdown-divider"></div>
          ${resumeRuntimeMenuItem}
          ${hibernateMenuItem}
          ${resumePauseMenuItem}
          <button class="dropdown-item archive-session-btn"><i data-lucide="${archiveIcon}"></i>${archiveLabel}</button>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item delete-session-btn danger"><i data-lucide="trash-2"></i>削除</button>
        </div>
      </div>
      <div class="child-actions" style="display: none;">
        <button class="rename-session-btn" title="名前を変更"><i data-lucide="edit-2"></i></button>
        <button class="archive-session-btn" title="${archiveLabel}">
          <i data-lucide="${session.intendedState === 'archived' ? 'archive-restore' : 'archive'}"></i>
        </button>
        ${resumeButton}
        ${resumeRuntimeButton}
        ${hibernateButton}
        ${pauseButton}
        <button class="delete-session-btn" title="削除"><i data-lucide="trash-2"></i></button>
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
