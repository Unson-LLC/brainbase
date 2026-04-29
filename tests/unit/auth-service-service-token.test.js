import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../server/services/auth-service.js';

describe('AuthService service tokens', () => {
    beforeEach(() => {
        process.env.BRAINBASE_JWT_SECRET = 'test-jwt-secret';
        process.env.BRAINBASE_SERVICE_TOKEN_SECRET = 'test-service-secret';
        process.env.BRAINBASE_SERVICE_TOKEN_TTL_SECONDS = '3600';
    });

    it('issueServiceToken呼び出し時_bbsvc prefixのservice tokenを発行し検証できる', () => {
        const authService = new AuthService();

        const result = authService.issueServiceToken({
            name: 'hp_unson production',
            role: 'gm',
            projectCodes: ['unson'],
            clearance: ['internal', 'restricted'],
            personId: 'per_keigo_sato',
            createdBy: 'per_keigo_sato'
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
            personId: 'per_1'
        });

        const decoded = authService.verifyServiceToken(result.token);
        expect(decoded.role).toBe('member');
        expect(decoded.projectCodes).toEqual(['unson', 'brainbase']);
        expect(decoded.clearance).toEqual(['internal', 'restricted']);
    });
});
