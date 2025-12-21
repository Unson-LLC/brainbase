/**
 * アーカイブモーダルのHTMLレンダリング
 */

/**
 * アーカイブ済みセッションアイテムのHTMLを生成
 * @param {Object} session - セッションオブジェクト
 * @returns {string} HTML文字列
 */
export function renderArchivedSessionItemHTML(session) {
  const displayName = session.name || session.id;

  return `
    <div class="archive-session-item" data-id="${session.id}">
      <span class="archive-session-name">${displayName}</span>
      <div class="archive-session-actions">
        <button class="restore-session-btn" data-id="${session.id}" title="Restore">
          <i data-lucide="archive-restore"></i>
        </button>
        <button class="delete-archived-btn" data-id="${session.id}" title="Delete permanently">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>
  `;
}

/**
 * アーカイブリスト全体のHTMLを生成
 * @param {Array} sessions - 全セッション配列
 * @returns {string} HTML文字列
 */
export function renderArchiveListHTML(sessions) {
  const archivedSessions = sessions.filter(s => s.intendedState === 'archived');

  if (archivedSessions.length === 0) {
    return '<div class="archive-empty">アーカイブ済みセッションなし</div>';
  }

  return archivedSessions
    .map(session => renderArchivedSessionItemHTML(session))
    .join('');
}
