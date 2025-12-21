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
  const archivedClass = session.intendedState === 'archived' ? ' archived' : '';
  const worktreeClass = hasWorktree ? ' has-worktree' : '';

  // runtimeStatus.needsRestart を使って停止中状態を判定
  const needsRestart = session.runtimeStatus?.needsRestart || false;
  const stoppedClass = needsRestart ? ' stopped' : '';

  // セッションアイコン: worktreeあり→git-merge、なし→terminal-square
  const sessionIcon = hasWorktree ? 'git-merge' : 'terminal-square';

  // Engine badge: codexの場合のみ表示（claudeはデフォルトなので省略）
  const engineBadge = engine === 'codex'
    ? '<span class="engine-badge engine-codex" title="OpenAI Codex">Codex</span>'
    : '';

  // ステータスラベル
  let statusLabel = '';
  if (session.intendedState === 'archived') {
    statusLabel = '<span class="archived-label">(Archived)</span>';
  } else if (needsRestart) {
    statusLabel = '<span class="stopped-label">(Stopped)</span>';
  }

  // マージボタン: worktreeがあり、アーカイブされていない場合のみ表示
  const mergeButton = hasWorktree && session.intendedState !== 'archived'
    ? '<button class="merge-session-btn" title="Merge to main"><i data-lucide="git-merge"></i></button>'
    : '';

  // 復元ボタン: ttyd停止中の場合に表示
  const restartButton = needsRestart
    ? '<button class="restart-session-btn" title="Restart terminal"><i data-lucide="play"></i></button>'
    : '';

  // 停止ボタン: アクティブでttyd起動中の場合に表示
  const stopButton = session.intendedState === 'active' && session.runtimeStatus?.ttydRunning
    ? '<button class="stop-session-btn" title="Stop terminal"><i data-lucide="square"></i></button>'
    : '';

  return `
    <div class="session-child-row${activeClass}${archivedClass}${worktreeClass}${stoppedClass}" data-id="${session.id}" data-project="${project}" data-engine="${engine}" draggable="true">
      <span class="drag-handle" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span>
      <div class="session-name-container">
        <span class="session-icon" title="${hasWorktree ? 'Worktree session' : 'Regular session'}"><i data-lucide="${sessionIcon}"></i></span>
        <span class="session-name">${displayName}</span>
        ${engineBadge}
        ${statusLabel}
      </div>
      <button class="session-menu-toggle" title="メニュー"><i data-lucide="more-vertical"></i></button>
      <div class="child-actions">
        ${restartButton}
        ${stopButton}
        ${mergeButton}
        <button class="rename-session-btn" title="Rename"><i data-lucide="edit-2"></i></button>
        <button class="delete-session-btn" title="Delete"><i data-lucide="trash-2"></i></button>
        <button class="archive-session-btn" title="${session.intendedState === 'archived' ? 'Unarchive' : 'Archive'}">
          <i data-lucide="${session.intendedState === 'archived' ? 'archive-restore' : 'archive'}"></i>
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
