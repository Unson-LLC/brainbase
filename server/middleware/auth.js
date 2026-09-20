// @ts-check
import { getAuthTokensFromRequest, getHeader } from '../lib/auth-cookies.js';

/** @typedef {import('../lib/auth-cookies.js').RequestLike & { method?: string, headers?: Record<string, string | undefined>, auth?: unknown, access?: unknown, authSource?: string | null }} RequestLike */
/** @typedef {{ status: (code: number) => { json: (body: unknown) => unknown } }} ResponseLike */
/** @typedef {(error?: unknown) => unknown} NextLike */
/** @typedef {{ verifyToken: (token: string) => Record<string, unknown>, verifyServiceToken?: (token: string) => Record<string, unknown>, resolveOrganizationIdForAccess?: (access: Record<string, unknown>) => Promise<string|null>, resolveTenantForOrganization?: (organizationId: string) => Promise<{tenant_id?: string, organization_id?: string}|null>, resolveTenantForAuthenticatedAccess?: (access: Record<string, unknown>) => Promise<{tenant_id?: string, organization_id?: string}|null> }} AuthServiceLike */

/**
 * @param {RequestLike} req
 * @param {AuthServiceLike} authService
 */
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
                tenantId: decoded.tenantId || null,
                organizationId: decoded.organizationId || null
            };
            return {
                ok: true,
                auth: decoded,
                access,
                authSource: 'service-token'
            };
        }

        const decoded = authService.verifyToken(token);
        const isSlackProvider = decoded.authProvider === 'slack';
        const access = {
            role: decoded.role || 'member',
            projectCodes: decoded.projectCodes || [],
            clearance: decoded.clearance || [],
            level: decoded.level || 1,
            employmentType: decoded.employmentType || 'contractor',
            personId: decoded.personId || decoded.sub || null,
            authProvider: decoded.authProvider || null,
            providerSubject: decoded.providerSubject || null,
            providerTenant: decoded.providerTenant || null,
            email: decoded.email || null,
            slackUserId: decoded.slackUserId || (isSlackProvider ? decoded.providerSubject : null),
            slackWorkspaceId: decoded.slackWorkspaceId || (isSlackProvider ? decoded.providerTenant : null),
            tenantId: decoded.tenantId || null,
            organizationId: decoded.organizationId || null
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
 * @param {{ structuredErrors?: boolean }} [options]
 * @returns {(req: RequestLike, res: ResponseLike, next: NextLike) => unknown}
 */
export function requireAuth(authService, options = {}) {
    return async (req, res, next) => {
        const result = resolveAuthContext(req, authService);
        if (result?.bypass) {
            return next();
        }

        if (!result?.ok) {
            if (options.structuredErrors) {
                const message = result?.error === 'Authorization token required'
                    ? '認証トークンが必要です'
                    : '認証トークンが無効です';
                return res.status(result?.status || 401).json({
                    error: { code: 'UNAUTHORIZED', message }
                });
            }
            return res.status(result?.status || 401).json({ error: result?.error || 'Unauthorized' });
        }

        const access = result.access || null;
        if (access && !access.organizationId && authService.resolveOrganizationIdForAccess) {
            try {
                const organizationId = await authService.resolveOrganizationIdForAccess(access);
                if (organizationId) {
                    access.organizationId = organizationId;
                }
            } catch {
                // Generic authenticated routes remain available. Personal knowledge
                // routes separately require an organization and therefore fail closed.
            }
        }

        if (access?.organizationId && !access.tenantId && authService.resolveTenantForOrganization) {
            try {
                const hasAuthenticatedTenantContext = Boolean(
                    authService.resolveTenantForAuthenticatedAccess
                    && access.personId
                    && access.slackUserId
                    && access.slackWorkspaceId
                );
                const authenticatedMapping = hasAuthenticatedTenantContext
                    ? await authService.resolveTenantForAuthenticatedAccess(access)
                    : null;
                // Prefer the person + provider identity when it is projected. Older
                // signed sessions can predate that projection, so a missing match may
                // still use the unique active organization alias. The organization
                // resolver fails closed when the alias is missing or ambiguous.
                const mapping = authenticatedMapping
                    ?? await authService.resolveTenantForOrganization(access.organizationId);
                if (mapping?.organization_id === access.organizationId && mapping?.tenant_id) {
                    access.tenantId = mapping.tenant_id;
                }
            } catch {
                // Generic routes retain authenticated organization access. Consumers
                // that require a canonical tenant must fail closed on a missing tenantId.
            }
        }

        req.auth = result.auth || null;
        req.access = access;
        req.authSource = result.authSource || null;
        return next();
    };
}
