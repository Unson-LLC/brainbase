// @ts-check
import { describe, it, expect } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';

describe('x-provider S-4: revoke flow', () => {
    it('S-4: revoke marks credential and subsequent healthCheck returns ok=false', async () => {
        const xClient = new InMemoryXClient();
        const p = buildXProvider({ xClient });
        const ref = { provider: 'infisical', path: '/x/sato', version: 'v1' };
        await p.revokeCredential(ref);
        const r = await p.healthCheck(ref);
        expect(r.ok).toBe(false);
        expect(xClient.calls.revoke).toBe(1);
    });
});
