// @ts-check
import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../../server/services/account/provider-registry.js';

describe('provider AP-3: callers must go through registry, not hardcode service', () => {
    it('AP-3: unregistered service returns null (forces explicit registration)', () => {
        const r = new ProviderRegistry();
        expect(r.get('unregistered-service')).toBeNull();
    });
});
