import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startCanonicalTaskLiveApiHarness } from '../../helpers/canonical-task-live-api-harness.js';

describe('Companion canonical Task live HTTP contract', () => {
    let harness;

    beforeAll(async () => {
        harness = await startCanonicalTaskLiveApiHarness();
    });

    afterAll(async () => {
        await harness.close();
    });

    it('returns every Mac-required Task field from create over TCP', async () => {
        const response = await fetch(`${harness.baseURL}/api/companion/tasks`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer canonical-task-e2e',
                'Content-Type': 'application/json',
                'Idempotency-Key': 'live-http-mac-wire-contract'
            },
            body: JSON.stringify({ title: 'Mac wire contract', priority: 'high' })
        });
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body).toHaveProperty('completed_at', null);
        expect(body).toEqual(expect.objectContaining({
            id: expect.any(String),
            created_at: expect.any(String),
            updated_at: expect.any(String),
            web_url: expect.any(String)
        }));
        expect(() => new URL(body.web_url)).not.toThrow();
    });
});
