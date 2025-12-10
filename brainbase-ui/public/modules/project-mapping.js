/**
 * プロジェクト名とパスのマッピング
 * DRY: 複数箇所で使われていたマッピングを一元化
 */

export const WORKSPACE_ROOT = '/Users/ksato/workspace';

export const PROJECT_PATH_MAP = {
  'unson': `${WORKSPACE_ROOT}/unson`,
  'tech-knight': `${WORKSPACE_ROOT}/tech-knight`,
  'brainbase': `${WORKSPACE_ROOT}/brainbase-ui`,
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

  return PROJECT_PATH_MAP[project] || `${WORKSPACE_ROOT}/${project}`;
}

/**
 * パスからプロジェクト名を抽出
 * @param {string|null|undefined} path - ファイルパス
 * @returns {string} プロジェクト名
 */
export function getProjectFromPath(path) {
  if (!path) return 'General';

  // Worktreeパスの場合（.worktrees/session-xxx-projectname）
  const worktreeMatch = path.match(/\.worktrees\/[^/]+-([^/]+)/);
  if (worktreeMatch) {
    const projectHint = worktreeMatch[1];
    // brainbase-ui -> brainbase
    for (const proj of CORE_PROJECTS) {
      if (projectHint.includes(proj) || PROJECT_PATH_MAP[proj]?.includes(projectHint)) {
        return proj;
      }
    }
  }

  // 通常パスの場合
  for (const proj of CORE_PROJECTS) {
    if (path.includes(`/${proj}/`) || path.includes(`/${proj}`)) {
      return proj;
    }
  }

  // workspace rootの場合
  if (path === WORKSPACE_ROOT || path === `${WORKSPACE_ROOT}/`) {
    return 'General';
  }

  return 'General';
}
