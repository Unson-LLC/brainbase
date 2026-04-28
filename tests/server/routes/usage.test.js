import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createUsageRouter } from '../../../server/routes/usage.js';

describe('usage routes', () => {
    let app;
    let tokenUsageService;

    beforeEach(() => {
        tokenUsageService = {
            getWeeklyUsage: vi.fn(async () => ({
                period: { start: '2026-04-27T00:00:00.000Z', end: '2026-04-28T00:00:00.000Z' },
                totalTokens: 1234,
                engines: {
                    codex: { totalTokens: 1000 },
                    claude: { totalTokens: 234 }
                }
            }))
        };
        app = express();
        app.use('/api/usage', createUsageRouter(tokenUsageService));
    });

    it('GET /tokens/weekly returns weekly usage', async () => {
        const res = await request(app).get('/api/usage/tokens/weekly?force=1');

        expect(res.status).toBe(200);
        expect(res.body.totalTokens).toBe(1234);
        expect(tokenUsageService.getWeeklyUsage).toHaveBeenCalledWith({ force: true });
    });
});
