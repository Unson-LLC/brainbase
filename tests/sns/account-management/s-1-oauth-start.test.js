// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';
import { _resetNoncesForTest } from '../../../server/services/account/provider-registry.js';

describe('x-provider S-1: OAuth start', () => {
    beforeEach(() => _resetNoncesForTest());

    it('S-1: returns URL and state', async () => {
        const p = buildXProvider({ xClient: new InMemoryXClient() });
        const r = await p.startOAuth({ actor_person_id: 'sato', return_url: 'https://x' });
        expect(r.url).toMatch(/^https:\/\/twitter\.com\/i\/oauth2/);
        expect(typeof r.state).toBe('string');
    });
});
