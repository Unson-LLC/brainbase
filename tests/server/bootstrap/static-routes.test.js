// @ts-check
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { registerStaticRoutes } from '../../../server/bootstrap/static-routes.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('static routes', () => {
    it('does not serve the retired infrastructure demo page', async () => {
        const app = express();
        registerStaticRoutes(app, {
            publicDir: path.join(repoRoot, 'public'),
            log: { error: () => {} }
        });

        await request(app).get('/test-infrastructure.html').expect(404);
    });

    it('does not serve the retired meeting workflow pack prototype', async () => {
        const app = express();
        registerStaticRoutes(app, {
            publicDir: path.join(repoRoot, 'public'),
            log: { error: () => {} }
        });

        await request(app).get('/meeting-workflow-pack.html').expect(404);
    });

    it('serves the Graph API landing page instead of the retired operations command center', async () => {
        const app = express();
        registerStaticRoutes(app, {
            publicDir: path.join(repoRoot, 'public'),
            log: { error: () => {} }
        });

        const root = await request(app).get('/').expect(200);
        expect(root.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
        expect(root.text).toContain('brainbase Graph API Server');
        expect(root.text).not.toContain('AI Operations Command Center');
    });

    it('returns a stable retirement response for the removed command-center entrypoint', async () => {
        const app = express();
        registerStaticRoutes(app, {
            publicDir: path.join(repoRoot, 'public'),
            log: { error: () => {} }
        });

        const response = await request(app).get('/app.js').expect(410);
        expect(response.body).toEqual({
            error: 'capability_retired',
            capability: 'brainbase.operations-command-center',
            owner: 'Codex app and CLI',
            replacement: 'Use Codex tasks and Brainbase MCP'
        });
    });

    it('does not serve retired admin, setup, workflow, SNS, or terminal browser surfaces', async () => {
        const app = express();
        registerStaticRoutes(app, {
            publicDir: path.join(repoRoot, 'public'),
            log: { error: () => {} }
        });

        await request(app).get('/workflows').expect(404);
        await request(app).get('/workflows.html').expect(404);
        await request(app).get('/sns-growth').expect(404);
        await request(app).get('/sns-growth.html').expect(404);
        await request(app).get('/style.css').expect(404);
        await request(app).get('/ttyd/custom_ttyd_index.html').expect(404);
        await request(app).get('/ttyd/ttyd_index.html').expect(404);
        await request(app).get('/admin').expect(404);
        await request(app).get('/admin.html').expect(404);
        await request(app).get('/admin.css').expect(404);
        await request(app).get('/modules/pages/admin-visualization-page.js').expect(404);
        await request(app).get('/setup').expect(404);
        await request(app).get('/setup.html').expect(404);
        await request(app).get('/modules/setup/setup-controller.js').expect(404);
    });
});
