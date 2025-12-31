/**
 * プロジェクト名とパスのマッピング
 * DRY: 複数箇所で使われていたマッピングを一元化
 */

// WORKSPACE_ROOTを動的に取得（API経由）
let WORKSPACE_ROOT = '/path/to/workspace'; // デフォルト値（API経由で上書きされる）

// 初期化処理（モジュールロード時に実行）
(async function initWorkspaceRoot() {
    try {
        const response = await fetch('/api/config/root');
        if (response.ok) {
            const data = await response.json();
            WORKSPACE_ROOT = data.root;
            console.log('[ProjectMapping] WORKSPACE_ROOT initialized:', WORKSPACE_ROOT);
        }
    } catch (err) {
        console.warn('[ProjectMapping] Failed to fetch root, using default:', err);
    }
})();

// PROJECT_PATH_MAPを動的に生成
function getProjectPathMap() {
    // 全プロジェクトは workspace/projects/ 配下
    const PROJECTS_ROOT = `${WORKSPACE_ROOT}/projects`;

    return {
        'unson': `${PROJECTS_ROOT}/unson`,
        'tech-knight': `${PROJECTS_ROOT}/tech-knight`,
        'brainbase': `${PROJECTS_ROOT}/brainbase`,
        'salestailor': `${PROJECTS_ROOT}/salestailor`,
        'zeims': `${PROJECTS_ROOT}/zeims`,
        'baao': `${PROJECTS_ROOT}/baao`,
        'ncom': `${PROJECTS_ROOT}/ncom-catalyst`,
        'senrigan': `${PROJECTS_ROOT}/senrigan`,
    };
}

// PROJECT_PATH_MAPのエクスポート（後方互換性のため）
export const PROJECT_PATH_MAP = getProjectPathMap();

// CORE_PROJECTSも統合（state.jsから移動予定）
export const CORE_PROJECTS = Object.keys(getProjectPathMap());

/**
 * プロジェクト名からパスを取得
 * @param {string|null|undefined} project - プロジェクト名
 * @returns {string} パス
 */
export function getProjectPath(project) {
  if (!project) return WORKSPACE_ROOT;

  const normalized = project.toLowerCase();
  if (normalized === 'general') return WORKSPACE_ROOT;

  const pathMap = getProjectPathMap();
  return pathMap[normalized] || `${WORKSPACE_ROOT}/${project}`;
}

/**
 * パスからプロジェクト名を抽出
 * @param {string|null|undefined} path - ファイルパス
 * @returns {string} プロジェクト名
 */
export function getProjectFromPath(path) {
  if (!path) return 'general';

  const pathMap = getProjectPathMap();
  const coreProjects = Object.keys(pathMap);

  // Worktreeパスの場合（.worktrees/session-xxx-workspace）
  const worktreeMatch = path.match(/\.worktrees\/session-\d+-(.+?)(?:\/|$)/);
  if (worktreeMatch) {
    const projectHint = worktreeMatch[1];
    // workspace -> general
    if (projectHint === 'workspace') return 'general';

    // 完全一致を優先
    for (const proj of coreProjects) {
      if (projectHint === proj) return proj;
    }

    // 部分一致（brainbase-ui -> brainbase など）
    for (const proj of coreProjects) {
      if (projectHint.includes(proj)) {
        return proj;
      }
    }
  }

  // 通常パスの場合
  for (const proj of coreProjects) {
    const projectPath = pathMap[proj];
    if (projectPath && (path === projectPath || path.startsWith(projectPath + '/'))) {
      return proj;
    }
  }

  // Fallback: プロジェクト名でのパターンマッチング
  // (state.jsonのパスが古い場合に対応)
  for (const proj of coreProjects) {
    if (path.endsWith(`/${proj}`) || path.includes(`/${proj}/`)) {
      return proj;
    }
  }

  // workspace rootの場合
  if (path === WORKSPACE_ROOT || path === `${WORKSPACE_ROOT}/`) {
    return 'general';
  }

  return 'general';
}
