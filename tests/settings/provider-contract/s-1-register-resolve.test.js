// @ts-check
import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../../server/services/account/provider-registry.js';
import { xProvider } from './_helpers.js';

describe('provider S-1: register then get', () => {
    it('S-1: get("x") returns the registered provider', () => {
        const r = new ProviderRegistry();
        const p = xProvider();
        r.register(p);
        expect(r.get('x')).toEqual(p);
    });
});
