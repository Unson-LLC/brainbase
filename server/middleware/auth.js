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

export function requireAuth(authService) {
    return (req, res, next) => {
        try {
            if (req.method === 'OPTIONS') {
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

            // 通常のトークンベース認証
            const header = req.headers.authorization || '';
            const token = header.startsWith('Bearer ') ? header.slice(7) : null;
            if (!token) {
                return res.status(401).json({ error: 'Authorization token required' });
            }
            const decoded = authService.verifyToken(token);
            // Phase 1: PostgreSQLベース権限管理
            const access = {
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
