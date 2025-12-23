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

  // runtimeStatus.needsRestart を使って予期しない停止状態を判定
  const needsRestart = session.runtimeStatus?.needsRestart || false;
  const ttydRunning = session.runtimeStatus?.ttydRunning || false;

  // 意図的な一時停止状態かどうか
  const isPaused = session.intendedState === 'paused' && !ttydRunning;
  const pausedClass = (needsRestart || isPaused) ? ' paused' : '';

  // セッションアイコン: worktreeあり→git-merge、なし→terminal-square
  const sessionIcon = hasWorktree ? 'git-merge' : 'terminal-square';

  // Engine badge: codexの場合のみ表示（claudeはデフォルトなので省略）
  const engineBadge = engine === 'codex'
    ? '<span class="engine-badge engine-codex" title="OpenAI Codex">Codex</span>'
    : '';

  // エージェント活動インジケーター（session-indicators.js）のみ使用
  // セッション状態は右側のインジケーターと背景色で表現

  // マージボタン: worktreeがあり、アーカイブされていない場合のみ表示
  const mergeButton = hasWorktree && session.intendedState !== 'archived'
    ? '<button class="merge-session-btn" title="Merge to main"><i data-lucide="git-merge"></i></button>'
    : '';

  // 再開ボタン: 一時停止中の場合に表示
  const resumeButton = isPaused
    ? '<button class="resume-session-btn" title="Resume session"><i data-lucide="play-circle"></i></button>'
    : '';

  // 一時停止ボタン: 作業中（paused以外）の場合に表示
  const pauseButton = !isPaused && session.intendedState !== 'archived'
    ? '<button class="pause-session-btn" title="Pause session"><i data-lucide="pause-circle"></i></button>'
    : '';

  return `
    <div class="session-child-row${activeClass}${archivedClass}${worktreeClass}${pausedClass}" data-id="${session.id}" data-project="${project}" data-engine="${engine}" draggable="true">
      <span class="drag-handle" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span>
      <div class="session-name-container">
        <span class="session-icon" title="${hasWorktree ? 'Worktree session' : 'Regular session'}"><i data-lucide="${sessionIcon}"></i></span>
        <span class="session-name">${displayName}</span>
        ${engineBadge}
      </div>
      <button class="session-menu-toggle" title="メニュー"><i data-lucide="more-vertical"></i></button>
      <div class="child-actions">
        ${resumeButton}
        ${pauseButton}
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
      <button class="add-project-session-btn" data-project="${project}" title="New Session in ${project}"><i data-lucide="plus"></i></button>
    </div>
  `;
}
