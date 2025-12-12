/**
 * セッションリストのHTMLレンダリング
 * DOM操作からテンプレート生成を分離
 */

/**
 * セッション行のHTMLを生成
 * @param {Object} session - セッションオブジェクト
 * @param {Object} options - オプション
 * @param {boolean} options.isActive - アクティブかどうか
 * @param {string} options.project - プロジェクト名
 * @returns {string} HTML文字列
 */
export function renderSessionRowHTML(session, options = {}) {
  const { isActive = false, project = 'General' } = options;
  const displayName = session.name || session.id;
  const hasWorktree = !!session.worktree;
  const engine = session.engine || 'claude';
  const activeClass = isActive ? ' active' : '';
  const archivedClass = session.archived ? ' archived' : '';

  const worktreeBadge = hasWorktree
    ? '<span class="worktree-badge" title="Has worktree"><i data-lucide="git-branch"></i></span>'
    : '';

  // Engine badge: codexの場合のみ表示（claudeはデフォルトなので省略）
  const engineBadge = engine === 'codex'
    ? '<span class="engine-badge engine-codex" title="OpenAI Codex">Codex</span>'
    : '';

  const archivedLabel = session.archived
    ? '<span class="archived-label">(Archived)</span>'
    : '';

  // マージボタン: worktreeがあり、アーカイブされていない場合のみ表示
  const mergeButton = hasWorktree && !session.archived
    ? '<button class="merge-session-btn" title="Merge to main"><i data-lucide="git-merge"></i></button>'
    : '';

  return `
    <div class="session-child-row${activeClass}${archivedClass}" data-id="${session.id}" data-project="${project}" data-engine="${engine}" draggable="true">
      <span class="drag-handle" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span>
      <div class="session-name-container">
        <span class="session-icon"><i data-lucide="terminal-square"></i></span>
        <span class="session-name">${displayName}</span>
        ${engineBadge}
        ${worktreeBadge}
        ${archivedLabel}
      </div>
      <div class="child-actions">
        ${mergeButton}
        <button class="rename-session-btn" title="Rename"><i data-lucide="edit-2"></i></button>
        <button class="delete-session-btn" title="Delete"><i data-lucide="trash-2"></i></button>
        <button class="archive-session-btn" title="${session.archived ? 'Unarchive' : 'Archive'}">
          <i data-lucide="${session.archived ? 'archive-restore' : 'archive'}"></i>
        </button>
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

  return `
    <div class="session-group-header">
      <span class="folder-icon"><i data-lucide="${folderIcon}"></i></span>
      <span class="group-title">${project}</span>
      <button class="add-project-session-btn" title="New Session in ${project}"><i data-lucide="plus"></i></button>
    </div>
  `;
}
