/**
 * プロジェクト名とパスのマッピング
 * DRY: 複数箇所で使われていたマッピングを一元化
 */

export const WORKSPACE_ROOT = '/Users/ksato/workspace';

export const PROJECT_PATH_MAP = {
  'unson': `${WORKSPACE_ROOT}/unson`,
  'tech-knight': `${WORKSPACE_ROOT}/tech-knight`,
  'brainbase': '/Users/ksato/brainbase',
  'salestailor': `${WORKSPACE_ROOT}/salestailor`,
  'zeims': `${WORKSPACE_ROOT}/zeims`,
  'baao': `${WORKSPACE_ROOT}/baao`,
  'ncom': `${WORKSPACE_ROOT}/ncom-catalyst`,
  'senrigan': `${WORKSPACE_ROOT}/senrigan`,
};

// CORE_PROJECTSも統合（state.jsから移動予定）
export const CORE_PROJECTS = Object.keys(PROJECT_PATH_MAP);

/**
 * プロジェクト名からパスを取得
 * @param {string|null|undefined} project - プロジェクト名
 * @returns {string} パス
 */
export function getProjectPath(project) {
  if (!project) return WORKSPACE_ROOT;

  const normalized = project.toLowerCase();
  if (normalized === 'general') return WORKSPACE_ROOT;

  return PROJECT_PATH_MAP[normalized] || `${WORKSPACE_ROOT}/${project}`;
}

/**
 * パスからプロジェクト名を抽出
 * @param {string|null|undefined} path - ファイルパス
 * @returns {string} プロジェクト名
 */
export function getProjectFromPath(path) {
  if (!path) return 'General';

  // Worktreeパスの場合（.worktrees/session-xxx-workspace）
  const worktreeMatch = path.match(/\.worktrees\/session-\d+-(.+?)(?:\/|$)/);
  if (worktreeMatch) {
    const projectHint = worktreeMatch[1];
    // workspace -> General
    if (projectHint === 'workspace') return 'General';

    // 完全一致を優先
    for (const proj of CORE_PROJECTS) {
      if (projectHint === proj) return proj;
    }

    // 部分一致（brainbase-ui -> brainbase など）
    for (const proj of CORE_PROJECTS) {
      if (projectHint.includes(proj)) {
        return proj;
      }
    }
  }

  // 通常パスの場合
  for (const proj of CORE_PROJECTS) {
    const projectPath = PROJECT_PATH_MAP[proj];
    if (projectPath && (path === projectPath || path.startsWith(projectPath + '/'))) {
      return proj;
    }
  }

  // workspace rootの場合
  if (path === WORKSPACE_ROOT || path === `${WORKSPACE_ROOT}/`) {
    return 'General';
  }

  return 'General';
}
