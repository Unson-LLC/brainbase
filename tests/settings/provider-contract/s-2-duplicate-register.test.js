// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry } from '../../../server/services/account/provider-registry.js';
import { xProvider } from './_helpers.js';

describe('provider S-2: duplicate register warns and overwrites', () => {
    it('S-2: re-register same service logs warning, replaces', () => {
        const warn = vi.fn();
        const r = new ProviderRegistry({ logger: { warn } });
        r.register(xProvider());
        r.register({ ...xProvider(), authMethods: ['api_key'] });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(r.get('x').authMethods).toEqual(['api_key']);
    });
});
