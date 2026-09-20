import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../../../server/middleware/auth.js';

describe('auth middleware', () => {
    it('returns 401 when token is missing', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({})
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ ok: true }));

        await request(app)
            .get('/secure')
            .expect(401);
    });

    it('非本番フラグが有効でも自己申告headerだけでは認証されない', async () => {
        const app = express();
        const authService = {
            verifyToken: vi.fn(() => ({
                role: 'member',
                projectCodes: ['alpha'],
                clearance: ['internal'],
                personId: 'per_1'
            }))
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const previous = process.env.BRAINBASE_TEST_MODE;
        process.env.BRAINBASE_TEST_MODE = 'true';
        try {
            await request(app)
                .get('/secure')
                .set('x-brainbase-role', 'ceo')
                .set('x-brainbase-projects', 'alpha')
                .set('x-brainbase-clearance', 'restricted')
                .expect(401);
        } finally {
            if (previous === undefined) delete process.env.BRAINBASE_TEST_MODE;
            else process.env.BRAINBASE_TEST_MODE = previous;
        }
        expect(authService.verifyToken).not.toHaveBeenCalled();
    });

    it('strict modeではinsecure headerを認証として扱わない', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({})
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ ok: true }));

        await request(app)
            .get('/secure')
            .set('x-brainbase-role', 'ceo')
            .set('x-brainbase-projects', 'brainbase')
            .set('x-brainbase-clearance', 'restricted')
            .expect(401);
    });

    it('strict modeでは自己申告headerより検証済みJWT claimを使う', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'member',
                projectCodes: ['brainbase'],
                clearance: ['internal'],
                sub: 'per_verified'
            })
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access, source: req.authSource }));

        const res = await request(app)
            .get('/secure')
            .set('Authorization', 'Bearer verified-token')
            .set('x-brainbase-role', 'ceo')
            .set('x-brainbase-projects', 'all-projects')
            .expect(200);

        expect(res.body.source).toBe('bearer');
        expect(res.body.access.role).toBe('member');
        expect(res.body.access.projectCodes).toEqual(['brainbase']);
        expect(res.body.access.personId).toBe('per_verified');
    });

    it('Slack provider JWTは検証済みsubjectとtenantを正確なSlack identityとして扱う', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'ceo',
                projectCodes: ['brainbase'],
                clearance: ['internal'],
                personId: 'per_sato',
                authProvider: 'slack',
                providerSubject: 'U_SATO',
                providerTenant: 'T_UNSON',
                organizationId: 'unson'
            })
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const res = await request(app)
            .get('/secure')
            .set('Authorization', 'Bearer slack-provider-token')
            .expect(200);

        expect(res.body.access).toMatchObject({
            personId: 'per_sato',
            authProvider: 'slack',
            slackUserId: 'U_SATO',
            slackWorkspaceId: 'T_UNSON',
            organizationId: 'unson'
        });
    });

    it('Slack以外のprovider identityをSlack identityへ流用しない', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'member',
                projectCodes: ['brainbase'],
                personId: 'per_google',
                authProvider: 'google',
                providerSubject: 'google-user',
                providerTenant: 'google-domain'
            })
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const res = await request(app)
            .get('/secure')
            .set('Authorization', 'Bearer google-provider-token')
            .expect(200);

        expect(res.body.access.slackUserId).toBeNull();
        expect(res.body.access.slackWorkspaceId).toBeNull();
    });

    it('session cookieがある時_cookie認証で通す', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'member',
                projectCodes: ['brainbase'],
                clearance: ['internal'],
                level: 1,
                employmentType: 'contractor',
                sub: 'per_cookie'
            })
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access, source: req.authSource }));

        const res = await request(app)
            .get('/secure')
            .set('Cookie', 'brainbase_session=session-token')
            .expect(200);

        expect(res.body.source).toBe('cookie');
        expect(res.body.access.personId).toBe('per_cookie');
        expect(res.body.access.projectCodes).toEqual(['brainbase']);
    });

    it('旧JWTにorganization claimがない時_検証済み本人情報から組織を補完する', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'ceo',
                projectCodes: ['brainbase'],
                clearance: ['internal'],
                sub: 'per_sato',
                slackUserId: 'U_SATO',
                slackWorkspaceId: 'T_UNSON'
            }),
            resolveOrganizationIdForAccess: async (access) => {
                expect(access.personId).toBe('per_sato');
                expect(access.slackUserId).toBe('U_SATO');
                return 'unson';
            },
            resolveTenantForOrganization: async (organizationId) => {
                expect(organizationId).toBe('unson');
                return { organization_id: 'unson', tenant_id: 'ten_unson' };
            }
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const res = await request(app)
            .get('/secure')
            .set('Authorization', 'Bearer legacy-token')
            .expect(200);

        expect(res.body.access.organizationId).toBe('unson');
        expect(res.body.access.tenantId).toBe('ten_unson');
    });

    it('重複する組織別名を認証済み本人とSlack workspaceで正規tenantへ解決する', async () => {
        const app = express();
        const resolveTenantForOrganization = vi.fn(async () => null);
        const resolveTenantForAuthenticatedAccess = vi.fn(async () => ({
            organization_id: 'techknight', tenant_id: 'ten_techknight'
        }));
        app.use(requireAuth({
            verifyToken: () => ({ role: 'ceo', sub: 'per_sato', organizationId: 'techknight', slackUserId: 'U_SATO', slackWorkspaceId: 'T_TECHKNIGHT' }),
            resolveTenantForAuthenticatedAccess,
            resolveTenantForOrganization
        }));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const res = await request(app).get('/secure').set('Authorization', 'Bearer token').expect(200);
        expect(res.body.access.tenantId).toBe('ten_techknight');
        expect(resolveTenantForAuthenticatedAccess).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'techknight', personId: 'per_sato', slackUserId: 'U_SATO', slackWorkspaceId: 'T_TECHKNIGHT'
        }));
        expect(resolveTenantForOrganization).not.toHaveBeenCalled();
    });

    it('Slack外部IDが未投影でも一意な旧組織別名から正規tenantへ解決する', async () => {
        const app = express();
        const resolveTenantForAuthenticatedAccess = vi.fn(async () => null);
        const resolveTenantForOrganization = vi.fn(async () => ({
            organization_id: 'unson', tenant_id: 'ten_unson'
        }));
        app.use(requireAuth({
            verifyToken: () => ({
                role: 'ceo',
                sub: 'per_sato',
                organizationId: 'unson',
                slackUserId: 'U_LEGACY',
                slackWorkspaceId: 'T_LEGACY'
            }),
            resolveTenantForAuthenticatedAccess,
            resolveTenantForOrganization
        }));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const res = await request(app).get('/secure').set('Authorization', 'Bearer token').expect(200);
        expect(res.body.access).toMatchObject({ organizationId: 'unson', tenantId: 'ten_unson' });
        expect(resolveTenantForAuthenticatedAccess).toHaveBeenCalledOnce();
        expect(resolveTenantForOrganization).toHaveBeenCalledWith('unson');
    });

    it('tenant-only旧JWTは検証済みtenantを保ったまま組織を補完する', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'member',
                projectCodes: ['brainbase'],
                clearance: ['internal'],
                sub: 'per_legacy_tenant',
                tenantId: 'org_unson'
            }),
            resolveOrganizationIdForAccess: async (access) => {
                expect(access.tenantId).toBe('org_unson');
                expect(access.organizationId).toBeNull();
                return 'org_unson';
            }
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const res = await request(app)
            .get('/secure')
            .set('Authorization', 'Bearer legacy-tenant-token')
            .expect(200);

        expect(res.body.access).toMatchObject({
            tenantId: 'org_unson',
            organizationId: 'org_unson'
        });
    });

    it('organization-only旧JWTは組織をtenantとして代用しない', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'member',
                projectCodes: ['brainbase'],
                clearance: ['internal'],
                sub: 'per_legacy_organization',
                organizationId: 'ten_unson'
            })
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const res = await request(app)
            .get('/secure')
            .set('Authorization', 'Bearer legacy-organization-token')
            .expect(200);

        expect(res.body.access).toMatchObject({
            organizationId: 'ten_unson'
        });
        expect(res.body.access.tenantId).toBeNull();
    });

    it('bbsvc tokenがある時_service-token認証で通す', async () => {
        const app = express();
        const authService = {
            verifyServiceToken: () => ({
                typ: 'service',
                sub: 'svc_hp_unson',
                role: 'gm',
                projectCodes: ['unson'],
                clearance: ['internal', 'restricted'],
                level: 2
            }),
            verifyToken: () => {
                throw new Error('JWT verifier should not be used for service tokens');
            }
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access, source: req.authSource }));

        const res = await request(app)
            .get('/secure')
            .set('Authorization', 'Bearer bbsvc_test-token')
            .expect(200);

        expect(res.body.source).toBe('service-token');
        expect(res.body.access.personId).toBe('svc_hp_unson');
        expect(res.body.access.projectCodes).toEqual(['unson']);
        expect(res.body.access.employmentType).toBe('internal_service');
    });
});
