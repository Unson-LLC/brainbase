import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createHealthRouter } from '../../../server/routes/health.js';
import { buildMemoryHealth } from '../../../server/controllers/health-controller.js';

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
    it('does not degrade a compact heap when process RSS is far below its runtime limit', () => {
        const check = buildMemoryHealth({
            rss: 160 * 1024 * 1024,
            heapUsed: 56 * 1024 * 1024,
            heapTotal: 58 * 1024 * 1024,
            external: 8 * 1024 * 1024,
            arrayBuffers: 2 * 1024 * 1024
        }, {
            usedBytes: 150 * 1024 * 1024,
            boundaryBytes: 900 * 1024 * 1024,
            source: 'cgroup.v2.memory.high'
        });

        expect(check).toMatchObject({
            status: 'healthy',
            details: {
                rss: 160,
                used: 150,
                boundary: 900,
                boundarySource: 'cgroup.v2.memory.high',
                runtimeUsagePercent: 17,
                heapUsagePercent: 97
            }
        });
    });

    it('degrades when process RSS exceeds 90 percent of the runtime limit', () => {
        const check = buildMemoryHealth({
            rss: 820 * 1024 * 1024,
            heapUsed: 56 * 1024 * 1024,
            heapTotal: 58 * 1024 * 1024,
            external: 8 * 1024 * 1024,
            arrayBuffers: 2 * 1024 * 1024
        }, {
            usedBytes: 820 * 1024 * 1024,
            boundaryBytes: 900 * 1024 * 1024,
            source: 'cgroup.v2.memory.high'
        });

        expect(check.status).toBe('degraded');
        expect(check.details.runtimeUsagePercent).toBe(91);
    });

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
