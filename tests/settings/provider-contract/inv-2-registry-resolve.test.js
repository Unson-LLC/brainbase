// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry } from '../../../server/services/account/provider-registry.js';
import { xProvider, slackProvider } from './_helpers.js';

describe('provider INV-2: registry resolves by service code', () => {
    it('INV-2: two providers register and resolve independently', () => {
        const r = new ProviderRegistry();
        r.register(xProvider());
        r.register(slackProvider());
        expect(r.get('x').service).toBe('x');
        expect(r.get('slack').service).toBe('slack');
        expect(r.list()).toHaveLength(2);
    });

    it('INV-2: duplicate register logs warning and replaces (last-wins)', () => {
        const warn = vi.fn();
        const r = new ProviderRegistry({ logger: { warn } });
        r.register(xProvider());
        r.register({ ...xProvider(), capabilities: ['post'] });
        expect(warn).toHaveBeenCalled();
        expect(r.get('x').capabilities).toEqual(['post']);
    });
});
