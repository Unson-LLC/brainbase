/**
 * プロジェクト名とパスのマッピング
 * DRY: 複数箇所で使われていたマッピングを一元化
 */

// WORKSPACE_ROOTを動的に取得（API経由）
export let WORKSPACE_ROOT = '/path/to/workspace'; // デフォルト値（API経由で上書きされる）
let PROJECT_PATH_MAP_CACHE = null;
let CORE_PROJECTS_CACHE = null;
let PROJECT_CONFIG_CACHE = null; // プロジェクト設定のキャッシュ（hasGitRepository用）
let RUNTIME_PROJECT_CATALOG_SOURCE = { status: 'pending' };

function normalizeProjectKey(value) {
  if (!value || typeof value !== 'string') return '';
  return value.toLowerCase().replace(/_/g, '-');
}

function resolveProjectId(projectId, coreProjects = []) {
  const normalized = normalizeProjectKey(projectId);
  if (!normalized) return '';

  const exact = coreProjects.find(p => p.toLowerCase() === projectId.toLowerCase());
  if (exact) return exact;

  const normalizedMatch = coreProjects.find(p => normalizeProjectKey(p) === normalized);
  if (normalizedMatch) return normalizedMatch;

  return projectId;
}

function getProjectAccessKeys(projectId, projectConfig = null) {
  const keys = new Set();
  const normalizedId = normalizeProjectKey(projectId);
  if (normalizedId) keys.add(normalizedId);

  const githubRepo = normalizeProjectKey(projectConfig?.github?.repo);
  if (githubRepo) keys.add(githubRepo);

  for (const alias of projectConfig?.aliases || []) {
    const normalizedAlias = normalizeProjectKey(alias);
    if (normalizedAlias) keys.add(normalizedAlias);
  }

  return keys;
}

export function isProjectSelectableForAccess(projectId, projectCodes = [], projectConfig = null) {
  if (!projectCodes || projectCodes.length === 0) return true;

  const allowedCodes = new Set(projectCodes.flatMap((code) => {
    const normalized = normalizeProjectKey(code);
    return normalized ? [normalized] : [];
  }));
  if (allowedCodes.size === 0) return true;

  const projectKeys = getProjectAccessKeys(projectId, projectConfig);
  return Array.from(projectKeys).some((key) => allowedCodes.has(key));
}

// 初期化処理（モジュールロード時に実行）
export const projectMappingReady = (async function initWorkspaceRoot() {
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
                        if (proj.local && proj.local.path) {
                            // 絶対パスの場合はそのまま使用、相対パスの場合はWORKSPACE_ROOTと結合
                            const path = proj.local.path.startsWith('/')
                                ? proj.local.path
                                : `${WORKSPACE_ROOT}/${proj.local.path}`;
                            PROJECT_PATH_MAP_CACHE[proj.id] = path;
                        }
                    });
                    CORE_PROJECTS_CACHE = data.projects.projects
                        .filter(proj => !proj.archived)
                        .map(proj => proj.id);
                    console.log('[ProjectMapping] Loaded projects:', CORE_PROJECTS_CACHE);
                }
            }
        }

        // Local paths remain owned by the workspace config. Session-selectable
        // project identity comes from the authenticated, organization-scoped
        // runtime catalog and is merged without inventing local paths.
        try {
            const runtimeResponse = await fetch('/api/config/projects');
            if (runtimeResponse.ok) {
                const runtimeCatalog = await runtimeResponse.json();
                RUNTIME_PROJECT_CATALOG_SOURCE = runtimeCatalog.source || { status: 'unknown' };
                if (runtimeCatalog.source?.status === 'unavailable') {
                    console.warn('[ProjectMapping] Project Registry unavailable; session project selection disabled', runtimeCatalog.source.code);
                }
                if (runtimeCatalog.source?.status === 'loaded' && Array.isArray(runtimeCatalog.projects)) {
                    if (runtimeCatalog.projects.length === 0) {
                        RUNTIME_PROJECT_CATALOG_SOURCE = {
                            ...RUNTIME_PROJECT_CATALOG_SOURCE,
                            status: 'confirmed_empty',
                            upstream_status: 'loaded'
                        };
                    }
                    PROJECT_CONFIG_CACHE ||= {};
                    PROJECT_PATH_MAP_CACHE ||= {};
                    for (const project of runtimeCatalog.projects) {
                        PROJECT_CONFIG_CACHE[project.id] = {
                            ...(PROJECT_CONFIG_CACHE[project.id] || {}),
                            ...project
                        };
                    }
                    CORE_PROJECTS_CACHE = runtimeCatalog.projects
                        .filter(project => !project.archived)
                        .map(project => project.id);
                } else {
                    CORE_PROJECTS_CACHE = [];
                }
            } else if (runtimeResponse.status !== 401) {
                RUNTIME_PROJECT_CATALOG_SOURCE = { status: 'request_failed', http_status: runtimeResponse.status };
                CORE_PROJECTS_CACHE = [];
                console.warn('[ProjectMapping] Runtime project catalog request failed:', runtimeResponse.status);
            } else {
                RUNTIME_PROJECT_CATALOG_SOURCE = { status: 'authentication_required', http_status: 401 };
                CORE_PROJECTS_CACHE = [];
            }
        } catch (runtimeError) {
            RUNTIME_PROJECT_CATALOG_SOURCE = { status: 'unavailable' };
            CORE_PROJECTS_CACHE = [];
            console.warn('[ProjectMapping] Failed to fetch runtime project catalog; session project selection disabled:', runtimeError);
        }
    } catch (err) {
        RUNTIME_PROJECT_CATALOG_SOURCE = { status: 'workspace_config_unavailable' };
        CORE_PROJECTS_CACHE = [];
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
        'back-office': `${PROJECTS_ROOT}/back_office`,
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
    const projects = CORE_PROJECTS_CACHE || Object.keys(getProjectPathMap());
    if (PROJECT_CONFIG_CACHE) {
        return projects.filter((id) => !PROJECT_CONFIG_CACHE[id]?.archived);
    }
    return projects;
}

