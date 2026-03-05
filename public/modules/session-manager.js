/**
 * セッション管理のロジック
 * DRY: app.jsから抽出したセッション操作関数
 */

import { CORE_PROJECTS, getProjectFromSession } from './project-mapping.js';

/**
 * セッション名を自動生成
 * 形式: {project}-{MMDD}-{連番}
 * 例: brainbase-0216-1, salestailor-0216-2
 *
 * @param {string} project - プロジェクト名
 * @param {Array} existingSessions - 既存セッション一覧（連番計算用）
 * @param {Date} [date] - 日付（デフォルト: 今日）
 * @returns {string} 自動生成されたセッション名
 */
export function generateSessionName(project, existingSessions = [], date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateStr = `${mm}${dd}`;
  const prefix = `${project || 'general'}-${dateStr}`;

  // 同じ prefix を持つセッションの連番を計算
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let maxSeq = 0;
  for (const session of existingSessions) {
    const name = session.name || '';
    const match = name.match(pattern);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }

  return `${prefix}-${maxSeq + 1}`;
}

/**
 * 既存セッション名を遡及リネーム（名前が空 or session-{ts} 形式のもの）
 * @param {Array} sessions - 全セッション配列
 * @returns {Array} 名前が更新されたセッション配列
 */
export function retroactiveRename(sessions) {
  // 日付×プロジェクトの連番を追跡
  const seqCounters = {};

  // createdAt 順にソート（古い順）
  const sorted = [...sessions].sort((a, b) => {
    const aTime = new Date(a.created || a.createdAt || 0).getTime();
    const bTime = new Date(b.created || b.createdAt || 0).getTime();
    return aTime - bTime;
  });

  const updatedMap = new Map();

  for (const session of sorted) {
    const name = session.name || '';
    const needsRename = !name || /^session-\d+$/.test(name);

    if (!needsRename) {
      // 既に名前がある場合、連番追跡だけ更新
      const project = getProjectFromSession(session) || 'general';
      const created = new Date(session.created || session.createdAt || Date.now());
      const mm = String(created.getMonth() + 1).padStart(2, '0');
      const dd = String(created.getDate()).padStart(2, '0');
      const prefix = `${project}-${mm}${dd}`;
      const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
      const match = name.match(pattern);
      if (match) {
        const seq = parseInt(match[1], 10);
        seqCounters[prefix] = Math.max(seqCounters[prefix] || 0, seq);
      }
      updatedMap.set(session.id, session);
      continue;
    }

    // リネーム対象
    const project = getProjectFromSession(session) || 'general';
    const created = new Date(session.created || session.createdAt || Date.now());
    const mm = String(created.getMonth() + 1).padStart(2, '0');
    const dd = String(created.getDate()).padStart(2, '0');
    const prefix = `${project}-${mm}${dd}`;

    seqCounters[prefix] = (seqCounters[prefix] || 0) + 1;
    const newName = `${prefix}-${seqCounters[prefix]}`;

    updatedMap.set(session.id, { ...session, name: newName });
  }

  // 元の順序を保持して返す
  return sessions.map(s => updatedMap.get(s.id) || s);
}

/** RegExp特殊文字をエスケープ */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    const projectName = getProjectFromSession(session);
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
    project = null,
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
    project,
    initialCommand,
    taskId,
    worktree,
    intendedState,
    engine,
    created: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
