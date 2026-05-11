// @ts-check
import { describe, it, expect } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';

describe('x-provider INV-5: post via provider relies on xClient (connected ref)', () => {
    it('INV-5: post returns tweet_id for connected ref', async () => {
        const xClient = new InMemoryXClient();
        const p = buildXProvider({ xClient });
        const ref = { provider: 'infisical', path: '/x/ok', version: 'v1' };
        const r = await p.post(ref, { text: 'hello' });
        expect(r.tweet_id).toMatch(/^tw_/);
        expect(xClient.calls.postTweet).toBe(1);
    });

    it('INV-5: post for revoked ref throws', async () => {
        const xClient = new InMemoryXClient();
        const p = buildXProvider({ xClient });
        const ref = { provider: 'infisical', path: '/x/bad', version: 'v1' };
        await p.revokeCredential(ref);
        await expect(p.post(ref, { text: 'x' })).rejects.toThrow();
    });
});
