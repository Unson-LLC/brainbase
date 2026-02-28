/**
 * アーカイブモーダルのロジック
 */

import { getProjectFromSession } from './project-mapping.js';

/**
 * アーカイブ済みセッションをフィルタリング
 * @param {Array} sessions - 全セッション
 * @param {string} searchTerm - 検索語（小文字）
 * @param {string} projectFilter - プロジェクトフィルタ
 * @returns {Array}
 */
export function filterArchivedSessions(sessions, searchTerm, projectFilter) {
  let archived = sessions.filter(s => s.intendedState === 'archived');

  // Search filter
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    archived = archived.filter(s =>
      (s.name || s.id).toLowerCase().includes(term)
    );
  }

  // Project filter
  if (projectFilter) {
    const normalized = projectFilter.toLowerCase();
    archived = archived.filter(s => {
      const project = getProjectFromSession(s);
      return project?.toLowerCase() === normalized;
    });
  }

  return archived;
}

/**
 * セッションを作成日時で降順ソート
 * @param {Array} sessions
 * @returns {Array}
 */
export function sortByCreatedDate(sessions) {
  return [...sessions].sort((a, b) => {
    const dateA = new Date(a.created || 0);
    const dateB = new Date(b.created || 0);
    return dateB - dateA;
  });
}

/**
 * アーカイブ済みセッションからユニークなプロジェクト一覧を取得
 * @param {Array} sessions
 * @returns {Array<string>}
 */
export function getUniqueProjects(sessions) {
  const archived = sessions.filter(s => s.intendedState === 'archived');
  const projects = archived.map(s => getProjectFromSession(s));
  return [...new Set(projects)].sort();
}
