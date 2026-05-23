import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createHealthRouter } from '../../../server/routes/health.js';

function createApp({ terminalRuntimeReconciler } = {}) {
    const app = express();
    app.use('/api/health', createHealthRouter({
        readiness: { isReady: () => true },
        configParser: null,
        terminalRuntimeReconciler
    }));
    return app;
}

describe('health routes', () => {
    it('GET /api/health/terminal returns terminal reconciler health', async () => {
        const terminalRuntimeReconciler = {
            getHealth: vi.fn(async () => ({
                status: 'healthy',
                issues: [],
                sessions: { duplicateTtyd: 0 }
            }))
        };
        const app = createApp({ terminalRuntimeReconciler });

        const res = await request(app)
            .get('/api/health/terminal')
            .expect(200);

        expect(res.body).toMatchObject({
            status: 'healthy',
            issues: [],
            sessions: { duplicateTtyd: 0 }
        });
        expect(terminalRuntimeReconciler.getHealth).toHaveBeenCalledTimes(1);
    });

    it('GET /api/health/terminal returns 503 when terminal reconciler is unavailable', async () => {
        const app = createApp({ terminalRuntimeReconciler: null });

        const res = await request(app)
            .get('/api/health/terminal')
            .expect(503);

        expect(res.body).toMatchObject({
            status: 'unhealthy',
            error: 'terminal runtime reconciler is not available'
        });
    });
});
