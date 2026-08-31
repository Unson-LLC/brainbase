// @ts-check
import { getAuthTokensFromRequest, getHeader } from '../lib/auth-cookies.js';
import { isInsecureHeaderAuthAllowed, parseCsv } from '../lib/validation.js';

/** @typedef {import('../lib/auth-cookies.js').RequestLike & { method?: string, headers?: Record<string, string | undefined>, auth?: unknown, access?: unknown, authSource?: string | null }} RequestLike */
/** @typedef {{ status: (code: number) => { json: (body: unknown) => unknown } }} ResponseLike */
/** @typedef {(error?: unknown) => unknown} NextLike */
/** @typedef {{ verifyToken: (token: string) => Record<string, unknown>, verifyServiceToken?: (token: string) => Record<string, unknown>, resolveOrganizationIdForAccess?: (access: Record<string, unknown>) => Promise<string|null> }} AuthServiceLike */

/**
 * @param {RequestLike} req
 * @param {AuthServiceLike} authService
 * @param {{ allowInsecureHeaders?: boolean }} [options]
 */
export function resolveAuthContext(req, authService, options = {}) {
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

    if (options.allowInsecureHeaders !== false && isInsecureHeaderAuthAllowed()) {
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
        const authTokens = getAuthTokensFromRequest(req);
        const cookieToken = authTokens.accessToken;
        const token = bearerToken || cookieToken;

        if (!token) {
            return { ok: false, status: 401, error: 'Authorization token required' };
        }

        if (token.startsWith('bbsvc_')) {
            if (!authService.verifyServiceToken) {
                return { ok: false, status: 401, error: 'Service token verifier is not configured' };
            }
            const decoded = authService.verifyServiceToken(token);
            const access = {
                role: decoded.role || 'member',
                projectCodes: decoded.projectCodes || [],
                clearance: decoded.clearance || [],
                level: decoded.level || 1,
                employmentType: decoded.employmentType || 'internal_service',
                personId: decoded.sub || decoded.personId || null,
                slackUserId: null,
                slackWorkspaceId: null,
                tenantId: decoded.tenantId || decoded.organizationId || null,
                organizationId: decoded.organizationId || decoded.tenantId || null
            };
            return {
                ok: true,
                auth: decoded,
                access,
                authSource: 'service-token'
            };
        }

        const decoded = authService.verifyToken(token);
        const access = {
            role: decoded.role || 'member',
            projectCodes: decoded.projectCodes || [],
            clearance: decoded.clearance || [],
            level: decoded.level || 1,
            employmentType: decoded.employmentType || 'contractor',
            personId: decoded.sub || decoded.personId || null,
            authProvider: decoded.authProvider || null,
            providerSubject: decoded.providerSubject || null,
            providerTenant: decoded.providerTenant || null,
            email: decoded.email || null,
            slackUserId: decoded.slackUserId || null,
            slackWorkspaceId: decoded.slackWorkspaceId || null,
            tenantId: decoded.tenantId || decoded.organizationId || null,
            organizationId: decoded.organizationId || decoded.tenantId || null
        };
        return {
            ok: true,
            auth: decoded,
            access,
            authSource: bearerToken ? 'bearer' : 'cookie'
        };
    } catch {
        return { ok: false, status: 401, error: 'Invalid token' };
    }
}

/**
 * @param {AuthServiceLike} authService
 * @param {{ allowInsecureHeaders?: boolean }} [options]
 * @returns {(req: RequestLike, res: ResponseLike, next: NextLike) => unknown}
 */
export function requireAuth(authService, options = {}) {
    return async (req, res, next) => {
        const result = resolveAuthContext(req, authService, options);
        if (result?.bypass) {
            return next();
        }

        if (!result?.ok) {
            return res.status(result?.status || 401).json({ error: result?.error || 'Unauthorized' });
        }

        const access = result.access || null;
        if (access && !access.organizationId && authService.resolveOrganizationIdForAccess) {
            try {
                const organizationId = await authService.resolveOrganizationIdForAccess(access);
                if (organizationId) {
                    access.organizationId = organizationId;
                    access.tenantId = organizationId;
                }
            } catch {
                // Generic authenticated routes remain available. Personal knowledge
                // routes separately require an organization and therefore fail closed.
            }
        }

        req.auth = result.auth || null;
        req.access = access;
        req.authSource = result.authSource || null;
        return next();
    };
}
