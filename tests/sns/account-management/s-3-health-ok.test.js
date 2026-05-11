// @ts-check
import { describe, it, expect } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';

describe('x-provider S-3: healthCheck ok', () => {
    it('S-3: connected credential_ref → ok=true', async () => {
        const p = buildXProvider({ xClient: new InMemoryXClient() });
        const r = await p.healthCheck({ provider: 'infisical', path: '/x/healthy', version: 'v1' });
        expect(r.ok).toBe(true);
    });
});
