// @ts-check
import { describe, it, expect } from 'vitest';
import { ProviderRegistry, ProviderValidationError } from '../../../server/services/account/provider-registry.js';
import { xProvider } from './_helpers.js';

describe('provider INV-1: ProviderDefinition required fields', () => {
    it('INV-1: full provider registers', () => {
        const r = new ProviderRegistry();
        r.register(xProvider());
        expect(r.get('x')).toBeTruthy();
    });

    it.each(['service', 'authMethods', 'capabilities', 'publicMetadataSchema', 'credentialKeySpec'])(
        'INV-1: missing %s rejected',
        (field) => {
            const r = new ProviderRegistry();
            const p = xProvider();
            delete p[field];
            expect(() => r.register(p)).toThrow(ProviderValidationError);
        }
    );
});