/**
 * セッション作成UIで選択可能なプロジェクト一覧を取得
 * archived: true と session_select: false を除外
 * メンバーのprojectCodesでフィルター（空配列=制限なし＝admin/CEO）
 * @param {string[]|null} projectCodes - ログインユーザーのprojectCodes
 * @returns {string[]} プロジェクトID配列
 */
export function getSessionSelectableProjects(projectCodes = null) {
    const projects = getCORE_PROJECTS();
    let filtered = projects;
    if (PROJECT_CONFIG_CACHE) {
        filtered = filtered.filter((id) => PROJECT_CONFIG_CACHE[id]?.session_select !== false);
    }
    if (PROJECT_PATH_MAP_CACHE) {
        filtered = filtered.filter((id) => Boolean(PROJECT_PATH_MAP_CACHE[id]));
    }
    if (projectCodes && projectCodes.length > 0) {
        filtered = filtered.filter((id) => isProjectSelectableForAccess(
            id,
            projectCodes,
            PROJECT_CONFIG_CACHE?.[id] || null
        ));
    }
    return filtered;
}

export function getProjectsRequiringWorkspaceSetup() {
    if (!PROJECT_CONFIG_CACHE || !PROJECT_PATH_MAP_CACHE) return [];
    return (CORE_PROJECTS_CACHE || []).filter((id) => (
        PROJECT_CONFIG_CACHE[id]?.session_select !== false && !PROJECT_PATH_MAP_CACHE[id]
    ));
}

export function getRuntimeProjectCatalogSource() {
    return { ...RUNTIME_PROJECT_CATALOG_SOURCE };
}

/**
 * Return the user-facing state of the runtime project catalog.
 *
 * The catalog is deliberately fail-closed: every state other than `loaded`
 * leaves only the safe `general` option available to callers.  Keeping the
 * copy here makes both project selectors use the same wording without
 * exposing registry implementation details in the UI modules.
 *
 * @param {{status?: string, http_status?: number, enrichment_status?: string}|null} source
 * @returns {string}
 */
export function getRuntimeProjectCatalogStatusMessage(source = getRuntimeProjectCatalogSource()) {
    const status = source?.status || 'unknown';

    if (status === 'loaded' && source?.enrichment_status === 'unavailable') {
        return 'プロジェクト一覧を読み込みましたが、ローカルのワークスペース設定を確認できません。一覧は利用できますが、未設定のプロジェクトはワークスペース設定が必要です。';
    }
    if (status === 'loaded') {
        return '権限のあるプロジェクト一覧を読み込みました。';
    }
    if (status === 'confirmed_empty') {
        return 'プロジェクト一覧の取得は完了しましたが、権限のあるプロジェクトは0件です。generalのみ選択できます。';
    }
    if (status === 'authentication_required') {
        return 'プロジェクト一覧を取得できません。認証が必要です。generalのみ選択できます。';
    }
    if (status === 'request_failed') {
        const httpStatus = Number.isInteger(source?.http_status) ? `（HTTP ${source.http_status}）` : '';
        return `プロジェクト一覧を取得できません${httpStatus}。generalのみ選択できます。`;
    }
    if (status === 'unavailable' || status === 'workspace_config_unavailable') {
        return 'プロジェクト一覧を取得できません。接続またはワークスペース設定を確認してください。generalのみ選択できます。';
    }
    return 'プロジェクト一覧の状態を確認できません。generalのみ選択できます。';
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

  const normalized = normalizeProjectKey(project);
  if (normalized === 'general') return WORKSPACE_ROOT;

  const pathMap = getProjectPathMap();
  const resolvedId = resolveProjectId(project, Object.keys(pathMap));
  const configuredPath = pathMap[resolvedId] || pathMap[normalized];
  if (configuredPath) return configuredPath;
  if (PROJECT_CONFIG_CACHE?.[project] || PROJECT_CONFIG_CACHE?.[resolvedId]) {
    const error = new Error(`Workspace setup is required for project: ${project}`);
    error.code = 'PROJECT_WORKSPACE_SETUP_REQUIRED';
    throw error;
  }
  return `${WORKSPACE_ROOT}/${project}`;
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

  // Worktreeパスの場合（.worktrees/session-xxx-workspace or brainbase-worktrees/session-xxx-workspace）
  const worktreeMatch = path.match(/(?:\.worktrees|brainbase-worktrees)\/session-\d+-(.+?)(?:\/|$)/);
  if (worktreeMatch) {
    const projectHint = worktreeMatch[1];
    // workspace -> general
    if (projectHint === 'workspace') return 'general';

    const resolvedHint = resolveProjectId(projectHint, coreProjects);
    if (resolvedHint && coreProjects.includes(resolvedHint)) return resolvedHint;

    // 部分一致（brainbase-ui -> brainbase など）
    const normalizedHint = normalizeProjectKey(projectHint);
    for (const proj of coreProjects) {
      if (normalizedHint.includes(normalizeProjectKey(proj))) {
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
 * セッションからプロジェクト名を取得
 * @param {Object|null|undefined} session - セッション
 * @returns {string} プロジェクト名
 */
export function getProjectFromSession(session) {
  if (!session) return 'general';
  if (session.project) {
    const coreProjects = Object.keys(getProjectPathMap());
    return resolveProjectId(session.project, coreProjects) || session.project;
  }
  return getProjectFromPath(session.path);
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
