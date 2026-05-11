// @ts-check
import { describe, it, expect } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';

describe('x-provider INV-4: healthCheck', () => {
    it('INV-4: connected ref returns ok=true', async () => {
        const xClient = new InMemoryXClient();
        const p = buildXProvider({ xClient });
        const r = await p.healthCheck({ provider: 'infisical', path: '/x/ok', version: 'v1' });
        expect(r.ok).toBe(true);
    });

    it('INV-4: revoked ref returns ok=false', async () => {
        const xClient = new InMemoryXClient();
        const p = buildXProvider({ xClient });
        const ref = { provider: 'infisical', path: '/x/bad', version: 'v1' };
        await p.revokeCredential(ref);
        const r = await p.healthCheck(ref);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('revoked');
    });
});
