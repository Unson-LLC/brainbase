import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../server/services/auth-service.js';

describe('AuthService service tokens', () => {
    beforeEach(() => {
        process.env.BRAINBASE_JWT_SECRET = 'test-jwt-secret';
        process.env.BRAINBASE_SERVICE_TOKEN_SECRET = 'test-service-secret';
        process.env.BRAINBASE_SERVICE_TOKEN_TTL_SECONDS = '3600';
        process.env.BRAINBASE_SERVICE_TOKEN_ISSUER = 'brainbase';
        process.env.BRAINBASE_SERVICE_TOKEN_AUDIENCE = 'mana-runtime';
        process.env.BRAINBASE_SERVICE_TOKEN_DEPLOYMENT_ID = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX';
        process.env.BRAINBASE_SERVICE_TOKEN_CAPABILITIES = 'tenant_context:resolve,tenant_boundary:authorize';
    });

    it('issueServiceToken呼び出し時_bbsvc prefixのservice tokenを発行し検証できる', () => {
        const authService = new AuthService();

        const result = authService.issueServiceToken({
            name: 'hp_unson production',
            role: 'gm',
            projectCodes: ['unson'],
            clearance: ['internal', 'restricted'],
            organizationId: 'unson',
            personId: 'per_admin',
            createdBy: 'per_admin'
        });

        expect(result.token).toMatch(/^bbsvc_/);
        expect(result.access.role).toBe('gm');
        expect(result.access.projectCodes).toEqual(['unson']);

        const decoded = authService.verifyServiceToken(result.token);
        expect(decoded.typ).toBe('service');
        expect(decoded.sub).toBe('svc_hp_unson_production');
        expect(decoded.role).toBe('gm');
        expect(decoded.projectCodes).toEqual(['unson']);
        expect(decoded.clearance).toEqual(['internal', 'restricted']);
        expect(decoded.organizationId).toBe('unson');
        expect(decoded).toMatchObject({
            issuer: 'brainbase',
            subject: 'svc_hp_unson_production',
            audience: ['mana-runtime'],
            deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            capabilities: ['tenant_context:resolve', 'tenant_boundary:authorize'],
            expires_at: result.expires_at
        });
        expect(result.access.organizationId).toBe('unson');
    });

    it('verifyServiceToken呼び出し時_bbsvc prefix以外は拒否する', () => {
        const authService = new AuthService();

        expect(() => authService.verifyServiceToken(authService.issueToken({ sub: 'per_1' }))).toThrow('Invalid service token');
    });

    it('issueServiceToken呼び出し時_不正なprojectCodesとclearanceは正規化する', () => {
        const authService = new AuthService();

        const result = authService.issueServiceToken({
            name: 'bad input',
            role: 'invalid',
            projectCodes: [' unson ', '', 123, 'brainbase'],
            clearance: ['internal', '', 'restricted', 456],
            organizationId: 'unson',
            personId: 'per_1'
        });

        const decoded = authService.verifyServiceToken(result.token);
        expect(decoded.role).toBe('member');
        expect(decoded.projectCodes).toEqual(['unson', 'brainbase']);
        expect(decoded.clearance).toEqual(['internal', 'restricted']);
    });

    it('issueServiceToken呼び出し時_organization IDがなければ拒否する', () => {
        const authService = new AuthService();

        expect(() => authService.issueServiceToken({ name: 'missing organization' }))
            .toThrow('service token organizationId is required');
    });

    it('createAuditLog呼び出し時_person_id FK不整合ならperson_idなしで監査ログを残す', async () => {
        const authService = new AuthService();
        const queries = [];
        const client = {
            query: async (sql, params) => {
                queries.push({ sql, params });
                if (queries.length === 1) {
                    const error = new Error('missing person');
                    error.code = '23503';
                    error.constraint = 'auth_audit_logs_person_id_fkey';
                    throw error;
                }
                return { rows: [] };
            },
            release: () => {}
        };
        authService.pool = {
            connect: async () => client
        };

        await authService.createAuditLog({
            personId: 'per_missing',
            eventType: 'SERVICE_TOKEN_ISSUE',
            metadata: { name: 'hp_unson production' }
        });

        expect(queries).toHaveLength(2);
        expect(queries[0].params[1]).toBe('per_missing');
        expect(queries[1].params[1]).toBeNull();
        expect(JSON.parse(queries[1].params[5])).toMatchObject({
            name: 'hp_unson production',
            original_person_id: 'per_missing'
        });
    });
});
