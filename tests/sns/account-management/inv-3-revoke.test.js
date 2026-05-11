// @ts-check
import { describe, it, expect } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';

describe('x-provider INV-3: revoke', () => {
    it('INV-3: revokeCredential propagates to xClient', async () => {
        const xClient = new InMemoryXClient();
        const p = buildXProvider({ xClient });
        await p.revokeCredential({ provider: 'infisical', path: '/x/sato', version: 'v1' });
        expect(xClient.calls.revoke).toBe(1);
    });
});
