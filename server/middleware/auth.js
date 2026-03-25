const INTERNAL_PROJECT_CODES = Object.freeze([
    'mana', 'brainbase', 'salestailor', 'zeims', 'tech-knight',
    'baao', 'unson', 'dialogai', 'aitle', 'other'
]);

const INTERNAL_CLEARANCE_LEVELS = Object.freeze([
    'internal',
    'restricted',
    'finance',
    'hr',
    'contract'
]);

const ROLE_LEVEL_MAP = Object.freeze({
    ceo: 3,
    gm: 2
});

function allowInsecureHeaderAuth() {
    return process.env.ALLOW_INSECURE_SSOT_HEADERS === 'true'
        || process.env.BRAINBASE_TEST_MODE === 'true'
        || process.env.NODE_ENV === 'test';
}

function buildInternalAccess() {
    return {
        role: 'member',
        projectCodes: [...INTERNAL_PROJECT_CODES],
        clearance: [...INTERNAL_CLEARANCE_LEVELS],
        level: 2,
        employmentType: 'internal_service',
        personId: 'internal_api',
        slackUserId: null,
        slackWorkspaceId: null,
        tenantId: null
    };
}

function parseCsv(value) {
    if (!value || typeof value !== 'string') {
        return [];
    }
    return value.split(',').map(v => v.trim()).filter(Boolean);
}

function deriveRoleLevel(role, fallback = 1) {
    if (!role) {
        return fallback;
    }
    return ROLE_LEVEL_MAP[role.toLowerCase()] || fallback;
}

function getHeaderValue(req, ...names) {
    for (const name of names) {
        const value = req.get(name);
        if (value) {
            return value;
        }
    }
    return '';
}

export function requireAuth(authService) {
    return (req, res, next) => {
        try {
            if (req.method === 'OPTIONS') {
                return next();
            }

            // 内部API Key認証（mana等の内部サービス用）
            const internalApiKey = process.env.INTERNAL_API_SECRET;
            const requestApiKey = req.get('x-internal-api-key');

            if (internalApiKey && requestApiKey === internalApiKey) {
                // 内部APIアクセスは全プロジェクトへのアクセス権を付与
                const access = buildInternalAccess();
                req.access = access;
                req.auth = { sub: 'internal_api', level: access.level };
                return next();
            }

            // 開発環境ではヘッダーだけでアクセス可能
            if (allowInsecureHeaderAuth()) {
                const roleHeader = getHeaderValue(req, 'x-brainbase-role', 'x-role');
                if (roleHeader) {
                    const role = roleHeader.toLowerCase();
                    // ヘッダーベース認証を使用（Info SSOT controller用の形式）
                    const projectHeader = getHeaderValue(req, 'x-brainbase-projects', 'x-projects');
                    const clearanceHeader = getHeaderValue(req, 'x-brainbase-clearance', 'x-clearance');
                    const projectCodes = parseCsv(projectHeader);
                    const clearance = parseCsv(clearanceHeader);

                    const access = {
                        role,
                        projectCodes,
                        clearance,
                        // 既存のフィールドも維持（他のコードが使うかもしれないため）
                        level: deriveRoleLevel(role),
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

            // 通常のトークンベース認証
            const header = req.headers.authorization || '';
            const token = header.startsWith('Bearer ') ? header.slice(7) : null;
            if (!token) {
                return res.status(401).json({ error: 'Authorization token required' });
            }
            const decoded = authService.verifyToken(token);
            // Phase 1: PostgreSQLベース権限管理
            const access = {
                role: decoded.role || 'member',
                projectCodes: decoded.projectCodes || [],
                clearance: decoded.clearance || [],
                level: decoded.level || 1,
                employmentType: decoded.employmentType || 'contractor',
                personId: decoded.sub || null,
                slackUserId: decoded.slackUserId || null,
                slackWorkspaceId: decoded.slackWorkspaceId || null,
                tenantId: decoded.tenantId || null
            };
            req.auth = decoded;
            req.access = access;
            return next();
        } catch (error) {
            return res.status(401).json({ error: 'Invalid token' });
        }
    };
}
