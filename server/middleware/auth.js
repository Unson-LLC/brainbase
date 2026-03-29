import { getAuthTokensFromRequest, getHeader } from '../lib/auth-cookies.js';
import { isInsecureHeaderAuthAllowed, parseCsv } from '../lib/validation.js';

export function resolveAuthContext(req, authService) {
    if (req?.method === 'OPTIONS') {
        return { ok: true, bypass: true };
    }

    // 内部API Key認証（mana等の内部サービス用）
    const internalApiKey = process.env.INTERNAL_API_SECRET;
    const requestApiKey = getHeader(req, 'x-internal-api-key');

    if (internalApiKey && requestApiKey === internalApiKey) {
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
        return {
            ok: true,
            auth: { sub: 'internal_api', level: 2 },
            access,
            authSource: 'internal'
        };
    }

    if (isInsecureHeaderAuthAllowed()) {
        const role = (getHeader(req, 'x-brainbase-role') || getHeader(req, 'x-role') || '').toLowerCase();
        if (role) {
            const projectHeader = getHeader(req, 'x-brainbase-projects') || getHeader(req, 'x-projects') || '';
            const clearanceHeader = getHeader(req, 'x-brainbase-clearance') || getHeader(req, 'x-clearance') || '';
            const projectCodes = parseCsv(projectHeader);
            const clearance = parseCsv(clearanceHeader);

            const access = {
                role,
                projectCodes,
                clearance,
                level: role === 'ceo' ? 3 : role === 'gm' ? 2 : 1,
                employmentType: 'contractor',
                personId: null,
                slackUserId: null,
                slackWorkspaceId: null,
                tenantId: null
            };
            return {
                ok: true,
                auth: null,
                access,
                authSource: 'insecure-header'
            };
        }
    }

    try {
        const header = req.headers?.authorization || '';
        const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
        const { accessToken: cookieToken } = getAuthTokensFromRequest(req);
        const token = bearerToken || cookieToken;

        if (!token) {
            return { ok: false, status: 401, error: 'Authorization token required' };
        }

        const decoded = authService.verifyToken(token);
        const access = {
            role: decoded.role || 'member',
            projectCodes: decoded.projectCodes || [],
            clearance: decoded.clearance || [],
            level: decoded.level || 1,
            employmentType: decoded.employmentType || 'contractor',
            personId: decoded.sub || decoded.personId || null,
            slackUserId: decoded.slackUserId || null,
            slackWorkspaceId: decoded.slackWorkspaceId || null,
            tenantId: decoded.tenantId || null
        };
        return {
            ok: true,
            auth: decoded,
            access,
            authSource: bearerToken ? 'bearer' : 'cookie'
        };
    } catch (error) {
        return { ok: false, status: 401, error: 'Invalid token' };
    }
}

export function requireAuth(authService) {
    return (req, res, next) => {
        const result = resolveAuthContext(req, authService);
        if (result?.bypass) {
            return next();
        }

        if (!result?.ok) {
            return res.status(result?.status || 401).json({ error: result?.error || 'Unauthorized' });
        }

        req.auth = result.auth || null;
        req.access = result.access || null;
        req.authSource = result.authSource || null;
        return next();
    };
}
