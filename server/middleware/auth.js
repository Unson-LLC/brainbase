function allowInsecureHeaderAuth() {
    if (process.env.ALLOW_INSECURE_SSOT_HEADERS === 'true') {
        return true;
    }
    if (process.env.BRAINBASE_TEST_MODE === 'true') {
        return true;
    }
    if (process.env.NODE_ENV === 'test') {
        return true;
    }
    return false;
}

function parseCsv(value) {
    if (!value || typeof value !== 'string') {
        return [];
    }
    return value.split(',').map(v => v.trim()).filter(Boolean);
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => typeof item === 'string' ? item.trim() : '')
            .filter(Boolean);
    }
    if (typeof value === 'string') {
        return parseCsv(value);
    }
    return [];
}

function roleFromLevel(level) {
    const n = Number(level || 0);
    if (n >= 3) {
        return 'ceo';
    }
    if (n >= 2) {
        return 'gm';
    }
    return 'member';
}

export function requireAuth(authService) {
    return async (req, res, next) => {
        try {
            if (req.method === 'OPTIONS') {
                return next();
            }

            // 内部API Key認証（mana等の内部サービス用）
            const internalApiKey = process.env.INTERNAL_API_SECRET;
            const requestApiKey = req.get('x-internal-api-key');

            if (internalApiKey && requestApiKey === internalApiKey) {
                // 内部APIアクセスは全プロジェクトへのアクセス権を付与
                // 主要プロジェクトを列挙（動的取得は複雑なため静的リスト）
                const allProjects = [
                    'mana', 'brainbase', 'salestailor', 'zeims', 'tech-knight',
                    'baao', 'unson', 'dialogai', 'aitle', 'other'
                ];
                const access = {
                    role: 'member',
                    projectCodes: allProjects,
                    clearance: ['internal', 'restricted', 'finance', 'hr', 'contract'],
                    level: 2,
                    employmentType: 'internal_service',
                    personId: 'internal_api',
                    slackUserId: null,
                    slackWorkspaceId: null,
                    tenantId: null
                };
                req.access = access;
                req.auth = { sub: 'internal_api', level: 2 };
                return next();
            }

            // 通常のトークンベース認証
            const header = req.headers.authorization || '';
            const token = header.startsWith('Bearer ') ? header.slice(7) : null;
            if (token) {
                const decoded = authService.verifyToken(token);
                // Prefer JWT claims when available
                let role = typeof decoded.role === 'string' ? decoded.role.toLowerCase() : '';
                let projectCodes = normalizeStringArray(decoded.projectCodes || decoded.project_codes);
                let clearance = normalizeStringArray(decoded.clearance);

                // Backfill role/projectCodes/clearance from auth_grants for legacy tokens.
                if ((!role || !projectCodes.length || !clearance.length)
                    && typeof authService.findGrant === 'function') {
                    const slackUserId = decoded.slackUserId || decoded.slack_user_id || null;
                    const slackWorkspaceId = decoded.slackWorkspaceId || decoded.slack_workspace_id || null;

                    if (slackUserId && slackWorkspaceId) {
                        const grant = await authService.findGrant({ slackUserId, slackWorkspaceId });
                        if (grant) {
                            const grantAccess = typeof authService.buildAccessFromGrant === 'function'
                                ? authService.buildAccessFromGrant(grant)
                                : null;
                            if (grantAccess) {
                                role = role || grantAccess.role || '';
                                if (!projectCodes.length) {
                                    projectCodes = normalizeStringArray(grantAccess.projectCodes);
                                }
                                if (!clearance.length) {
                                    clearance = normalizeStringArray(grantAccess.clearance);
                                }
                            }
                        }
                    }
                }

                const access = {
                    role: role || roleFromLevel(decoded.level),
                    projectCodes,
                    clearance,
                    level: decoded.level || 1,
                    employmentType: decoded.employmentType || 'contractor',
                    personId: decoded.sub || null,
                    slackUserId: decoded.slackUserId || decoded.slack_user_id || null,
                    slackWorkspaceId: decoded.slackWorkspaceId || decoded.slack_workspace_id || null,
                    tenantId: decoded.tenantId || null
                };
                req.auth = decoded;
                req.access = access;
                return next();
            }

            // 開発環境ではヘッダーだけでアクセス可能
            if (allowInsecureHeaderAuth()) {
                const role = (req.get('x-brainbase-role') || req.get('x-role') || '').toLowerCase();
                if (role) {
                    // ヘッダーベース認証を使用（Info SSOT controller用の形式）
                    const projectHeader = req.get('x-brainbase-projects') || req.get('x-projects') || '';
                    const clearanceHeader = req.get('x-brainbase-clearance') || req.get('x-clearance') || '';
                    const projectCodes = parseCsv(projectHeader);
                    const clearance = parseCsv(clearanceHeader);

                    const access = {
                        role,
                        projectCodes,
                        clearance,
                        // 既存のフィールドも維持（他のコードが使うかもしれないため）
                        level: role === 'ceo' ? 3 : role === 'gm' ? 2 : 1,
                        employmentType: 'contractor',
                        personId: null,
                        slackUserId: null,
                        slackWorkspaceId: null,
                        tenantId: null
                    };
                    req.access = access;
                    return next();
                }
            }

            return res.status(401).json({ error: 'Authorization token required' });
        } catch (error) {
            return res.status(401).json({ error: 'Invalid token' });
        }
    };
}
