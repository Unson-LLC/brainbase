/**
 * セッション管理のロジック
 * DRY: app.jsから抽出したセッション操作関数
 */

import { CORE_PROJECTS, getProjectFromPath } from './project-mapping.js';

/**
 * セッションをプロジェクト別にグループ化
 * @param {Array} sessions - セッション一覧
 * @param {Object} options - オプション
 * @param {boolean} options.excludeArchived - アーカイブ済みを除外
 * @param {boolean} options.includeEmptyProjects - 空のプロジェクトも含める
 * @returns {Object} プロジェクト名 -> セッション配列のマップ
 */
export function groupSessionsByProject(sessions, options = {}) {
  const { excludeArchived = false, includeEmptyProjects = false } = options;

  const output = {};

  // Filter sessions
  let filteredSessions = sessions;
  if (excludeArchived) {
    filteredSessions = sessions.filter(s => s.intendedState !== 'archived');
  }

  // Group by project
  filteredSessions.forEach(session => {
    const projectName = getProjectFromPath(session.path);
    if (!output[projectName]) output[projectName] = [];
    output[projectName].push(session);
  });

  // Add empty core projects if requested
  if (includeEmptyProjects) {
    CORE_PROJECTS.forEach(proj => {
      if (!output[proj]) output[proj] = [];
    });
  }

  return output;
}

/**
 * セッションIDを生成
 * @param {string} prefix - プレフィックス (session, task)
 * @param {string} [suffix] - 追加のサフィックス (例: タスクID)
 * @returns {string} ユニークなセッションID
 */
export function createSessionId(prefix, suffix = null) {
  const timestamp = Date.now();
  if (suffix) {
    return `${prefix}-${suffix}-${timestamp}`;
  }
  return `${prefix}-${timestamp}`;
}

/**
 * セッションオブジェクトを構築
 * @param {Object} params - セッションパラメータ
 * @returns {Object} セッションオブジェクト
 */
export function buildSessionObject(params) {
  const {
    id,
    name,
    path,
    initialCommand = null,
    taskId = null,
    worktree = null,
    intendedState = 'paused',
    engine = 'claude'
  } = params;

  return {
    id,
    name,
    path,
    initialCommand,
    taskId,
    worktree,
    intendedState,
    engine,
    created: new Date().toISOString()
  };
}
