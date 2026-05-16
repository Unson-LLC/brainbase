// @ts-check
import { describe, it, expect } from 'vitest';
import { buildCredentialRef } from '../../../server/services/account/provider-registry.js';
import { xProvider } from './_helpers.js';

describe('provider AP-1: only infra metadata in credential ref', () => {
    it('AP-1: extra fields are stripped (provider/path/version only returned)', () => {
        const ref = buildCredentialRef(xProvider(), {
            provider: 'infisical',
            path: '/x/sato',
            version: 'v2',
            access_token: 'WRONG',
            refresh_token: 'WRONG'
        });
        expect(ref.access_token).toBeUndefined();
        expect(ref.refresh_token).toBeUndefined();
        expect(ref.path).toBe('/x/sato');
    });
});
