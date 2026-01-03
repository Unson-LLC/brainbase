/**
 * プロジェクト名とパスのマッピング
 * DRY: 複数箇所で使われていたマッピングを一元化
 */

// WORKSPACE_ROOTを動的に取得（API経由）
export let WORKSPACE_ROOT = '/path/to/workspace'; // デフォルト値（API経由で上書きされる）
let PROJECT_PATH_MAP_CACHE = null;
let CORE_PROJECTS_CACHE = null;
let PROJECT_CONFIG_CACHE = null; // プロジェクト設定のキャッシュ（hasGitRepository用）

// 初期化処理（モジュールロード時に実行）
(async function initWorkspaceRoot() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const data = await response.json();
            if (data.projects && data.projects.root) {
                WORKSPACE_ROOT = data.projects.root;
                console.log('[ProjectMapping] WORKSPACE_ROOT initialized:', WORKSPACE_ROOT);

                // プロジェクトマップをキャッシュ
                if (data.projects.projects && Array.isArray(data.projects.projects)) {
                    PROJECT_PATH_MAP_CACHE = {};
                    PROJECT_CONFIG_CACHE = {}; // プロジェクト設定をキャッシュ
                    data.projects.projects.forEach(proj => {
                        PROJECT_CONFIG_CACHE[proj.id] = proj; // 設定全体を保存
                        let path;
                        if (proj.local && proj.local.path) {
                            // 絶対パスの場合はそのまま使用、相対パスの場合はWORKSPACE_ROOTと結合
                            path = proj.local.path.startsWith('/')
                                ? proj.local.path
                                : `${WORKSPACE_ROOT}/${proj.local.path}`;
                        } else {
                            // フォールバック: デフォルトパス
                            path = `${WORKSPACE_ROOT}/projects/${proj.id}`;
                        }
                        PROJECT_PATH_MAP_CACHE[proj.id] = path;
                    });
                    CORE_PROJECTS_CACHE = Object.keys(PROJECT_PATH_MAP_CACHE);
                    console.log('[ProjectMapping] Loaded projects:', CORE_PROJECTS_CACHE);
                }
            }
        }
    } catch (err) {
        console.warn('[ProjectMapping] Failed to fetch config, using defaults:', err);
    }
})();

// PROJECT_PATH_MAPを動的に生成
function getProjectPathMap() {
    // キャッシュがあればそれを返す
    if (PROJECT_PATH_MAP_CACHE) {
        return PROJECT_PATH_MAP_CACHE;
    }

    // フォールバック: デフォルトプロジェクト
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
        'aitle': `${PROJECTS_ROOT}/Aitle`,
        'mana': `${PROJECTS_ROOT}/mana`,
    };
}

// PROJECT_PATH_MAPのエクスポート（関数として動的に取得）
export function getPROJECT_PATH_MAP() {
    return PROJECT_PATH_MAP_CACHE || getProjectPathMap();
}

// 後方互換性のため
export const PROJECT_PATH_MAP = new Proxy({}, {
    get(target, prop) {
        return getPROJECT_PATH_MAP()[prop];
    },
    ownKeys() {
        return Object.keys(getPROJECT_PATH_MAP());
    },
    getOwnPropertyDescriptor(target, prop) {
        return {
            enumerable: true,
            configurable: true,
            value: getPROJECT_PATH_MAP()[prop]
        };
    }
});

// CORE_PROJECTSも統合（動的に取得）
export function getCORE_PROJECTS() {
    return CORE_PROJECTS_CACHE || Object.keys(getProjectPathMap());
}

// 後方互換性のため
export const CORE_PROJECTS = new Proxy([], {
    get(target, prop) {
        const projects = getCORE_PROJECTS();
        if (prop === 'length') return projects.length;
        if (prop === Symbol.iterator) return projects[Symbol.iterator].bind(projects);
        return projects[prop];
    }
});

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

/**
 * プロジェクト設定を取得
 * @param {string} projectId - プロジェクトID
 * @returns {Object|null} プロジェクト設定
 */
export function getProjectConfig(projectId) {
  if (!projectId) return null;
  return PROJECT_CONFIG_CACHE ? PROJECT_CONFIG_CACHE[projectId] : null;
}

/**
 * プロジェクトがGitリポジトリを持つかどうかを判定
 * local.path または github 設定があればtrue
 * @param {string} projectId - プロジェクトID
 * @returns {boolean} Gitリポジトリがあればtrue
 */
export function hasGitRepository(projectId) {
  if (!projectId) return false;

  const config = getProjectConfig(projectId);
  if (!config) {
    // キャッシュがない場合はtrueを返す（デフォルト動作を維持）
    console.warn(`[ProjectMapping] Config not found for project: ${projectId}, assuming git available`);
    return true;
  }

  // local.path または github 設定があればGitリポジトリあり
  const hasLocalPath = !!(config.local && config.local.path);
  const hasGithub = !!config.github;

  return hasLocalPath || hasGithub;
}
