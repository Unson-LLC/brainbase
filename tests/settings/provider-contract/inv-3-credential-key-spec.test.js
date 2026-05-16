// @ts-check
import { describe, it, expect } from 'vitest';
import { buildCredentialRef, ProviderValidationError } from '../../../server/services/account/provider-registry.js';
import { xProvider } from './_helpers.js';

describe('provider INV-3: credential ref limited to infra metadata (no secrets)', () => {
    it('INV-3: buildCredentialRef returns {provider, path, version} only', () => {
        const ref = buildCredentialRef(xProvider(), { provider: 'infisical', path: '/integrations/x/sato' });
        expect(Object.keys(ref).sort()).toEqual(['path', 'provider', 'version']);
    });

    it('INV-3: missing path throws', () => {
        expect(() => buildCredentialRef(xProvider(), { provider: 'infisical' })).toThrow(ProviderValidationError);
    });
});
